import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { LocalFirstClient } from '../src/core/client.js';
import { OutboxStore } from '../src/core/outbox-store.js';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';

/**
 * Runs the performance-sensitive SQL paths against a real SQLite engine (node:sqlite),
 * complementing the regex-based MockDB suite.
 */
describe('Real SQLite performance paths (node:sqlite)', () => {
  let raw: DatabaseSync;
  let db: NodeSQLiteAdapter;
  let client: LocalFirstClient;

  beforeEach(async () => {
    raw = new DatabaseSync(':memory:');
    db = new NodeSQLiteAdapter(raw);
    client = new LocalFirstClient({
      local: db,
      remote: new MemoryDemoRemoteAdapter(0),
      network: new DefaultNetworkStatusProvider(false),
      autoSchema: true,
      tables: ['todos'],
      autoStart: false,
      logger: false,
    });
    await client.initialize();
  });

  afterEach(async () => {
    await client.close();
  });

  it('creates sync_outbox indexes for push, pull and telemetry hot paths', async () => {
    const rows = await db.execute(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sync_outbox'`
    );
    const names = rows.map((r: any) => r.name);
    expect(names).toContain('idx_sync_outbox_status_ts');
    expect(names).toContain('idx_sync_outbox_row');

    // The per-row conflict lookup (run once per pulled change) must use the index.
    const detail = raw
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM sync_outbox WHERE table_name = ? AND row_id = ? AND status != 'FAILED' ORDER BY timestamp DESC LIMIT 1`
      )
      .all('todos', 'x')
      .map((r: any) => String(r.detail))
      .join(' | ');
    expect(detail).toContain('idx_sync_outbox_row');
  });

  it('getCounts aggregates by status in SQL', async () => {
    for (let i = 0; i < 5; i++) {
      await client.insert('todos', { id: `t-${i}`, title: `Task ${i}` });
    }
    await OutboxStore.markFailed(
      db,
      (await client.getOutboxRecords()).slice(0, 2).map((r) => r.id),
      'boom'
    );

    const counts = await OutboxStore.getCounts(db);
    expect(counts).toEqual({ pending: 3, failed: 2, processing: 0, total: 5 });
  });

  it('getAllRecords filters, orders and paginates in SQL', async () => {
    for (let i = 0; i < 6; i++) {
      await client.insert('todos', { id: `t-${i}`, title: `Task ${i}` }, { customTimestamp: 1000 + i });
    }

    const all = await client.getOutboxRecords();
    expect(all.map((r) => r.rowId)).toEqual(['t-5', 't-4', 't-3', 't-2', 't-1', 't-0']);
    expect(all[0].payload).toEqual({ id: 't-5', title: 'Task 5' });

    const page = await client.getOutboxRecords({ limit: 2, offset: 1 });
    expect(page.map((r) => r.rowId)).toEqual(['t-4', 't-3']);

    const offsetOnly = await client.getOutboxRecords({ offset: 4 });
    expect(offsetOnly.map((r) => r.rowId)).toEqual(['t-1', 't-0']);

    await OutboxStore.markFailed(db, [all[2].id], 'boom');
    const failed = await client.getOutboxRecords({ status: 'FAILED' });
    expect(failed.map((r) => r.rowId)).toEqual(['t-3']);
  });

  it('findById uses a primary-key lookup and tolerates missing tables', async () => {
    await client.insert('todos', { id: 'a', title: 'Alpha' });
    await client.insert('todos', { id: 'b', title: 'Beta' });

    expect(await client.findById('todos', 'b')).toMatchObject({ id: 'b', title: 'Beta' });
    expect(await client.findById('todos', 'zzz')).toBeNull();
    expect(await client.findById('does_not_exist', 'a')).toBeNull();
  });

  it('emits remote change events only after the delta transaction commits', async () => {
    const seen: Array<{ rowId: string; visible: boolean }> = [];
    let pendingChecks: Promise<void>[] = [];
    client.events.on('todos', (e) => {
      // A listener querying from the event must observe committed data.
      pendingChecks.push(
        client.findById('todos', e.rowId).then((row) => {
          seen.push({ rowId: e.rowId, visible: row !== null });
        })
      );
    });

    await client.syncWorker.applyDeltasLocally({
      timestamp: 5000,
      changes: [
        { tableName: 'todos', operation: 'UPDATE', rowId: 'r-1', payload: { id: 'r-1', title: 'One' } },
        { tableName: 'todos', operation: 'UPDATE', rowId: 'r-2', payload: { id: 'r-2', title: 'Two' } },
      ],
    });
    await Promise.all(pendingChecks);

    expect(seen).toEqual([
      { rowId: 'r-1', visible: true },
      { rowId: 'r-2', visible: true },
    ]);
    expect(await client.getLastSyncedAt()).toBe(5000);
  });

  it('emits no remote change events when the delta transaction rolls back', async () => {
    const events: string[] = [];
    client.events.on('todos', (e) => events.push(e.rowId));

    // A function value cannot be bound by SQLite, failing the second write mid-transaction.
    await expect(
      client.syncWorker.applyDeltasLocally({
        timestamp: 9000,
        changes: [
          { tableName: 'todos', operation: 'UPDATE', rowId: 'ok-1', payload: { id: 'ok-1', title: 'Ok' } },
          { tableName: 'todos', operation: 'UPDATE', rowId: 'bad', payload: { id: 'bad', title: (() => 1) as any } },
        ],
      })
    ).rejects.toThrow();

    expect(events).toEqual([]);
    expect(await client.findById('todos', 'ok-1')).toBeNull();
    expect(await client.getLastSyncedAt()).toBe(0);
  });

  it('reset({ dropTables }) drops sync_meta and lets autoSchema recreate tables', async () => {
    await client.insert('todos', { id: 'a', title: 'Alpha' });
    await client.reset({ dropTables: true });

    const tables = (await db.execute(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map(
      (r: any) => r.name
    );
    expect(tables).not.toContain('sync_meta');
    expect(tables).not.toContain('todos');

    await client.initialize();
    await client.insert('todos', { id: 'b', title: 'Beta' });
    expect(await client.findById('todos', 'b')).toMatchObject({ id: 'b' });
  });

  it('drains an outbox backlog in consecutive batches without waiting for the push interval', async () => {
    const remote = new MemoryDemoRemoteAdapter(0);
    const draining = new LocalFirstClient({
      local: new NodeSQLiteAdapter(new DatabaseSync(':memory:')),
      remote,
      network: new DefaultNetworkStatusProvider(true),
      autoSchema: true,
      pushIntervalMs: 60_000, // interval far beyond the test window
      pullIntervalMs: 60_000,
      logger: false,
    });
    await draining.initialize();

    const records = Array.from({ length: 120 }, (_, i) => ({ id: `d-${i}`, title: `Item ${i}` }));
    await draining.insertMany('todos', records);

    const deadline = Date.now() + 2000;
    while (remote.allPushedOperations.length < 120 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(remote.allPushedOperations).toHaveLength(120);
    expect(remote.pushedBatches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect((await draining.getMetrics()).outboxPendingCount).toBe(0);
    await draining.close();
  });
});
