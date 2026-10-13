import { LocalDBAdapter, LocalTransaction } from './index.js';

interface ExpoDatabase {
  getAllAsync(query: string, params: any[]): Promise<any[]>;
  withTransactionAsync(action: () => Promise<void>): Promise<void>;
}

export class ExpoSQLiteAdapter implements LocalDBAdapter {
  private db: ExpoDatabase;
  private txMutex: Promise<any> = Promise.resolve();

  constructor(expoDbInstance: any) {
    this.db = expoDbInstance as ExpoDatabase;
  }

  async execute(query: string, params: any[] = []): Promise<any[]> {
    return await this.db.getAllAsync(query, params);
  }

  async transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      let result!: T;
      await this.db.withTransactionAsync(async () => {
        const txWrapper: LocalTransaction = {
          execute: async (q, p = []) => await this.db.getAllAsync(q, p)
        };
        result = await action(txWrapper);
      });
      return result;
    };

    // Serialize transactions to prevent SQLite "cannot start a transaction within a transaction"
    const currentTx = this.txMutex.then(run, run);
    this.txMutex = currentTx.catch(() => {});
    return await currentTx;
  }
}