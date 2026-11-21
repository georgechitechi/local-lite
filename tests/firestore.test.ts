import { describe, it, expect, vi } from 'vitest';
import { FirestoreRemoteAdapter } from '../src/adapters/remote/firestore.js';

describe('FirestoreRemoteAdapter (Modular Firebase SDK v11+)', () => {
  it('pushes mutations using modular writeBatch and handles soft deletes', async () => {
    const commitSpy = vi.fn().mockResolvedValue(undefined);
    const setSpy = vi.fn();
    const mockBatch = { set: setSpy, commit: commitSpy };

    const mockModule = {
      writeBatch: vi.fn().mockReturnValue(mockBatch),
      collection: vi.fn().mockImplementation((_db, table) => ({ table })),
      doc: vi.fn().mockImplementation((col, id) => ({ col, id })),
    };

    const mockDb = { type: 'firestore-modular' };

    const adapter = new FirestoreRemoteAdapter(mockDb as any, {
      tables: ['properties'],
      deletedColumn: 'deleted',
      updatedAtColumn: 'updatedAt',
      firestoreModule: mockModule,
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

    expect(success).toEqual({
      success: true,
      successfulIds: ['op-1', 'op-2'],
      failedIds: [],
    });
    expect(mockModule.writeBatch).toHaveBeenCalledWith(mockDb);
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(setSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        id: 'prop-1',
        title: 'Beach House',
        rent: 2000,
        deleted: false,
      }),
      { merge: true },
    );
    expect(setSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        id: 'prop-2',
        deleted: true,
      }),
      { merge: true },
    );
    expect(commitSpy).toHaveBeenCalledTimes(1);
  });

  it('fetches delta changes using modular query, where, and getDocs', async () => {
    const mockDocs = [
      {
        id: 'doc-1',
        data: () => ({
          id: 'doc-1',
          name: 'Alice',
          updatedAt: 1700001000000,
          deleted: false,
        }),
      },
      {
        id: 'doc-2',
        data: () => ({
          id: 'doc-2',
          name: 'Bob',
          updatedAt: 1700005000000,
          deleted: true,
        }),
      },
    ];

    const mockModule = {
      collection: vi.fn().mockImplementation((_db, table) => ({ table })),
      where: vi.fn().mockImplementation((field, op, val) => ({ field, op, val })),
      query: vi.fn().mockImplementation((col, w) => ({ col, w })),
      getDocs: vi.fn().mockResolvedValue({ docs: mockDocs }),
    };

    const adapter = new FirestoreRemoteAdapter({} as any, {
      tables: ['tenants'],
      deletedColumn: 'deleted',
      updatedAtColumn: 'updatedAt',
      firestoreModule: mockModule,
    });

    const deltas = await adapter.fetchChanges(1700000000000);

    expect(mockModule.collection).toHaveBeenCalledWith(expect.anything(), 'tenants');
    expect(mockModule.where).toHaveBeenCalledWith('updatedAt', '>', 1700000000000);
    expect(deltas.changes).toHaveLength(2);
    expect(deltas.changes[0]).toEqual(
      expect.objectContaining({
        operation: 'UPDATE',
        rowId: 'doc-1',
        payload: expect.objectContaining({ name: 'Alice' }),
      }),
    );
    expect(deltas.changes[1]).toEqual(
      expect.objectContaining({
        operation: 'DELETE',
        rowId: 'doc-2',
        payload: null,
      }),
    );
    expect(deltas.timestamp).toBe(1700005000000);
  });

  it('subscribes to live changes via modular onSnapshot and unsubscribes cleanly', async () => {
    const unsubscribeSpy = vi.fn();
    let snapshotCallback: ((snapshot: any) => void) | undefined;

    const mockModule = {
      collection: vi.fn().mockImplementation((_db, table) => ({ table })),
      where: vi.fn().mockImplementation((field, op, val) => ({ field, op, val })),
      query: vi.fn().mockImplementation((col, w) => ({ col, w })),
      onSnapshot: vi.fn().mockImplementation((_q, cb) => {
        snapshotCallback = cb;
        return unsubscribeSpy;
      }),
    };

    const adapter = new FirestoreRemoteAdapter({} as any, {
      tables: ['properties'],
      updatedAtColumn: 'updatedAt',
      deletedColumn: 'deleted',
      firestoreModule: mockModule,
    });

    const liveHandler = vi.fn();
    const unsubscribe = adapter.subscribeToLiveChanges(liveHandler);
    await vi.waitFor(() => {
      expect(mockModule.onSnapshot).toHaveBeenCalledTimes(1);
    });

    snapshotCallback?.({
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

    unsubscribe();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to modular setDoc when batch.commit fails, returning PushResult with failedIds', async () => {
    const commitSpy = vi
      .fn()
      .mockRejectedValue(new Error('Batch failed: document 2 forbidden'));
    const setSpy = vi.fn();

    const setDocSpy = vi.fn().mockImplementation(async (docRef) => {
      if (docRef.id === 'p-2') {
        throw new Error('Permission denied on doc 2');
      }
    });

    const mockModule = {
      writeBatch: vi.fn().mockReturnValue({ set: setSpy, commit: commitSpy }),
      collection: vi.fn().mockImplementation((_db, table) => ({ table })),
      doc: vi.fn().mockImplementation((col, id) => ({ col, id })),
      setDoc: setDocSpy,
    };

    const adapter = new FirestoreRemoteAdapter({} as any, {
      tables: ['properties'],
      firestoreModule: mockModule,
    });

    const result = await adapter.pushChanges([
      {
        id: 'op-1',
        tableName: 'properties',
        rowId: 'p-1',
        operation: 'INSERT',
        payload: { title: 'Beach House' },
        timestamp: Date.now(),
      },
      {
        id: 'op-2',
        tableName: 'properties',
        rowId: 'p-2',
        operation: 'INSERT',
        payload: { title: 'Penthouse' },
        timestamp: Date.now(),
      },
    ]);

    expect(result).toEqual({
      success: false,
      successfulIds: ['op-1'],
      failedIds: ['op-2'],
      errors: { 'op-2': 'Permission denied on doc 2' },
    });
    expect(setDocSpy).toHaveBeenCalledTimes(2);
  });
});
