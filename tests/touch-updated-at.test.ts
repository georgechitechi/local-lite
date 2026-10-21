import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { LocalFirstClient } from '../src/core/client.js';
import { OutboxStore } from '../src/core/outbox-store.js';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';

/**
 * Local writes must bump `updated_at` so reactive queries (which compare rows by
 * id + updated_at) re-render after offline edits, without altering remote payloads.
 */
describe('touchUpdatedAt (local updated_at stamping)', () => {
  let client: LocalFirstClient;

  async function makeClient(opts: {
    autoSchema?: boolean;
    migrations?: string[];
    touchUpdatedAt?: boolean | string;
  }) {
    const db = new NodeSQLiteAdapter(new DatabaseSync(':memory:'));
    client = new LocalFirstClient({
      local: db,
      remote: new MemoryDemoRemoteAdapter(0),
      network: new DefaultNetworkStatusProvider(false),
      autoSchema: opts.autoSchema ?? false,
      tables: ['receipts'],
      migrations: opts.migrations,
      autoStart: false,
      logger: false,
      touchUpdatedAt: opts.touchUpdatedAt,
    });
    await client.initialize();
    return db;
  }

  const getRow = async (db: NodeSQLiteAdapter, id: string) =>
    (await db.execute(`SELECT * FROM receipts WHERE id = ?`, [id]))[0];

  afterEach(async () => {
    await client?.close();
  });

  it('bumps updated_at on update even when the payload omits it', async () => {
    const db = await makeClient({ autoSchema: true });
    await client.insert('receipts', {
      id: 'r1',
      amount: 100,
      updated_at: '2020-01-01T00:00:00.000Z',
    });
    expect((await getRow(db, 'r1')).updated_at).toBe('2020-01-01T00:00:00.000Z');

    await client.update('receipts', 'r1', { amount: 250 }, { customTimestamp: Date.UTC(2030, 0, 1) });
    const row = await getRow(db, 'r1');
    expect(row.amount).toBe(250);
    expect(row.updated_at).toBe('2030-01-01T00:00:00.000Z');
  });

  it('overrides a stale updated_at spread into an update payload', async () => {
    const db = await makeClient({ autoSchema: true });
    await client.insert('receipts', { id: 'r1', amount: 1, updated_at: '2020-01-01T00:00:00.000Z' });
    const stale = await getRow(db, 'r1');
    await client.update('receipts', 'r1', { ...stale, amount: 2 });
    expect((await getRow(db, 'r1')).updated_at).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('keeps an explicit updated_at on insert and stamps one when missing', async () => {
    const db = await makeClient({ autoSchema: true });
    await client.insert('receipts', { id: 'a', updated_at: '2021-05-05T00:00:00.000Z' });
    await client.insert('receipts', { id: 'b' });
    expect((await getRow(db, 'a')).updated_at).toBe('2021-05-05T00:00:00.000Z');
    expect((await getRow(db, 'b')).updated_at).toEqual(expect.any(String));
  });

  it('stamps on updateMany, batch and transaction paths', async () => {
    const db = await makeClient({ autoSchema: true });
    const old = '2020-01-01T00:00:00.000Z';
    await client.insertMany('receipts', [
      { id: 'm1', updated_at: old },
      { id: 'm2', updated_at: old },
      { id: 'm3', updated_at: old },
    ]);

    await client.updateMany('receipts', [{ id: 'm1', payload: { amount: 1 } }]);
    await client.batch([{ tableName: 'receipts', rowId: 'm2', operation: 'UPDATE', payload: { amount: 2 } }]);
    await client.transaction(async (tx) => {
      await tx.update('receipts', 'm3', { amount: 3 });
    });

    for (const id of ['m1', 'm2', 'm3']) {
      expect((await getRow(db, id)).updated_at).not.toBe(old);
    }
  });

  it('does not alter the outbox payload sent to the remote', async () => {
    const db = await makeClient({ autoSchema: true });
    await client.update('receipts', 'r1', { amount: 5 });
    const pending = await OutboxStore.getPending(db as any, 10);
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ amount: 5 });
  });

  it('skips stamping when the column does not exist on a manual schema', async () => {
    const db = await makeClient({
      migrations: ['CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, amount REAL);'],
    });
    await client.insert('receipts', { id: 'r1', amount: 1 });
    await client.update('receipts', 'r1', { amount: 2 });
    const row = await getRow(db, 'r1');
    expect(row.amount).toBe(2);
    expect(row).not.toHaveProperty('updated_at');
  });

  it('stamps on a manual schema that has the column', async () => {
    const db = await makeClient({
      migrations: [
        'CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, amount REAL, updated_at TEXT);',
      ],
    });
    await client.insert('receipts', { id: 'r1', amount: 1, updated_at: '2020-01-01T00:00:00.000Z' });
    await client.update('receipts', 'r1', { amount: 2 });
    expect((await getRow(db, 'r1')).updated_at).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('supports a custom column name and can be disabled', async () => {
    let db = await makeClient({ autoSchema: true, touchUpdatedAt: 'modified_at' });
    await client.update('receipts', 'r1', { amount: 1 });
    let row = await getRow(db, 'r1');
    expect(row.modified_at).toEqual(expect.any(String));
    expect(row).not.toHaveProperty('updated_at');
    await client.close();

    db = await makeClient({ autoSchema: true, touchUpdatedAt: false });
    await client.update('receipts', 'r1', { amount: 1 });
    row = await getRow(db, 'r1');
    expect(row).not.toHaveProperty('updated_at');
  });
});
