import { LocalDBAdapter, LocalTransaction } from './index.js';

export interface SqlJsStatement {
  bind(values?: any[]): boolean;
  step(): boolean;
  getAsObject(params?: any[]): Record<string, any>;
  free(): boolean;
}

export interface SqlJsDatabase {
  prepare(sql: string, params?: any[]): SqlJsStatement;
  exec(sql: string, params?: any[]): Array<{ columns: string[]; values: any[][] }>;
  run(sql: string, params?: any[]): void;
  export?(): Uint8Array;
  close?(): void;
}

/**
 * Adapter for sql.js (WebAssembly SQLite in Web Browsers, PWAs, and Expo Web).
 */
export class SqlJsAdapter implements LocalDBAdapter {
  readonly supportsSqlPushdown = true;
  private db: SqlJsDatabase;

  constructor(sqlJsDatabase: any) {
    this.db = sqlJsDatabase as SqlJsDatabase;
  }

  async execute(query: string, params: any[] = []): Promise<any[]> {
    const trimmed = query.trim();

    // If there are no parameters, db.exec is fastest
    if (!params || params.length === 0) {
      const results = this.db.exec(trimmed);
      if (!results || results.length === 0) return [];

      const { columns, values } = results[0];
      return values.map((row) => {
        const obj: Record<string, any> = {};
        columns.forEach((col, idx) => {
          obj[col] = row[idx];
        });
        return obj;
      });
    }

    // For parameterized queries, use Statement with bind & getAsObject
    const stmt = this.db.prepare(trimmed);
    try {
      stmt.bind(params);
      const rows: any[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  async transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    this.db.run('BEGIN TRANSACTION;');
    try {
      const txWrapper: LocalTransaction = {
        execute: async (q, p = []) => this.execute(q, p),
      };
      const result = await action(txWrapper);
      this.db.run('COMMIT;');
      return result;
    } catch (err) {
      try {
        this.db.run('ROLLBACK;');
      } catch {
        // ignore rollback errors
      }
      throw err;
    }
  }

  close(): void {
    if (typeof this.db.close === 'function') {
      this.db.close();
    }
  }
}
