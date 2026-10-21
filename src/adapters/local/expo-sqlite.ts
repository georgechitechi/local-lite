import { LocalDBAdapter, LocalTransaction } from './index.js';

interface ExpoDatabase {
  getAllAsync(query: string, params: any[]): Promise<any[]>;
  execAsync?(query: string): Promise<void>;
  withTransactionAsync(action: () => Promise<void>): Promise<void>;
  closeAsync?(): Promise<void>;
  closeSync?(): void;
}

export class ExpoSQLiteAdapter implements LocalDBAdapter {
  private db: ExpoDatabase;
  private queue: Promise<any> = Promise.resolve();

  constructor(expoDbInstance: any) {
    this.db = expoDbInstance as ExpoDatabase;
  }

  async execute(query: string, params: any[] = []): Promise<any[]> {
    const trimmed = query.trim();
    const isRead = /^SELECT\b/i.test(trimmed) || /^PRAGMA\b/i.test(trimmed);

    // Fast-path: reads bypass the write queue entirely
    if (isRead) return this.db.getAllAsync(trimmed, params);

    const run = async (): Promise<any[]> => {
      if ((!params || params.length === 0) && typeof this.db.execAsync === 'function') {
        await this.db.execAsync(query);
        return [];
      }
      return this.db.getAllAsync(query, params);
    };

    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return await next;
  }

  async transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      let result!: T;
      await this.db.withTransactionAsync(async () => {
        const txWrapper: LocalTransaction = {
          execute: async (q, p = []) => {
            const trimmed = q.trim();
            const isSelect = /^SELECT\b/i.test(trimmed) || /^PRAGMA\b/i.test(trimmed);
            if (!isSelect && (!p || p.length === 0) && typeof this.db.execAsync === 'function') {
              await this.db.execAsync(q);
              return [];
            }
            return await this.db.getAllAsync(q, p);
          }
        };
        result = await action(txWrapper);
      });
      return result;
    };

    // Serialize transactions and queries to prevent SQLite concurrency crashes
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return await next;
  }

  /**
   * Waits for pending queries/transactions to finish and closes the underlying SQLite database connection.
   */
  async close(): Promise<void> {
    await this.queue;
    if (typeof this.db.closeAsync === 'function') {
      await this.db.closeAsync();
    } else if (typeof this.db.closeSync === 'function') {
      this.db.closeSync();
    }
  }
}
