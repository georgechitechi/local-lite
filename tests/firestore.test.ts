import { describe, it, expect, vi } from 'vitest';
import { FirestoreRemoteAdapter } from '../src/adapters/remote/firestore.js';

describe('FirestoreRemoteAdapter', () => {
  it('pushes mutations using compat/RN batch writes and handles soft deletes', async () => {
    const commitSpy = vi.fn().mockResolvedValue(undefined);
    const setSpy = vi.fn();

    const mockDoc = vi.fn().mockReturnValue({ id: 'mock-doc' });
    const mockCollection = vi.fn().mockReturnValue({ doc: mockDoc });

    const mockBatch = {
      set: setSpy,
      commit: commitSpy,
    };

    const mockFirestore = {
      batch: vi.fn().mockReturnValue(mockBatch),
      collection: mockCollection,
    };

    const adapter = new FirestoreRemoteAdapter(mockFirestore as any, {
      tables: ['properties'],
      deletedColumn: 'deleted',
      updatedAtColumn: 'updatedAt',
    });

    const success = await adapter.pushChanges([
      {
        id: 'op-1',
        tableName: 'properties',
        rowId: 'prop-1',
        operation: 'INSERT',
        payload: { title: 'Beach House', rent: 2000 },
        timestamp: 1700000000000,
      },
      {
        id: 'op-2',
        tableName: 'properties',
        rowId: 'prop-2',
        operation: 'DELETE',
        payload: null,
        timestamp: 1700000001000,
      },
    ]);

    expect(success).toBe(true);
    expect(mockFirestore.batch).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledTimes(2);

    // Verify INSERT write
    expect(setSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        id: 'prop-1',
        title: 'Beach House',
        rent: 2000,
        deleted: false,
      }),
      { merge: true }
    );

    // Verify DELETE soft-delete write
    expect(setSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        id: 'prop-2',
        deleted: true,
      }),
      { merge: true }
    );

    expect(commitSpy).toHaveBeenCalledTimes(1);
  });

  it('pushes mutations using modular Firestore SDK mock functions', async () => {
    const commitSpy = vi.fn().mockResolvedValue(undefined);
    const setSpy = vi.fn();
    const mockBatch = { set: setSpy, commit: commitSpy };

    const mockModule = {
      writeBatch: vi.fn().mockReturnValue(mockBatch),
      collection: vi.fn().mockImplementation((_db, table) => ({ table })),
      doc: vi.fn().mockImplementation((col, id) => ({ col, id })),
    };

    // A modular Firestore instance does NOT have .batch() on itself
    const mockDb = { type: 'firestore-modular' };

    const adapter = new FirestoreRemoteAdapter(mockDb as any, {
      tables: ['tenants'],
      firestoreModule: mockModule,
    });

    const success = await adapter.pushChanges([
      {
        id: 'op-1',
        tableName: 'tenants',
        rowId: 'ten-1',
        operation: 'UPDATE',
        payload: { name: 'Alice' },
        timestamp: Date.now(),
      },
    ]);

    expect(success).toBe(true);
    expect(mockModule.writeBatch).toHaveBeenCalledWith(mockDb);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(commitSpy).toHaveBeenCalledTimes(1);
  });

  it('fetches delta changes and correctly handles soft deletes and timestamp extraction', async () => {
    const docs = [
      {
        id: 'doc-1',
        data: () => ({
          id: 'doc-1',
          name: 'Alice',
          updatedAt: 1700002000000,
          deleted: false,
        }),
      },
      {
        id: 'doc-2',
        data: () => ({
          id: 'doc-2',
          name: 'Bob',
          updatedAt: { toMillis: () => 1700005000000 }, // Firestore Timestamp object
          deleted: true,
        }),
      },
    ];

    const getSpy = vi.fn().mockResolvedValue({ docs });
    const whereSpy = vi.fn().mockReturnValue({ get: getSpy });
    const collectionSpy = vi.fn().mockReturnValue({ where: whereSpy });

    const mockFirestore = {
      collection: collectionSpy,
    };

    const adapter = new FirestoreRemoteAdapter(mockFirestore as any, {
      tables: ['tenants'],
      deletedColumn: 'deleted',
      updatedAtColumn: 'updatedAt',
    });

    const deltas = await adapter.fetchChanges(1700000000000);

    expect(collectionSpy).toHaveBeenCalledWith('tenants');
    expect(whereSpy).toHaveBeenCalledWith('updatedAt', '>', 1700000000000);
    expect(deltas.changes).toHaveLength(2);

    expect(deltas.changes[0].operation).toBe('UPDATE');
    expect(deltas.changes[0].rowId).toBe('doc-1');
    expect(deltas.changes[0].payload).toEqual(expect.objectContaining({ name: 'Alice' }));

    expect(deltas.changes[1].operation).toBe('DELETE');
    expect(deltas.changes[1].rowId).toBe('doc-2');
    expect(deltas.changes[1].payload).toBeNull();

    expect(deltas.timestamp).toBe(1700005000000);
  });

  it('subscribes to live changes via onSnapshot and unsubscribes cleanly with destroy()', () => {
    const unsubscribeSpy = vi.fn();
    let snapshotCallback: ((snapshot: any) => void) | undefined;

    const onSnapshotSpy = vi.fn().mockImplementation((cb) => {
      snapshotCallback = cb;
      return unsubscribeSpy;
    });

    const whereSpy = vi.fn().mockReturnValue({ onSnapshot: onSnapshotSpy });
    const collectionSpy = vi.fn().mockReturnValue({ where: whereSpy });

    const mockFirestore = {
      collection: collectionSpy,
    };

    const adapter = new FirestoreRemoteAdapter(mockFirestore as any, {
      tables: ['properties'],
      updatedAtColumn: 'updatedAt',
      deletedColumn: 'deleted',
    });

    const liveHandler = vi.fn();
    adapter.subscribeToLiveChanges(liveHandler);

    expect(onSnapshotSpy).toHaveBeenCalledTimes(1);

    // Simulate incoming snapshot with docChanges
    if (snapshotCallback) {
      snapshotCallback({
        docChanges: () => [
          {
            type: 'modified',
            doc: {
              id: 'prop-99',
              data: () => ({
                id: 'prop-99',
                title: 'Penthouse',
                updatedAt: 1700008000000,
                deleted: false,
              }),
            },
          },
        ],
      });
    }

    expect(liveHandler).toHaveBeenCalledTimes(1);
    expect(liveHandler).toHaveBeenCalledWith({
      timestamp: 1700008000000,
      changes: [
        {
          tableName: 'properties',
          operation: 'UPDATE',
          rowId: 'prop-99',
          payload: expect.objectContaining({ title: 'Penthouse' }),
          timestamp: 1700008000000,
        },
      ],
    });

    // Cleanup
    adapter.destroy();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });
});
