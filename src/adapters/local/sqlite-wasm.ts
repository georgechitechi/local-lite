import { LocalDBAdapter, LocalTransaction } from './index.js';

export interface SqliteWasmExecOptions {
  sql: string;
  bind?: any[];
  rowMode?: 'object' | 'array' | 'stmt';
  returnValue?: 'resultRows' | 'saveSql';
}

export interface SqliteWasmDatabase {
  exec(options: SqliteWasmExecOptions): any[];
  exec(sql: string, options?: Omit<SqliteWasmExecOptions, 'sql'>): any[];
  transaction?<T>(fn: () => T): T;
  close?(): void;
}

/**
 * Adapter for `@sqlite.org/sqlite-wasm` (oo1.DB / OpfsDb) for persistent OPFS-backed browser SQLite.
 */
export class SqliteWasmAdapter implements LocalDBAdapter {
  readonly supportsSqlPushdown = true;
  private db: SqliteWasmDatabase;
  private txQueue: Promise<void> = Promise.resolve();

  constructor(db: SqliteWasmDatabase) {
    this.db = db;
  }

  async execute(query: string, params: any[] = []): Promise<any[]> {
    const trimmed = query.trim();
    const rows = this.db.exec({
      sql: trimmed,
      bind: params.length > 0 ? params : undefined,
      rowMode: 'object',
      returnValue: 'resultRows',
    });
    return Array.isArray(rows) ? rows : [];
  }

  async transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const prev = this.txQueue;
    this.txQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;

    const tx: LocalTransaction = {
      execute: (query: string, params: any[] = []) =>
        this.execute(query, params),
    };

    try {
      await this.execute('BEGIN IMMEDIATE');
      const result = await action(tx);
      await this.execute('COMMIT');
      return result;
    } catch (err) {
      try {
        await this.execute('ROLLBACK');
      } catch {}
      throw err;
    } finally {
      release();
    }
  }

  close(): void {
    this.db.close?.();
  }
}
