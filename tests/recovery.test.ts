import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncWorker } from '../src/core/sync-worker.js';
import { MetaStore } from '../src/core/meta-store.js';
import { OutboxStore } from '../src/core/outbox-store.js';
import { EventEmitter } from '../src/reactive/event-emitter.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { MockDB } from './helpers/mock-db.js';

afterEach(() => vi.restoreAllMocks());

describe('automatic sync recovery', () => {
  function setup() {
    const db = new MockDB();
    const remote = new MemoryDemoRemoteAdapter(0);
    const worker = new SyncWorker(db, remote, new EventEmitter(), { logger: false });
    return { db, remote, worker };
  }

  it('retries an interrupted push after its failure status could not be saved', async () => {
    const { db, remote, worker } = setup();
    await OutboxStore.insertRecord(db, {
      id: 'op', tableName: 'notes', rowId: 'note', operation: 'INSERT',
      payload: { title: 'Keep me' }, timestamp: 1,
    });
    const push = vi.spyOn(remote, 'pushChanges')
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(true);
    vi.spyOn(OutboxStore, 'markFailed').mockRejectedValueOnce(new Error('database busy'));
    await worker.pushLocalChanges();
    expect(db.getAll('sync_outbox')[0].status).toBe('PROCESSING');
    await worker.pushLocalChanges();
    expect(push).toHaveBeenCalledTimes(2);
    expect(db.getAll('sync_outbox')).toHaveLength(0);
    worker.stop();
  });

  it('keeps the previous cursor when persistence fails and recovers on the next pull', async () => {
    const { remote, worker } = setup();
    const fetch = vi.spyOn(remote, 'fetchChanges').mockResolvedValue({ timestamp: 100, changes: [] });
    vi.spyOn(MetaStore, 'setLastSyncedAt').mockRejectedValueOnce(new Error('database busy'));
    await worker.pullRemoteChanges();
    expect(await worker.getLastPulledTimestamp()).toBe(0);
    await worker.pullRemoteChanges();
    expect(fetch).toHaveBeenNthCalledWith(2, 0);
    expect(await worker.getLastPulledTimestamp()).toBe(100);
  });

  it('serializes concurrent push and pull calls across the online check', async () => {
    const { remote, worker } = setup();
    const pending = vi.spyOn(OutboxStore, 'getPending').mockResolvedValue([]);
    const fetch = vi.spyOn(remote, 'fetchChanges').mockResolvedValue({ timestamp: 0, changes: [] });
    await Promise.all([
      worker.pushLocalChanges(), worker.pushLocalChanges(),
      worker.pullRemoteChanges(), worker.pullRemoteChanges(),
    ]);
    expect(pending).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
