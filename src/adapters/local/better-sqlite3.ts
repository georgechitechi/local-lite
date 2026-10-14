import { LocalDBAdapter, LocalTransaction } from './index.js';

export interface BetterSqliteStatement {
  reader?: boolean;
  all(...params: any[]): any[];
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
}

export interface BetterSqliteDatabase {
  prepare(query: string): BetterSqliteStatement;
  exec?(sql: string): void;
  close?(): void;
}

/**
 * Adapter for better-sqlite3 in Node.js, Electron, Next.js, and server environments.
 */
export class BetterSQLite3Adapter implements LocalDBAdapter {
  private db: BetterSqliteDatabase;

  constructor(betterSqliteInstance: any) {
    this.db = betterSqliteInstance as BetterSqliteDatabase;
  }

  async execute(query: string, params: any[] = []): Promise<any[]> {
    const trimmed = query.trim();
    const stmt = this.db.prepare(trimmed);

    // If query returns rows (SELECT, PRAGMA) or is marked as reader
    if (stmt.reader || /^SELECT|^PRAGMA/i.test(trimmed)) {
      return stmt.all(...params);
    }

    const info = stmt.run(...params);
    return [info];
  }

  async transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    // Explicit transaction control compatible with async actions
    this.db.prepare('BEGIN IMMEDIATE').run();
    try {
      const txWrapper: LocalTransaction = {
        execute: async (q: string, p: any[] = []) => {
          return await this.execute(q, p);
        },
      };
      const result = await action(txWrapper);
      this.db.prepare('COMMIT').run();
      return result;
    } catch (err) {
      try {
        this.db.prepare('ROLLBACK').run();
      } catch {
        // Ignore secondary rollback error if connection closed
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
