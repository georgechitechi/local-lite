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
  private txQueue: Promise<any> = Promise.resolve();
  private statementCache: Map<string, BetterSqliteStatement> = new Map();
  private readonly maxCacheSize = 100;

  constructor(betterSqliteInstance: any) {
    this.db = betterSqliteInstance as BetterSqliteDatabase;
  }

  private getStatement(sql: string): BetterSqliteStatement {
    let stmt = this.statementCache.get(sql);
    if (!stmt) {
      if (this.statementCache.size >= this.maxCacheSize) {
        const oldestKey = this.statementCache.keys().next().value;
        if (oldestKey) this.statementCache.delete(oldestKey);
      }
      stmt = this.db.prepare(sql);
      this.statementCache.set(sql, stmt);
    }
    return stmt;
  }

  async execute(query: string, params: any[] = []): Promise<any[]> {
    const trimmed = query.trim();
    const isReader = /^SELECT|^PRAGMA/i.test(trimmed);

    // Fast-path: Readers execute directly and synchronously without artificial promise queue delay
    if (isReader) {
      const stmt = this.getStatement(trimmed);
      return stmt.all(...params);
    }

    const run = async (): Promise<any[]> => {
      const stmt = this.getStatement(trimmed);
      if (stmt.reader) {
        return stmt.all(...params);
      }
      const info = stmt.run(...params);
      return [info];
    };

    const next = this.txQueue.then(run, run);
    this.txQueue = next.catch(() => {});
    return await next;
  }

  async transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      // Explicit transaction control reusing prepared statements
      this.getStatement('BEGIN IMMEDIATE').run();
      try {
        const txWrapper: LocalTransaction = {
          execute: async (q: string, p: any[] = []) => {
            const trimmed = q.trim();
            const stmt = this.getStatement(trimmed);
            if (stmt.reader || /^SELECT|^PRAGMA/i.test(trimmed)) {
              return stmt.all(...p);
            }
            return [stmt.run(...p)];
          },
        };
        const result = await action(txWrapper);
        this.getStatement('COMMIT').run();
        return result;
      } catch (err) {
        try {
          this.getStatement('ROLLBACK').run();
        } catch {
          // Ignore secondary rollback error if connection closed
        }
        throw err;
      }
    };

    const next = this.txQueue.then(run, run);
    this.txQueue = next.catch(() => {});
    return await next;
  }

  close(): void {
    if (typeof this.db.close === 'function') {
      this.db.close();
    }
  }
}
