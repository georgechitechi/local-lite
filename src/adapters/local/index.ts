export interface LocalTransaction {
  execute(query: string, params?: any[]): Promise<any[]>;
}

export interface LocalDBAdapter {
  execute(query: string, params?: any[]): Promise<any[]>;
  transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T>;
  close?(): Promise<void> | void;
}

export * from './expo-sqlite.js';
export * from './op-sqlite.js';
export * from './better-sqlite3.js';
export * from './libsql.js';
export * from './sql-js.js';
export * from './node-sqlite.js';