import { LocalDBAdapter, LocalTransaction } from './index.js';

export interface LibSQLRow {
  [key: string]: any;
}

export interface LibSQLResultSet {
  columns: string[];
  rows: any[];
  rowsAffected?: number;
  lastInsertRowid?: bigint | number;
}

export interface LibSQLClient {
  execute(stmt: any): Promise<LibSQLResultSet>;
  transaction?(mode?: 'write' | 'read' | 'deferred'): Promise<any>;
}

function normalizeRows(res: LibSQLResultSet): any[] {
  if (!res || !res.rows) return [];
  const { columns, rows } = res;

  if (rows.length === 0) return [];

  // If rows are already standard objects
  if (typeof rows[0] === 'object' && !Array.isArray(rows[0]) && rows[0] !== null) {
    return rows;
  }

  // If rows are tuples/arrays, map them to column names
  if (Array.isArray(rows[0]) && Array.isArray(columns)) {
    return rows.map((rowArr: any[]) => {
      const obj: Record<string, any> = {};
      columns.forEach((col, i) => {
        obj[col] = rowArr[i];
      });
      return obj;
    });
  }

  return rows;
}

/**
 * Adapter for @libsql/client (Turso & LibSQL).
 * Supports local SQLite files, embedded replicas, in-memory databases, and server/edge deployments.
 */
export class LibSQLAdapter implements LocalDBAdapter {
  private client: LibSQLClient;

  constructor(libsqlClient: any) {
    this.client = libsqlClient as LibSQLClient;
  }

  async execute(query: string, params: any[] = []): Promise<any[]> {
    const res = await this.client.execute({
      sql: query,
      args: params,
    });
    return normalizeRows(res);
  }

  async transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    if (typeof this.client.transaction === 'function') {
      const tx = await this.client.transaction('write');
      try {
        const txWrapper: LocalTransaction = {
          execute: async (q, p = []) => {
            const res = await tx.execute({ sql: q, args: p });
            return normalizeRows(res);
          },
        };
        const result = await action(txWrapper);
        await tx.commit();
        return result;
      } catch (err) {
        try {
          await tx.rollback();
        } catch {
          // ignore rollback failure
        }
        throw err;
      }
    }

    // Fallback using SQL statements
    await this.execute('BEGIN IMMEDIATE');
    try {
      const txWrapper: LocalTransaction = {
        execute: async (q, p = []) => this.execute(q, p),
      };
      const result = await action(txWrapper);
      await this.execute('COMMIT');
      return result;
    } catch (err) {
      try {
        await this.execute('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
  }
}
