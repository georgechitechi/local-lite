import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BetterSQLite3Adapter } from '../src/adapters/local/better-sqlite3.js';
import { ExpoSQLiteAdapter } from '../src/adapters/local/expo-sqlite.js';
import { LibSQLAdapter } from '../src/adapters/local/libsql.js';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';
import { OpSQLiteAdapter } from '../src/adapters/local/op-sqlite.js';
import { SqlJsAdapter } from '../src/adapters/local/sql-js.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { resolveLocalAdapter } from '../src/config/resolve-local.js';
import { EventEmitter } from '../src/reactive/event-emitter.js';
import { MemoryFileDriver, NodeFileDriver } from '../src/storage/driver.js';

describe('Core utilities, drivers, network & adapter resolution', () => {
  it('EventEmitter handles subscriptions, errors, and BroadcastChannel cross-tab sync', () => {
    const emitter = new EventEmitter();
    const received: unknown[] = [];

    const unsub1 = emitter.on('todos', (d) => received.push(d));
    emitter.on('todos', () => {
      throw new Error('listener boom');
    });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitter.emit('todos', { id: '1' });
    expect(received).toEqual([{ id: '1' }]);
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();

    unsub1();
    emitter.emit('todos', { id: '2' });
    expect(received).toEqual([{ id: '1' }]);

    // Mock BroadcastChannel for cross-tab bridging
    const posted: unknown[] = [];
    let closed = false;
    const channels: MockBroadcastChannel[] = [];
    class MockBroadcastChannel {
      onmessage?: (ev: MessageEvent) => void;
      constructor(public name: string) {
        channels.push(this);
      }
      postMessage(msg: unknown) {
        posted.push(msg);
      }
      close() {
        closed = true;
      }
    }

    (globalThis as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel;
    try {
      const stopCrossTab = emitter.enableCrossTab('test-channel');
      const remoteEvents: unknown[] = [];
      emitter.on('notes', (d) => remoteEvents.push(d));

      emitter.emit('notes', { id: 'n1' });
      expect(posted).toHaveLength(1);

      // Simulate message from another tab
      channels[0]?.onmessage?.({
        data: { sourceTabId: 'other-tab', event: 'notes', data: { id: 'n2' } },
      } as MessageEvent);
      expect(remoteEvents).toEqual([{ id: 'n1' }, { id: 'n2' }]);

      stopCrossTab();
      expect(closed).toBe(true);
    } finally {
      delete (globalThis as Record<string, unknown>).BroadcastChannel;
    }
  });

  it('DefaultNetworkStatusProvider tracks online status and listener lifecycle', () => {
    const provider = new DefaultNetworkStatusProvider(false);
    expect(provider.isOnline()).toBe(false);

    const states: boolean[] = [];
    const unsub = provider.subscribe((online) => states.push(online));
    provider.subscribe(() => {
      throw new Error('network listener error');
    });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    provider.setOnline(true);
    provider.setOnline(true); // No-op when unchanged
    expect(states).toEqual([true]);
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();

    unsub();
    provider.setOnline(false);
    expect(states).toEqual([true]);
    provider.destroy();
  });

  it('MemoryFileDriver and NodeFileDriver support write, read, exists, and delete', async () => {
    const mem = new MemoryFileDriver();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const uri = await mem.write('a.bin', bytes);
    expect(uri).toBe('memory://a.bin');
    expect(await mem.exists('a.bin')).toBe(true);
    expect(await mem.read('a.bin')).toEqual(bytes);
    expect(await mem.read('missing.bin')).toBeNull();
    await mem.delete('a.bin');
    expect(await mem.exists('a.bin')).toBe(false);
    await mem.write('b.bin', bytes);
    mem.clear();
    expect(await mem.exists('b.bin')).toBe(false);

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'local-lite-driver-'));
    try {
      const nodeDriver = new NodeFileDriver(tempDir);
      const writtenPath = await nodeDriver.write('sub/file.bin', bytes);
      expect(writtenPath).toContain('file.bin');
      expect(await nodeDriver.exists('sub/file.bin')).toBe(true);
      expect(await nodeDriver.read('sub/file.bin')).toEqual(bytes);
      expect(await nodeDriver.read('missing.bin')).toBeNull();
      await nodeDriver.delete('sub/file.bin');
      await nodeDriver.delete('missing.bin');
      expect(await nodeDriver.exists('sub/file.bin')).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolveLocalAdapter detects all supported SQLite drivers', async () => {
    const libsql = await resolveLocalAdapter({
      database: { batch: async () => [], execute: async () => ({ rows: [] }) },
      tables: ['todos'],
    });
    expect(libsql).toBeInstanceOf(LibSQLAdapter);

    const sqljs = await resolveLocalAdapter({
      database: { export: () => new Uint8Array(), exec: () => [] },
      tables: ['todos'],
    });
    expect(sqljs).toBeInstanceOf(SqlJsAdapter);

    const customDb = { execute: async () => [], transaction: async (fn: any) => fn(customDb) };
    const custom = await resolveLocalAdapter({
      database: () => customDb,
      tables: ['todos'],
    });
    expect(custom).toBe(customDb);

    const expo = await resolveLocalAdapter({
      database: { getAllAsync: async () => [], runAsync: async () => ({}) },
      tables: ['todos'],
    });
    expect(expo).toBeInstanceOf(ExpoSQLiteAdapter);

    const op = await resolveLocalAdapter({
      database: { executeAsync: async () => ({ rows: { _array: [] } }) },
      tables: ['todos'],
    });
    expect(op).toBeInstanceOf(OpSQLiteAdapter);

    const better = await resolveLocalAdapter({
      database: { prepare: () => ({}), pragma: () => {} },
      tables: ['todos'],
    });
    expect(better).toBeInstanceOf(BetterSQLite3Adapter);

    const nodeSqlite = await resolveLocalAdapter({
      database: { prepare: () => ({}), exec: () => {} },
      tables: ['todos'],
    });
    expect(nodeSqlite).toBeInstanceOf(NodeSQLiteAdapter);

    const fallbackPrepare = await resolveLocalAdapter({
      database: { prepare: () => ({}) },
      tables: ['todos'],
    });
    expect(fallbackPrepare).toBeInstanceOf(BetterSQLite3Adapter);

    await expect(resolveLocalAdapter({ tables: ['todos'] })).rejects.toThrow();
  });

  it('executes queries and transactions across BetterSQLite3, OpSQLite, LibSQL, and SqlJs adapters', async () => {
    // 1. BetterSQLite3Adapter
    const betterExecuted: string[] = [];
    const better = new BetterSQLite3Adapter({
      prepare: (sql: string) => ({
        all: () => (sql.startsWith('SELECT') ? [{ id: '1' }] : []),
        run: () => {
          betterExecuted.push(sql);
          return { changes: 1 };
        },
      }),
      transaction: (fn: () => unknown) => () => fn(),
      close: () => betterExecuted.push('CLOSE'),
    });
    expect(await better.execute('SELECT * FROM todos', [1])).toEqual([{ id: '1' }]);
    await better.transaction(async (tx) => {
      await tx.execute('INSERT INTO todos VALUES (?)', ['1']);
    });
    await better.close();
    expect(betterExecuted).toContain('CLOSE');

    // 2. OpSQLiteAdapter
    const opExecuted: string[] = [];
    const op = new OpSQLiteAdapter({
      executeAsync: async (sql: string) => {
        opExecuted.push(sql);
        return { rows: { _array: [{ id: '2' }] } };
      },
      transactionAsync: async (
        fn: (tx: { executeAsync: (s: string) => Promise<unknown> }) => Promise<void>,
      ) => fn({ executeAsync: async (s: string) => opExecuted.push(s) }),
      close: () => opExecuted.push('CLOSE'),
    });
    expect(await op.execute('SELECT * FROM todos')).toEqual([{ id: '2' }]);
    await op.transaction(async (tx) => {
      await tx.execute('DELETE FROM todos');
    });
    await op.close();
    expect(opExecuted).toContain('CLOSE');

    // 3. LibSQLAdapter (object rows + tuple rows + transaction rollback)
    let rolledBack = false;
    const libsql = new LibSQLAdapter({
      execute: async ({ sql }: { sql: string }) => {
        if (sql.includes('tuple')) {
          return { columns: ['id', 'title'], rows: [['t1', 'Hello']] };
        }
        return { columns: ['id'], rows: [{ id: 'o1' }] };
      },
      transaction: async () => ({
        execute: async () => ({ columns: [], rows: [] }),
        commit: async () => {},
        rollback: async () => {
          rolledBack = true;
        },
      }),
    });
    expect(await libsql.execute('SELECT tuple')).toEqual([{ id: 't1', title: 'Hello' }]);
    expect(await libsql.execute('SELECT obj')).toEqual([{ id: 'o1' }]);
    await expect(
      libsql.transaction(async () => {
        throw new Error('tx abort');
      }),
    ).rejects.toThrow('tx abort');
    expect(rolledBack).toBe(true);

    // 4. SqlJsAdapter (exec without params + prepared with params + transaction rollback)
    const sqljsLog: string[] = [];
    let stepCalls = 0;
    const sqljs = new SqlJsAdapter({
      exec: (sql: string) => {
        sqljsLog.push(sql);
        return [{ columns: ['id'], values: [['s1']] }];
      },
      run: (sql: string) => {
        sqljsLog.push(sql);
      },
      prepare: () => ({
        bind: () => true,
        step: () => stepCalls++ === 0,
        getAsObject: () => ({ id: 's2' }),
        free: () => true,
      }),
      close: () => sqljsLog.push('CLOSE'),
    });
    expect(await sqljs.execute('SELECT * FROM todos')).toEqual([{ id: 's1' }]);
    expect(await sqljs.execute('SELECT * FROM todos WHERE id = ?', ['s2'])).toEqual([{ id: 's2' }]);
    await sqljs.transaction(async (tx) => {
      await tx.execute('INSERT INTO todos VALUES (?)', ['s3']);
    });
    await expect(
      sqljs.transaction(async () => {
        throw new Error('sqljs abort');
      }),
    ).rejects.toThrow('sqljs abort');
    expect(sqljsLog).toContain('COMMIT;');
    expect(sqljsLog).toContain('ROLLBACK;');
    await sqljs.close();
    expect(sqljsLog).toContain('CLOSE');
  });
});
