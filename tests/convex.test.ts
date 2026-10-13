import { describe, it, expect, vi } from 'vitest';
import { ConvexRemoteAdapter } from '../src/adapters/remote/convex.js';

describe('ConvexRemoteAdapter', () => {
  it('pushes mutations as a batch to the configured Convex mutation', async () => {
    const mutationSpy = vi.fn().mockResolvedValue({ success: true });

    const mockConvex = {
      mutation: mutationSpy,
      query: vi.fn(),
    };

    const adapter = new ConvexRemoteAdapter(mockConvex as any, {
      tables: ['properties', 'tenants'],
      pushMutation: 'sync:pushBatch',
    });

    const ops = [
      {
        id: 'op-1',
        tableName: 'properties',
        rowId: 'prop-101',
        operation: 'INSERT' as const,
        payload: { title: 'Sunset Villa', rent: 1500 },
        timestamp: 1700000000000,
      },
      {
        id: 'op-2',
        tableName: 'tenants',
        rowId: 'ten-202',
        operation: 'DELETE' as const,
        payload: null,
        timestamp: 1700000001000,
      },
    ];

    const result = await adapter.pushChanges(ops);

    expect(result).toBe(true);
    expect(mutationSpy).toHaveBeenCalledTimes(1);
    expect(mutationSpy).toHaveBeenCalledWith('sync:pushBatch', {
      operations: ops,
    });
  });

  it('handles empty push changes without calling mutation', async () => {
    const mutationSpy = vi.fn();
    const mockConvex = { mutation: mutationSpy, query: vi.fn() };
    const adapter = new ConvexRemoteAdapter(mockConvex as any);

    const result = await adapter.pushChanges([]);
    expect(result).toBe(true);
    expect(mutationSpy).not.toHaveBeenCalled();
  });

  it('handles push mutation failure gracefully', async () => {
    const mutationSpy = vi.fn().mockRejectedValue(new Error('Network error'));
    const mockConvex = { mutation: mutationSpy, query: vi.fn() };
    const adapter = new ConvexRemoteAdapter(mockConvex as any);

    const result = await adapter.pushChanges([
      {
        id: 'op-1',
        tableName: 'properties',
        rowId: 'p-1',
        operation: 'INSERT',
        payload: { title: 'Test' },
        timestamp: Date.now(),
      },
    ]);

    expect(result).toBe(false);
  });

  it('fetches delta changes when Convex query returns structured DeltaChanges', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      timestamp: 1700005000000,
      changes: [
        {
          tableName: 'properties',
          operation: 'UPDATE',
          rowId: 'p1',
          payload: { title: 'Updated Villa' },
          timestamp: 1700005000000,
        },
      ],
    });

    const mockConvex = {
      query: mockQuery,
      mutation: vi.fn(),
    };

    const adapter = new ConvexRemoteAdapter(mockConvex as any, {
      tables: ['properties'],
      pullQuery: 'sync:pullDeltas',
    });

    const deltas = await adapter.fetchChanges(1700000000000);

    expect(mockQuery).toHaveBeenCalledWith('sync:pullDeltas', {
      sinceTimestamp: 1700000000000,
      tables: ['properties'],
    });
    expect(deltas.timestamp).toBe(1700005000000);
    expect(deltas.changes).toHaveLength(1);
    expect(deltas.changes[0].rowId).toBe('p1');
  });

  it('fetches delta changes when Convex query returns document array with soft deletes', async () => {
    const mockDocs = [
      {
        id: 'doc-1',
        tableName: 'tenants',
        name: 'Jane Doe',
        updatedAt: 1700002000000,
        deleted: false,
      },
      {
        id: 'doc-2',
        tableName: 'tenants',
        name: 'John Smith',
        updatedAt: 1700004000000,
        deleted: true,
      },
    ];

    const mockQuery = vi.fn().mockResolvedValue(mockDocs);
    const mockConvex = { query: mockQuery, mutation: vi.fn() };

    const adapter = new ConvexRemoteAdapter(mockConvex as any, {
      tables: ['tenants'],
      deletedColumn: 'deleted',
      updatedAtColumn: 'updatedAt',
    });

    const deltas = await adapter.fetchChanges(1700000000000);

    expect(deltas.changes).toHaveLength(2);
    expect(deltas.changes[0].operation).toBe('UPDATE');
    expect(deltas.changes[0].payload).toEqual(mockDocs[0]);
    expect(deltas.changes[1].operation).toBe('DELETE');
    expect(deltas.changes[1].payload).toBeNull();
    expect(deltas.timestamp).toBe(1700004000000);
  });

  it('subscribes to live updates via client.onUpdate and cleans up with destroy()', () => {
    const unsubscribeSpy = vi.fn();
    let onUpdateHandler: ((data: any) => void) | undefined;

    const onUpdateSpy = vi.fn().mockImplementation((query, args, handler) => {
      onUpdateHandler = handler;
      return unsubscribeSpy;
    });

    const mockConvex = {
      query: vi.fn(),
      mutation: vi.fn(),
      onUpdate: onUpdateSpy,
    };

    const adapter = new ConvexRemoteAdapter(mockConvex as any, {
      tables: ['properties'],
      pullQuery: 'sync:pullDeltas',
    });

    const liveCallback = vi.fn();
    adapter.subscribeToLiveChanges(liveCallback);

    expect(onUpdateSpy).toHaveBeenCalledTimes(1);

    // Simulate incoming reactive update from Convex
    if (onUpdateHandler) {
      onUpdateHandler({
        timestamp: 1700006000000,
        changes: [
          {
            tableName: 'properties',
            operation: 'UPDATE',
            rowId: 'prop-1',
            payload: { title: 'Live Update' },
            timestamp: 1700006000000,
          },
        ],
      });
    }

    expect(liveCallback).toHaveBeenCalledTimes(1);
    expect(liveCallback).toHaveBeenCalledWith({
      timestamp: 1700006000000,
      changes: expect.any(Array),
    });

    // Cleanup
    adapter.destroy();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });
});
