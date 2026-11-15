import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';
import { LocalFirstClient } from '../src/core/client.js';
import { SelfHostedRemoteAdapter } from '../src/adapters/remote/self-hosted.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { SQLiteServerSyncStorage } from '../src/server/sync.js';

describe('Next-level hardening', () => {
  describe('AbortSignal propagation', () => {
    it('aborts SelfHostedRemoteAdapter fetch when SyncWorker requestTimeoutMs elapses', async () => {
      const raw = new DatabaseSync(':memory:');
      const db = new NodeSQLiteAdapter(raw);

      let capturedSignal: AbortSignal | undefined;
      const hangingFetch: typeof fetch = (_input, init) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      };

      const remote = new SelfHostedRemoteAdapter({
        url: 'https://sync.example.com/api/sync',
        tables: ['todos'],
        fetch: hangingFetch,
      });

      const client = new LocalFirstClient({
        local: db,
        remote,
        network: new DefaultNetworkStatusProvider(true),
        autoSchema: true,
        tables: ['todos'],
        autoStart: false,
        requestTimeoutMs: 40,
        retry: { maxRetries: 0 },
        logger: false,
      });

      await client.initialize();
      await client.insert('todos', { id: 't1', title: 'Test' });

      await client.syncWorker.pushLocalChanges();

      expect(capturedSignal).toBeDefined();
      expect(capturedSignal?.aborted).toBe(true);
      await client.close();
    });

    it('aborts in-flight fetch when SyncWorker.stop() is called', async () => {
      const raw = new DatabaseSync(':memory:');
      const db = new NodeSQLiteAdapter(raw);

      let capturedSignal: AbortSignal | undefined;
      const hangingFetch: typeof fetch = (_input, init) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      };

      const remote = new SelfHostedRemoteAdapter({
        url: 'https://sync.example.com/api/sync',
        tables: ['todos'],
        fetch: hangingFetch,
      });

      const client = new LocalFirstClient({
        local: db,
        remote,
        network: new DefaultNetworkStatusProvider(true),
        autoSchema: true,
        tables: ['todos'],
        autoStart: false,
        requestTimeoutMs: 10000,
        logger: false,
      });

      await client.initialize();
      const pullPromise = client.syncWorker.pullRemoteChanges();
      await new Promise((r) => setTimeout(r, 15));
      client.syncWorker.stop();
      await pullPromise;

      expect(capturedSignal?.aborted).toBe(true);
      await client.close();
    });
  });

  describe('SQLiteServerSyncStorage', () => {
    let raw: DatabaseSync;
    let db: NodeSQLiteAdapter;
    let storage: SQLiteServerSyncStorage;

    beforeEach(() => {
      raw = new DatabaseSync(':memory:');
      db = new NodeSQLiteAdapter(raw);
      storage = new SQLiteServerSyncStorage(db);
    });

    afterEach(() => {
      db.close();
    });

    it('persists operations with LWW and supports keyset hasMore pagination', async () => {
      const res1 = await storage.applyOperations(
        [
          {
            id: 'op-1',
            tableName: 'todos',
            rowId: 't1',
            operation: 'INSERT',
            payload: { title: 'First', done: false },
            timestamp: 1000,
          },
          {
            id: 'op-2',
            tableName: 'todos',
            rowId: 't2',
            operation: 'INSERT',
            payload: { title: 'Second', done: false },
            timestamp: 1001,
          },
          {
            id: 'op-3',
            tableName: 'todos',
            rowId: 't3',
            operation: 'INSERT',
            payload: { title: 'Third', done: false },
            timestamp: 1002,
          },
        ],
        2000,
      );

      expect(res1.applied).toBe(3);
      expect(res1.successfulIds).toEqual(['op-1', 'op-2', 'op-3']);

      // Older timestamp should not overwrite newer server record (LWW)
      const stale = await storage.applyOperations(
        [
          {
            id: 'op-stale',
            tableName: 'todos',
            rowId: 't1',
            operation: 'UPDATE',
            payload: { title: 'Stale' },
            timestamp: 1500,
          },
        ],
        1500,
      );
      expect(stale.applied).toBe(0);
      expect(stale.successfulIds).toEqual(['op-stale']);

      // Paginated keyset pull (limit 2 of 3)
      const page1 = await storage.getDeltas(['todos'], 0, 2);
      expect(page1.hasMore).toBe(true);
      expect(page1.changes.hasMore).toBe(true);
      expect(page1.changes.changes.map((c) => c.rowId)).toEqual(['t1', 't2']);

      // Re-instantiate storage on the same SQLite DB to verify persistence
      const storage2 = new SQLiteServerSyncStorage(db);
      const page2 = await storage2.getDeltas(['todos'], 2, 2);
      expect(page2.hasMore).toBe(false);
      expect(page2.changes.changes.map((c) => c.rowId)).toEqual(['t3']);
    });

    it('compacts older changelog entries cleanly', async () => {
      await storage.applyOperations(
        [
          {
            id: 'op-1',
            tableName: 'todos',
            rowId: 't1',
            operation: 'INSERT',
            payload: { title: '1' },
            timestamp: 1000,
          },
          {
            id: 'op-2',
            tableName: 'todos',
            rowId: 't2',
            operation: 'INSERT',
            payload: { title: '2' },
            timestamp: 1001,
          },
          {
            id: 'op-3',
            tableName: 'todos',
            rowId: 't3',
            operation: 'INSERT',
            payload: { title: '3' },
            timestamp: 1002,
          },
        ],
        1002,
      );

      await storage.compactChangeLog(1);
      const rows = await db.execute(`SELECT * FROM _sync_server_changelog`);
      expect(rows.length).toBe(1);
      expect(rows[0].row_id).toBe('t3');
    });
  });
});
