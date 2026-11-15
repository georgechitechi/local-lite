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

const READ_QUERY_REGEX = /^(?:SELECT|WITH|EXPLAIN)\b/i;
const READ_ONLY_PRAGMA_REGEX = /^PRAGMA\b/i;
const MUTATING_PRAGMA_REGEX = /=|wal_checkpoint|shrink_memory|optimize/i;

function isReadQuery(sql: string): boolean {
  if (READ_QUERY_REGEX.test(sql)) return true;
  return READ_ONLY_PRAGMA_REGEX.test(sql) && !MUTATING_PRAGMA_REGEX.test(sql);
}

/**
 * Adapter for Node.js 22+ built-in `node:sqlite` (DatabaseSync).
 * Provides zero-dependency, native SQLite on modern Node.js runtimes.
 */
export class NodeSQLiteAdapter implements LocalDBAdapter {
  readonly supportsSqlPushdown = true;
  private db: NodeSqliteDatabaseSync;
  private txQueue: Promise<any> = Promise.resolve();
  private statementCache: Map<string, NodeSqliteStatement> = new Map();
  private readonly maxCacheSize = 100;

  constructor(nodeSqliteDb: any) {
    this.db = nodeSqliteDb as NodeSqliteDatabaseSync;
  }

  private getStatement(sql: string): NodeSqliteStatement {
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

    // Fast-path: Readers execute directly and synchronously without queuing delay
    if (isReadQuery(trimmed)) {
      const stmt = this.getStatement(trimmed);
      return stmt.all(...params);
    }

    const run = async (): Promise<any[]> => {
      const stmt = this.getStatement(trimmed);
      const res = stmt.run(...params);
      return [res];
    };

    const next = this.txQueue.then(run, run);
    this.txQueue = next.catch(() => {});
    return await next;
  }

  async transaction<T>(
    action: (tx: LocalTransaction) => Promise<T>,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const txWrapper: LocalTransaction = {
          execute: async (q, p = []) => {
            const trimmed = q.trim();
            const stmt = this.getStatement(trimmed);
            if (isReadQuery(trimmed)) {
              return stmt.all(...p);
            }
            return [stmt.run(...p)];
          },
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
