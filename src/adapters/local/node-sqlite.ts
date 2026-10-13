import { LocalDBAdapter, LocalTransaction } from './index.js';

export interface NodeSqliteStatement {
  all(...params: any[]): any[];
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  get?(...params: any[]): any;
}

export interface NodeSqliteDatabaseSync {
  prepare(sql: string): NodeSqliteStatement;
  exec(sql: string): void;
  close?(): void;
}

/**
 * Adapter for Node.js 22+ built-in `node:sqlite` (DatabaseSync).
 * Provides zero-dependency, native SQLite on modern Node.js runtimes.
 */
export class NodeSQLiteAdapter implements LocalDBAdapter {
  private db: NodeSqliteDatabaseSync;

  constructor(nodeSqliteDb: any) {
    this.db = nodeSqliteDb as NodeSqliteDatabaseSync;
  }

  async execute(query: string, params: any[] = []): Promise<any[]> {
    const trimmed = query.trim();
    const stmt = this.db.prepare(trimmed);

    // Queries that return rows (SELECT, PRAGMA)
    if (/^SELECT|^PRAGMA/i.test(trimmed)) {
      return stmt.all(...params);
    }

    const res = stmt.run(...params);
    return [res];
  }

  async transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const txWrapper: LocalTransaction = {
        execute: async (q, p = []) => this.execute(q, p),
      };
      const result = await action(txWrapper);
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      throw err;
    }
  }
}
