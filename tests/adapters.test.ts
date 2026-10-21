import { describe, it, expect, vi } from 'vitest';
import {
  OpSQLiteAdapter,
  BetterSQLite3Adapter,
  LibSQLAdapter,
  SqlJsAdapter,
  NodeSQLiteAdapter,
  ExpoSQLiteAdapter,
} from '../src/adapters/local/index.js';
import { detectSQLiteType } from '../src/core/schema-manager.js';

describe('Multi-Driver SQLite Adapters', () => {
  it('detects SQLite column types accurately from JavaScript values', () => {
    expect(detectSQLiteType(42)).toBe('INTEGER');
    expect(detectSQLiteType(true)).toBe('INTEGER');
    expect(detectSQLiteType(3.14159)).toBe('REAL');
    expect(detectSQLiteType('hello')).toBe('TEXT');
    expect(detectSQLiteType({ foo: 'bar' })).toBe('TEXT');
    expect(detectSQLiteType(new Uint8Array([1, 2, 3]))).toBe('BLOB');
  });

  it('OpSQLiteAdapter normalizes rows from @op-engineering/op-sqlite', async () => {
    const mockOpDb = {
      async executeAsync() {
        return { rows: { _array: [{ id: 'op-1', title: 'Op Item' }] } };
      },
    };
    const adapter = new OpSQLiteAdapter(mockOpDb);
    const rows = await adapter.execute('SELECT * FROM test');
    expect(rows).toEqual([{ id: 'op-1', title: 'Op Item' }]);
  });

  it('BetterSQLite3Adapter executes queries safely', async () => {
    const mockBetterDb = {
      prepare() {
        return {
          all: () => [{ id: 'b3-1', title: 'Better Item' }],
          run: () => ({ changes: 1 }),
        };
      },
      transaction: (fn: any) => fn,
    };
    const adapter = new BetterSQLite3Adapter(mockBetterDb);
    const rows = await adapter.execute('SELECT * FROM test');
    expect(rows).toEqual([{ id: 'b3-1', title: 'Better Item' }]);
  });

  it('LibSQLAdapter maps columns and rows from Turso / @libsql/client', async () => {
    const mockLibSql = {
      async execute() {
        return {
          columns: ['id', 'name'],
          rows: [['lib-1', 'Alice'], ['lib-2', 'Bob']],
        };
      },
      async batch() {
        return [];
      },
    };
    const adapter = new LibSQLAdapter(mockLibSql);
    const rows = await adapter.execute('SELECT * FROM users');
    expect(rows).toEqual([
      { id: 'lib-1', name: 'Alice' },
      { id: 'lib-2', name: 'Bob' },
    ]);
  });

  it('SqlJsAdapter executes WebAssembly SQL queries', async () => {
    const mockSqlJs = {
      exec() {
        return [{ columns: ['id', 'color'], values: [['1', 'blue']] }];
      },
      prepare() {
        let stepped = false;
        return {
          bind() {},
          step() {
            if (!stepped) {
              stepped = true;
              return true;
            }
            return false;
          },
          getAsObject() {
            return { id: '1', color: 'green' };
          },
          free() {
            return true;
          },
        };
      },
    };
    const adapter = new SqlJsAdapter(mockSqlJs);
    const rows = await adapter.execute('SELECT * FROM test WHERE id = ?', ['1']);
    expect(rows).toEqual([{ id: '1', color: 'green' }]);
  });

  it('NodeSQLiteAdapter executes on Node 22+ built-in DatabaseSync', async () => {
    const mockNodeDb = {
      prepare() {
        return {
          all: () => [{ id: 'node-1', runtime: 'node:sqlite' }],
          run: () => ({ changes: 1 }),
        };
      },
    };
    const adapter = new NodeSQLiteAdapter(mockNodeDb);
    const rows = await adapter.execute('SELECT * FROM test');
    expect(rows).toEqual([{ id: 'node-1', runtime: 'node:sqlite' }]);
  });

  it('ExpoSQLiteAdapter executes reads directly, uses runAsync for writes, and supports transactions', async () => {
    const getAllSpy = vi.fn().mockResolvedValue([{ id: 'expo-1', title: 'Task' }]);
    const runAsyncSpy = vi.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 10 });
    const execAsyncSpy = vi.fn().mockResolvedValue(undefined);
    const withTxSpy = vi.fn().mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    });

    const mockExpoDb = {
      getAllAsync: getAllSpy,
      runAsync: runAsyncSpy,
      execAsync: execAsyncSpy,
      withTransactionAsync: withTxSpy,
    };

    const adapter = new ExpoSQLiteAdapter(mockExpoDb);

    // 1. Read query (SELECT) uses getAllAsync directly
    const readRows = await adapter.execute('SELECT * FROM tasks WHERE id = ?', ['expo-1']);
    expect(readRows).toEqual([{ id: 'expo-1', title: 'Task' }]);
    expect(getAllSpy).toHaveBeenCalledWith('SELECT * FROM tasks WHERE id = ?', ['expo-1']);

    // 2. Write query with parameters uses runAsync (faster, no dummy rows)
    const writeRows = await adapter.execute('INSERT INTO tasks (title) VALUES (?)', ['New']);
    expect(runAsyncSpy).toHaveBeenCalledWith('INSERT INTO tasks (title) VALUES (?)', ['New']);
    expect(writeRows).toEqual([{ changes: 1, lastInsertRowId: 10 }]);

    // 3. Parameterless DDL uses execAsync
    await adapter.execute('CREATE TABLE IF NOT EXISTS test (id TEXT PRIMARY KEY)');
    expect(execAsyncSpy).toHaveBeenCalledWith('CREATE TABLE IF NOT EXISTS test (id TEXT PRIMARY KEY)');

    // 4. Atomic transaction execution
    const txResult = await adapter.transaction(async (tx) => {
      await tx.execute('UPDATE tasks SET title = ? WHERE id = ?', ['Done', 'expo-1']);
      return 'tx-success';
    });
    expect(withTxSpy).toHaveBeenCalledTimes(1);
    expect(txResult).toBe('tx-success');
  });
});
