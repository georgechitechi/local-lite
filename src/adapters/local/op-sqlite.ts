import { LocalDBAdapter, LocalTransaction } from './index.js';

export interface OpSQLiteQueryResult {
  rows?: {
    _array?: any[];
    length?: number;
    item?: (i: number) => any;
  } | any[];
  insertId?: number;
  rowsAffected?: number;
}

export interface OpSQLiteDatabase {
  executeAsync(query: string, params?: any[]): Promise<OpSQLiteQueryResult>;
  transactionAsync(action: (tx: any) => Promise<void>): Promise<void>;
  close?: () => void;
}

function extractRows(res: any): any[] {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (res.rows) {
    if (Array.isArray(res.rows)) return res.rows;
    if (res.rows._array && Array.isArray(res.rows._array)) return res.rows._array;
    if (typeof res.rows.length === 'number' && typeof res.rows.item === 'function') {
      const arr: any[] = [];
      for (let i = 0; i < res.rows.length; i++) {
        arr.push(res.rows.item(i));
      }
      return arr;
    }
  }
  return [];
}

/**
 * Adapter for @op-engineering/op-sqlite and react-native-quick-sqlite.
 * Enables ultra-fast C++ JSI SQLite in bare React Native.
 */
export class OpSQLiteAdapter implements LocalDBAdapter {
  readonly supportsSqlPushdown = true;
  private db: OpSQLiteDatabase;
  private txMutex: Promise<any> = Promise.resolve();

  constructor(opSqliteInstance: any) {
    this.db = opSqliteInstance as OpSQLiteDatabase;
  }

  async execute(query: string, params: any[] = []): Promise<any[]> {
    const res = await this.db.executeAsync(query, params);
    return extractRows(res);
  }

  async transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      let result!: T;
      await this.db.transactionAsync(async (txInstance: any) => {
        const txWrapper: LocalTransaction = {
          execute: async (q: string, p: any[] = []) => {
            const res = typeof txInstance.executeAsync === 'function'
              ? await txInstance.executeAsync(q, p)
              : await txInstance.execute(q, p);
            return extractRows(res);
          },
        };
        result = await action(txWrapper);
      });
      return result;
    };

    const currentTx = this.txMutex.then(run, run);
    this.txMutex = currentTx.catch(() => {});
    return await currentTx;
  }

  async close(): Promise<void> {
    await this.txMutex;
    if (typeof this.db.close === 'function') {
      this.db.close();
    }
  }
}
