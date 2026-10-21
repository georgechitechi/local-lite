import { LocalDBAdapter, LocalTransaction } from './index.js';

// Pre-compiled RegExp hoisted to module scope — 0 regex allocations per query
const READ_QUERY_REGEX = /^(?:SELECT|PRAGMA)\b/i;

export interface ExpoDatabase {
  getAllAsync(query: string, params: any[]): Promise<any[]>;
  runAsync?(query: string, params: any[]): Promise<any>;
  execAsync?(query: string): Promise<void>;
  withTransactionAsync(action: () => Promise<void>): Promise<void>;
  closeAsync?(): Promise<void>;
  closeSync?(): void;
}

export class ExpoSQLiteAdapter implements LocalDBAdapter {
  private db: ExpoDatabase;
  private writeQueue: Promise<any> = Promise.resolve();

  constructor(expoDbInstance: any) {
    this.db = expoDbInstance as ExpoDatabase;
  }

  async execute(query: string, params: any[] = []): Promise<any[]> {
    const trimmed = query.trim();
    const isRead = READ_QUERY_REGEX.test(trimmed);

    // Fast-path: reads bypass the write queue entirely for zero-latency reactive queries
    if (isRead) {
      return this.db.getAllAsync(trimmed, params);
    }

    const run = async (): Promise<any[]> => {
      // Parameterless DDL statements bypass statement preparation
      if ((!params || params.length === 0) && typeof this.db.execAsync === 'function') {
        await this.db.execAsync(trimmed);
        return [];
      }

      // Modern Expo SQLite (SDK 51+): runAsync is optimized for writes without dummy row allocation
      if (typeof this.db.runAsync === 'function') {
        const res = await this.db.runAsync(trimmed, params);
        return [res];
      }

      return this.db.getAllAsync(trimmed, params);
    };

    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.catch(() => {});
    return await next;
  }

  async transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      let result!: T;
      await this.db.withTransactionAsync(async () => {
        const txWrapper: LocalTransaction = {
          execute: async (q, p = []) => {
            const trimmed = q.trim();
            if (READ_QUERY_REGEX.test(trimmed)) {
              return this.db.getAllAsync(trimmed, p);
            }
            if ((!p || p.length === 0) && typeof this.db.execAsync === 'function') {
              await this.db.execAsync(trimmed);
              return [];
            }
            if (typeof this.db.runAsync === 'function') {
              const res = await this.db.runAsync(trimmed, p);
              return [res];
            }
            return this.db.getAllAsync(trimmed, p);
          },
        };
        result = await action(txWrapper);
      });
      return result;
    };

    // Serialize transactions to prevent SQLite concurrency crashes
    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.catch(() => {});
    return await next;
  }

  /**
   * Waits for pending writes/transactions to finish and closes the underlying SQLite connection.
   */
  async close(): Promise<void> {
    await this.writeQueue;
    if (typeof this.db.closeAsync === 'function') {
      await this.db.closeAsync();
    } else if (typeof this.db.closeSync === 'function') {
      this.db.closeSync();
    }
  }
}
