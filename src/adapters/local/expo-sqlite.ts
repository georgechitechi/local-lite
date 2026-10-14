import { LocalDBAdapter, LocalTransaction } from './index.js';

interface ExpoDatabase {
  getAllAsync(query: string, params: any[]): Promise<any[]>;
  execAsync?(query: string): Promise<void>;
  withTransactionAsync(action: () => Promise<void>): Promise<void>;
}

export class ExpoSQLiteAdapter implements LocalDBAdapter {
  private db: ExpoDatabase;
  private queue: Promise<any> = Promise.resolve();

  constructor(expoDbInstance: any) {
    this.db = expoDbInstance as ExpoDatabase;
  }

  async execute(query: string, params: any[] = []): Promise<any[]> {
    const run = async (): Promise<any[]> => {
      const trimmed = query.trim();
      const isSelect = /^SELECT\b/i.test(trimmed) || /^PRAGMA\b/i.test(trimmed);

      // Parameterless DDL/write statements can bypass statement preparation
      // to avoid NativeStatement SharedObject allocation race conditions on Android
      if (!isSelect && (!params || params.length === 0) && typeof this.db.execAsync === 'function') {
        await this.db.execAsync(query);
        return [];
      }

      return await this.db.getAllAsync(query, params);
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
}
