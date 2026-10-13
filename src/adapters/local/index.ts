export interface LocalTransaction {
  execute(query: string, params?: any[]): Promise<any[]>;
}
export interface LocalDBAdapter {
  execute(query: string, params?: any[]): Promise<any[]>;
  transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T>;
}