import { describe, it, expect } from 'vitest';
import {
  OpSQLiteAdapter,
  BetterSQLite3Adapter,
  LibSQLAdapter,
  SqlJsAdapter,
  NodeSQLiteAdapter,
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
});
