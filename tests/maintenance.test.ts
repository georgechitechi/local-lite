import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { LocalFirstClient } from '../src/core/client.js';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';

describe('Database Maintenance & Outbox Pruning', () => {
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
      tables: ['tasks'],
      autoStart: false,
      logger: false,
    });
    await client.initialize();
  });

  afterEach(async () => {
    await client.close();
  });

  it('runs vacuum() without error', async () => {
    await expect(client.maintenance.vacuum()).resolves.toBeUndefined();
  });

  it('runs checkpoint() with different modes', async () => {
    await expect(client.maintenance.checkpoint('PASSIVE')).resolves.toBeUndefined();
    await expect(client.maintenance.checkpoint('TRUNCATE')).resolves.toBeUndefined();
  });

  it('reports accurate storage stats including table counts and outbox breakdown', async () => {
    await client.insert('tasks', { id: 't1', title: 'Task 1', done: 0 });
    await client.insert('tasks', { id: 't2', title: 'Task 2', done: 1 });

    const stats = await client.maintenance.getStorageStats();

    expect(stats.tables.tasks).toBe(2);
    expect(stats.outbox.total).toBe(2);
    expect(stats.outbox.pending).toBe(2);
    expect(stats.pageSize).toBeGreaterThan(0);
    expect(stats.pageCount).toBeGreaterThan(0);
    expect(stats.databaseSizeBytes).toBe(stats.pageSize * stats.pageCount);
  });

  it('prunes outbox mutations by retention days and beforeTimestamp', async () => {
    const now = Date.now();
    const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;

    // Insert mock completed & failed outbox records directly into sync_outbox
    await db.execute(
      `INSERT INTO sync_outbox (id, table_name, row_id, operation, payload, timestamp, status, retry_count)
       VALUES 
       ('ob-old-completed', 'tasks', 't-old', 'UPDATE', '{}', ?, 'COMPLETED', 0),
       ('ob-old-failed', 'tasks', 't-fail', 'UPDATE', '{}', ?, 'FAILED', 5),
       ('ob-recent-completed', 'tasks', 't-recent', 'UPDATE', '{}', ?, 'COMPLETED', 0),
       ('ob-pending', 'tasks', 't-pending', 'UPDATE', '{}', ?, 'PENDING', 0)`,
      [tenDaysAgo, tenDaysAgo, twoDaysAgo, tenDaysAgo],
    );

    // Prune entries older than 7 days (default statuses: COMPLETED, FAILED)
    const prunedCount = await client.maintenance.pruneOutbox({ retentionDays: 7 });

    // Should have pruned the 10-day old COMPLETED and FAILED records (2 records)
    // The recent COMPLETED record and the pending record must remain intact!
    expect(prunedCount).toBe(2);

    const remaining = await db.execute(`SELECT id FROM sync_outbox ORDER BY id ASC`);
    const remainingIds = remaining.map((r: any) => r.id);

    expect(remainingIds).toContain('ob-pending');
    expect(remainingIds).toContain('ob-recent-completed');
    expect(remainingIds).not.toContain('ob-old-completed');
    expect(remainingIds).not.toContain('ob-old-failed');
  });

  it('prunes oldest records when maxEntries threshold is exceeded', async () => {
    const now = Date.now();
    for (let i = 1; i <= 10; i++) {
      await db.execute(
        `INSERT INTO sync_outbox (id, table_name, row_id, operation, payload, timestamp, status, retry_count)
         VALUES (?, 'tasks', ?, 'UPDATE', '{}', ?, 'COMPLETED', 0)`,
        [`ob-${i}`, `row-${i}`, now + i * 1000],
      );
    }

    // Keep max 4 completed entries -> should prune 6 oldest entries (ob-1 to ob-6)
    const pruned = await client.maintenance.pruneOutbox({
      maxEntries: 4,
      statuses: ['COMPLETED'],
    });

    expect(pruned).toBe(6);

    const remaining = await db.execute(`SELECT id FROM sync_outbox ORDER BY timestamp ASC`);
    expect(remaining.length).toBe(4);
    expect(remaining.map((r: any) => r.id)).toEqual(['ob-7', 'ob-8', 'ob-9', 'ob-10']);
  });
});
