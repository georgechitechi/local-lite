import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncClient, resolveRemoteAdapter } from '../src/config/index.js';
import { LocalFirstClient } from '../src/core/index.js';
import { MemoryDemoRemoteAdapter, NoopRemoteAdapter } from '../src/adapters/remote/demo.js';
import { MockDB } from './helpers/mock-db.js';

const clients: LocalFirstClient[] = [];
afterEach(() => {
  clients.splice(0).forEach(client => client.stop());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('explicit configuration and initialization', () => {
  it('requires a backend unless a temporary demo is explicitly selected', async () => {
    await expect(resolveRemoteAdapter({})).rejects.toThrow('No remote adapter configured');
    await expect(resolveRemoteAdapter({ inMemoryRemote: false })).rejects.toThrow();
    await expect(resolveRemoteAdapter({ inMemoryRemote: true })).resolves.toBeInstanceOf(MemoryDemoRemoteAdapter);
    await expect(resolveRemoteAdapter({ localOnly: true })).resolves.toBeInstanceOf(NoopRemoteAdapter);
    const remote = new MemoryDemoRemoteAdapter(0);
    await expect(resolveRemoteAdapter({ remote })).resolves.toBe(remote);
  });

  it('does not modify application schemas implicitly', async () => {
    const db = new MockDB();
    const execute = vi.spyOn(db, 'execute');
    const client = await createSyncClient({ database: db, remote: new MemoryDemoRemoteAdapter(0),
      tables: ['notes'], autoStart: false, logger: false });
    clients.push(client);
    expect(client.autoSchema).toBe(false);
    expect(execute.mock.calls.some(([sql]) => /CREATE TABLE.*notes/.test(sql))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS sync_outbox'))).toBe(true);
  });

  it('queues mutations without automatic sync and still permits manual push', async () => {
    vi.useFakeTimers();
    const remote = new MemoryDemoRemoteAdapter(0);
    const push = vi.spyOn(remote, 'pushChanges');
    const pull = vi.spyOn(remote, 'fetchChanges');
    const subscribe = vi.spyOn(remote, 'subscribeToLiveChanges');
    const client = await createSyncClient({ database: new MockDB(), remote,
      autoStart: false, logger: false });
    clients.push(client);
    await client.insert('notes', { id: 'one', title: 'Queued' });
    await vi.advanceTimersByTimeAsync(60000);
    expect(push).not.toHaveBeenCalled();
    expect(pull).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(await client.getOutboxRecords()).toHaveLength(1);
    await client.syncWorker.pushLocalChanges();
    expect(push).toHaveBeenCalledTimes(1);
    expect(await client.getOutboxRecords()).toHaveLength(0);
  });

  it('runs deferred migrations before sync and initializes only once', async () => {
    const db = new MockDB();
    const remote = new MemoryDemoRemoteAdapter(0);
    const execute = vi.spyOn(db, 'execute');
    const client = await createSyncClient({ database: db, remote, autoInitialize: false,
      migrations: ['CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY)'], logger: false });
    clients.push(client);
    expect(execute).not.toHaveBeenCalled();
    const start = vi.spyOn(client.syncWorker, 'start').mockImplementation(() => {
      expect(execute.mock.calls.some(([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS notes'))).toBe(true);
    });
    await Promise.all([client.initialize(), client.initialize()]);
    await client.initialize();
    expect(start).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls.filter(([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS notes'))).toHaveLength(1);
  });

  it('applies versioned schema migrations in order and records each version once', async () => {
    const db = new MockDB();
    const execute = vi.spyOn(db, 'execute');
    const client = await createSyncClient({
      database: db,
      remote: new MemoryDemoRemoteAdapter(0),
      autoInitialize: false,
      schemaMigrations: [
        { version: 2, up: 'ALTER TABLE todos ADD COLUMN completed INTEGER NOT NULL DEFAULT 0' },
        { version: 1, up: 'CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)' },
      ],
      logger: false,
    });
    clients.push(client);

    await client.initialize();
    const restartedClient = await createSyncClient({
      database: db,
      remote: new MemoryDemoRemoteAdapter(0),
      autoInitialize: false,
      autoStart: false,
      schemaMigrations: [
        { version: 2, up: 'ALTER TABLE todos ADD COLUMN completed INTEGER NOT NULL DEFAULT 0' },
        { version: 1, up: 'CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)' },
      ],
      logger: false,
    });
    clients.push(restartedClient);
    await restartedClient.initialize();

    const migrationStatements = execute.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.includes('todos'));
    expect(migrationStatements).toEqual([
      'CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)',
      'ALTER TABLE todos ADD COLUMN completed INTEGER NOT NULL DEFAULT 0',
    ]);
    expect(db.getAll('schema_migrations').map((row) => row.version)).toEqual([1, 2]);
  });

  it('rolls back failed versioned migrations and retries them during initialization', async () => {
    const db = new MockDB();
    const execute = db.execute.bind(db);
    let fail = true;
    vi.spyOn(db, 'execute').mockImplementation(async (sql, params) => {
      if (sql === 'versioned migration' && fail) throw new Error('versioned migration failed');
      return execute(sql, params);
    });
    const client = new LocalFirstClient({
      local: db,
      remote: new MemoryDemoRemoteAdapter(0),
      schemaMigrations: [{ version: 1, up: 'versioned migration' }],
      logger: false,
    });
    clients.push(client);

    await expect(client.initialize()).rejects.toThrow('versioned migration failed');
    expect(db.getAll('schema_migrations')).toEqual([]);
    fail = false;
    await client.initialize();
    expect(db.getAll('schema_migrations').map((row) => row.version)).toEqual([1]);
  });

  it('rejects gaps in configured schema migration versions', async () => {
    await expect(createSyncClient({
      database: new MockDB(),
      remote: new MemoryDemoRemoteAdapter(0),
      schemaMigrations: [{ version: 2, up: 'ALTER TABLE todos ADD COLUMN title TEXT' }],
      logger: false,
    })).rejects.toThrow('consecutive integer versions starting at 1');
  });

  it('does not start sync on migration failure and allows initialization to retry', async () => {
    const db = new MockDB();
    const execute = db.execute.bind(db);
    let fail = true;
    vi.spyOn(db, 'execute').mockImplementation(async (sql, params) => {
      if (sql === 'migration' && fail) throw new Error('migration failed');
      return execute(sql, params);
    });
    const client = new LocalFirstClient({ local: db, remote: new MemoryDemoRemoteAdapter(0),
      migrations: ['migration'], logger: false });
    clients.push(client);
    const start = vi.spyOn(client.syncWorker, 'start').mockImplementation(() => {});
    await expect(client.initialize()).rejects.toThrow('migration failed');
    expect(start).not.toHaveBeenCalled();
    fail = false;
    await client.initialize();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('stop prevents later mutations from restarting automatic pushes', async () => {
    vi.useFakeTimers();
    const remote = new MemoryDemoRemoteAdapter(0);
    const client = await createSyncClient({ database: new MockDB(), remote, logger: false });
    clients.push(client);
    client.stop();
    const push = vi.spyOn(remote, 'pushChanges');
    await client.insert('notes', { id: 'one' });
    await vi.advanceTimersByTimeAsync(60000);
    expect(push).not.toHaveBeenCalled();
    client.syncWorker.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(push).toHaveBeenCalled();
  });
});
