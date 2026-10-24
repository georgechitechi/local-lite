import { describe, expect, it } from 'vitest';
import {
  createFieldMergeResolver,
  getConflictResolver,
  type ConflictContext,
} from '../src/core/conflict.js';

describe('createFieldMergeResolver', () => {
  it('seamlessly merges disjoint field edits from local and remote', () => {
    const resolver = createFieldMergeResolver();

    const context: ConflictContext = {
      tableName: 'todos',
      rowId: 'todo-1',
      remoteChange: {
        tableName: 'todos',
        rowId: 'todo-1',
        operation: 'UPDATE',
        timestamp: 1000,
        payload: { title: 'Updated by Remote' },
      },
      localOutboxRecord: {
        id: 'outbox-1',
        tableName: 'todos',
        rowId: 'todo-1',
        operation: 'UPDATE',
        timestamp: 2000,
        status: 'PENDING',
        retryCount: 0,
        payload: { notes: 'Added notes locally' },
      },
      localRow: { id: 'todo-1', title: 'Original', notes: '', completed: 0 },
    };

    const result = resolver(context);
    expect(result).toEqual({
      mergePayload: {
        id: 'todo-1',
        title: 'Updated by Remote',
        notes: 'Added notes locally',
        completed: 0,
      },
    });
  });

  it('resolves conflicting fields using timestamp (newer wins by default)', () => {
    const resolver = createFieldMergeResolver();

    // Local is newer
    const localNewerCtx: ConflictContext = {
      tableName: 'notes',
      rowId: 'note-1',
      remoteChange: {
        tableName: 'notes',
        rowId: 'note-1',
        operation: 'UPDATE',
        timestamp: 1000,
        payload: { title: 'Server Title' },
      },
      localOutboxRecord: {
        id: 'outbox-1',
        tableName: 'notes',
        rowId: 'note-1',
        operation: 'UPDATE',
        timestamp: 2000,
        status: 'PENDING',
        retryCount: 0,
        payload: { title: 'Local Offline Title' },
      },
      localRow: { id: 'note-1', title: 'Old' },
    };

    const res1 = resolver(localNewerCtx);
    expect(res1).toEqual({
      mergePayload: { id: 'note-1', title: 'Local Offline Title' },
    });

    // Remote is newer
    const remoteNewerCtx: ConflictContext = {
      ...localNewerCtx,
      remoteChange: {
        ...localNewerCtx.remoteChange,
        timestamp: 5000,
      },
    };
    const res2 = resolver(remoteNewerCtx);
    expect(res2).toEqual({
      mergePayload: { id: 'note-1', title: 'Server Title' },
    });
  });

  it('supports fieldRules with min, max, local, remote, and custom functions', () => {
    const resolver = createFieldMergeResolver({
      fieldRules: {
        counters: {
          views: 'max',
          version: 'max',
          tags: (local, remote) =>
            Array.from(new Set([...(local ?? []), ...(remote ?? [])])).sort(),
        },
      },
    });

    const context: ConflictContext = {
      tableName: 'counters',
      rowId: 'c1',
      remoteChange: {
        tableName: 'counters',
        rowId: 'c1',
        operation: 'UPDATE',
        timestamp: 2000,
        payload: { views: 50, version: 10, tags: ['a', 'b'] },
      },
      localOutboxRecord: {
        id: 'outbox-1',
        tableName: 'counters',
        rowId: 'c1',
        operation: 'UPDATE',
        timestamp: 1000,
        status: 'PENDING',
        retryCount: 0,
        payload: { views: 100, version: 5, tags: ['b', 'c'] },
      },
      localRow: { id: 'c1', views: 0, version: 0, tags: [] },
    };

    const result = resolver(context);
    expect(result).toEqual({
      mergePayload: {
        id: 'c1',
        views: 100, // max(100, 50)
        version: 10, // max(5, 10)
        tags: ['a', 'b', 'c'], // custom array union
      },
    });
  });

  it('handles delete-wins and update-wins policies', () => {
    const deleteWinsResolver = createFieldMergeResolver({ deleteHandling: 'delete-wins' });
    const updateWinsResolver = createFieldMergeResolver({ deleteHandling: 'update-wins' });

    // Remote deleted, local updated
    const remoteDelContext: ConflictContext = {
      tableName: 'items',
      rowId: 'i-1',
      remoteChange: {
        tableName: 'items',
        rowId: 'i-1',
        operation: 'DELETE',
        timestamp: 2000,
        payload: null,
      },
      localOutboxRecord: {
        id: 'outbox-1',
        tableName: 'items',
        rowId: 'i-1',
        operation: 'UPDATE',
        timestamp: 1000,
        status: 'PENDING',
        retryCount: 0,
        payload: { name: 'Item 1' },
      },
    };

    expect(deleteWinsResolver(remoteDelContext)).toBe('apply-remote');
    expect(updateWinsResolver(remoteDelContext)).toBe('keep-local');

    // Local deleted, remote updated
    const localDelContext: ConflictContext = {
      tableName: 'items',
      rowId: 'i-1',
      remoteChange: {
        tableName: 'items',
        rowId: 'i-1',
        operation: 'UPDATE',
        timestamp: 2000,
        payload: { name: 'Item 1' },
      },
      localOutboxRecord: {
        id: 'outbox-1',
        tableName: 'items',
        rowId: 'i-1',
        operation: 'DELETE',
        timestamp: 1000,
        status: 'PENDING',
        retryCount: 0,
        payload: null,
      },
    };

    expect(deleteWinsResolver(localDelContext)).toBe('keep-local');
    expect(updateWinsResolver(localDelContext)).toBe('apply-remote');
  });

  it('can be retrieved via getConflictResolver("field-merge")', () => {
    const resolver = getConflictResolver('field-merge');
    expect(typeof resolver).toBe('function');
  });
});
