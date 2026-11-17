import { RemoteDBAdapter, RemoteRequestOptions } from './index.js';
import {
  DeltaChange,
  DeltaChanges,
  PushResult,
  SyncOperation,
} from '../../core/types.js';

export interface PostgresQueryResult<T = any> {
  rows: T[];
}

export interface PostgresExecutor {
  query<T = any>(
    sql: string,
    params?: any[],
  ): Promise<PostgresQueryResult<T>>;
}

export interface PostgresRemoteAdapterOptions {
  /** Any `pg.Pool`, `pg.Client`, `@vercel/postgres`, or Drizzle-compatible query executor. */
  executor: PostgresExecutor;
  /** Tables to sync during pullChanges. */
  tables: string[];
  /** Primary key column name (default: 'id'). */
  primaryKey?: string;
  /** Timestamp column used for incremental pulls (default: 'updated_at'). */
  updatedAtColumn?: string;
  /** Optional PostgreSQL schema prefix (default: 'public'). */
  schema?: string;
}

function quotePgIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * Turnkey PostgreSQL RemoteDBAdapter for Node/Serverless backends (pg, Vercel Postgres, Drizzle).
 */
export class PostgresRemoteAdapter implements RemoteDBAdapter {
  private executor: PostgresExecutor;
  private tables: string[];
  private primaryKey: string;
  private updatedAtColumn: string;
  private schema: string;
  private syncScope?:
    | Record<string, any>
    | (() => Record<string, any> | Promise<Record<string, any>>);

  constructor(options: PostgresRemoteAdapterOptions) {
    this.executor = options.executor;
    this.tables = options.tables;
    this.primaryKey = options.primaryKey ?? 'id';
    this.updatedAtColumn = options.updatedAtColumn ?? 'updated_at';
    this.schema = options.schema ?? 'public';
  }

  private qualTable(table: string): string {
    return `${quotePgIdent(this.schema)}.${quotePgIdent(table)}`;
  }

  setSyncScope(
    scope?:
      | Record<string, any>
      | (() => Record<string, any> | Promise<Record<string, any>>),
  ): void {
    this.syncScope = scope;
  }

  async pushChanges(
    operations: SyncOperation[],
    _options?: RemoteRequestOptions,
  ): Promise<PushResult> {
    const successfulIds: string[] = [];
    const failedIds: string[] = [];

    for (const op of operations) {
      const tableRef = this.qualTable(op.tableName);
      const pkCol = quotePgIdent(this.primaryKey);
      const tsCol = quotePgIdent(this.updatedAtColumn);

      try {
        if (op.operation === 'DELETE') {
          await this.executor.query(
            `UPDATE ${tableRef} SET "deleted" = true, ${tsCol} = $1 WHERE ${pkCol} = $2`,
            [op.timestamp, op.rowId],
          );
        } else {
          const payload = { ...(op.payload ?? {}) };
          if (payload[this.primaryKey] === undefined) {
            payload[this.primaryKey] = op.rowId;
          }
          if (payload[this.updatedAtColumn] === undefined) {
            payload[this.updatedAtColumn] = op.timestamp;
          }

          const cols = Object.keys(payload);
          const colIdents = cols.map(quotePgIdent).join(', ');
          const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
          const values = cols.map((c) => payload[c]);
          const updateSet = cols
            .filter((c) => c !== this.primaryKey)
            .map((c) => `${quotePgIdent(c)} = EXCLUDED.${quotePgIdent(c)}`)
            .join(', ');

          const sql = updateSet
            ? `INSERT INTO ${tableRef} (${colIdents}) VALUES (${placeholders}) ON CONFLICT (${pkCol}) DO UPDATE SET ${updateSet}`
            : `INSERT INTO ${tableRef} (${colIdents}) VALUES (${placeholders}) ON CONFLICT (${pkCol}) DO NOTHING`;

          await this.executor.query(sql, values);
        }
        successfulIds.push(op.id);
      } catch {
        failedIds.push(op.id);
      }
    }

    return {
      success: failedIds.length === 0,
      successfulIds,
      failedIds,
    };
  }

  async fetchChanges(
    sinceTimestamp: number,
    scope?: Record<string, any>,
    _options?: RemoteRequestOptions,
  ): Promise<DeltaChanges> {
    const resolvedScope =
      scope ??
      (typeof this.syncScope === 'function'
        ? await this.syncScope()
        : this.syncScope);

    const changes: DeltaChange[] = [];
    let maxTimestamp = sinceTimestamp;
    const tsCol = quotePgIdent(this.updatedAtColumn);

    for (const table of this.tables) {
      const tableRef = this.qualTable(table);
      const params: any[] = [sinceTimestamp];
      const whereParts: string[] = [`${tsCol} > $1`];

      if (resolvedScope && typeof resolvedScope === 'object') {
        for (const [k, v] of Object.entries(resolvedScope)) {
          if (v !== undefined) {
            params.push(v);
            whereParts.push(`${quotePgIdent(k)} = $${params.length}`);
          }
        }
      }

      const sql = `SELECT * FROM ${tableRef} WHERE ${whereParts.join(' AND ')} ORDER BY ${tsCol} ASC`;
      const res = await this.executor.query(sql, params);
      for (const row of res.rows ?? []) {
        const ts = Number(row?.[this.updatedAtColumn]) || Date.now();
        if (ts > maxTimestamp) maxTimestamp = ts;
        const isDeleted =
          row?.deleted === true || row?.deleted === 1 || row?.deleted === 'true';
        changes.push({
          tableName: table,
          rowId: String(row?.[this.primaryKey] ?? ''),
          operation: isDeleted ? 'DELETE' : 'UPDATE',
          payload: isDeleted ? null : row,
          timestamp: ts,
        });
      }
    }

    return { timestamp: maxTimestamp, changes };
  }

  subscribeToLiveChanges(
    _callback: (changes: DeltaChanges) => void,
    scope?:
      | Record<string, any>
      | (() => Record<string, any> | Promise<Record<string, any>>),
  ): () => void {
    if (scope) {
      this.syncScope = scope;
    }
    return () => {};
  }
}
