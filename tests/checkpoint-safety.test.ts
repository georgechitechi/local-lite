import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncWorker } from '../src/core/sync-worker.js';
import { MetaStore } from '../src/core/meta-store.js';
import { EventEmitter } from '../src/reactive/event-emitter.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { SupabaseRemoteAdapter } from '../src/adapters/remote/supabase.js';
import { MockDB } from './helpers/mock-db.js';

afterEach(() => vi.restoreAllMocks());

describe('checkpoint safety', () => {
  it('applies realtime rows without advancing the pull cursor and ignores callbacks after stop', async () => {
    const db = new MockDB();
    await MetaStore.setLastSyncedAt(db, 100);
    const remote = new MemoryDemoRemoteAdapter(0);
    vi.spyOn(remote, 'fetchChanges').mockResolvedValue({ timestamp: 100, changes: [] });
    let callback: any;
    const cleanup = vi.fn();
    vi.spyOn(remote, 'subscribeToLiveChanges').mockImplementation(cb => { callback = cb; return cleanup; });
    const events = new EventEmitter();
    const worker = new SyncWorker(db, remote, events, { logger: false });
    try {
      worker.start();
      const applied = new Promise<void>(resolve => events.on('notes', () => resolve()));
      callback({ timestamp: 1000, changes: [
        { tableName: 'notes', rowId: 'live', operation: 'INSERT', payload: { title: 'Live' }, timestamp: 1000 },
      ] });
      await applied;
      await worker.applyDeltasLocally({ timestamp: 0, changes: [] });
      expect(db.getAll('notes')).toHaveLength(1);
      expect(await worker.getLastPulledTimestamp()).toBe(100);
      expect(await MetaStore.getLastSyncedAt(db)).toBe(100);
      worker.stop();
      expect(cleanup).toHaveBeenCalledTimes(1);
      callback({ timestamp: 2000, changes: [
        { tableName: 'notes', rowId: 'stopped', operation: 'INSERT', payload: {} },
      ] });
      await worker.applyDeltasLocally({ timestamp: 0, changes: [] });
      expect(db.getAll('notes')).toHaveLength(1);
    } finally { worker.stop(); }
  });

  it('loads an existing durable cursor before applying an older batch', async () => {
    const db = new MockDB();
    await MetaStore.setLastSyncedAt(db, 500);
    const worker = new SyncWorker(db, new MemoryDemoRemoteAdapter(0), new EventEmitter(), { logger: false });
    await worker.applyDeltasLocally({ timestamp: 100, changes: [] });
    expect(await MetaStore.getLastSyncedAt(db)).toBe(500);
    expect(await worker.getLastPulledTimestamp()).toBe(500);
  });

  it('retains the checkpoint when a later Supabase table fails and recovers on retry', async () => {
    const db = new MockDB();
    await MetaStore.setLastSyncedAt(db, 100);
    let fail = true;
    const backend = { from: (table: string) => ({
      select: () => ({ gt: () => ({ order: async () =>
        table === 'second' && fail ? { error: new Error('unavailable') } :
        { data: [{ id: table, updated_at: new Date(table === 'first' ? 1000 : 200).toISOString() }], error: null }
      }) }),
    }) };
    const remote = new SupabaseRemoteAdapter(backend as any, { tables: ['first', 'second'], logger: false });
    const events = new EventEmitter();
    const report = vi.fn();
    events.on('sync:pull', report);
    const worker = new SyncWorker(db, remote, events, { logger: false });
    await worker.pullRemoteChanges();
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ success: false }));
    expect(await MetaStore.getLastSyncedAt(db)).toBe(100);
    expect(db.getAll('first')).toHaveLength(0);
    fail = false;
    await worker.pullRemoteChanges();
    expect(db.getAll('first')).toHaveLength(1);
    expect(db.getAll('second')).toHaveLength(1);
    expect(await MetaStore.getLastSyncedAt(db)).toBe(1000);
  });
});
