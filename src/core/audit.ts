import type { LocalDBAdapter } from '../adapters/local/index.js';
import type { SyncOp } from './types.js';
import { generateUUID } from '../utils/uuid.js';

export interface AuditEntry {
  id: string;
  tableName: string;
  rowId: string;
  operation: SyncOp;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  actor?: string | null;
  createdAt: number;
  undone: boolean;
}

export interface AuditClientLike {
  db: LocalDBAdapter;
  getPrimaryKey(): string;
  insert(
    tableName: string,
    payload: Record<string, any>,
    options?: any,
  ): Promise<any>;
  update(
    tableName: string,
    rowId: string,
    payload: Record<string, any>,
    options?: any,
  ): Promise<any>;
  delete(tableName: string, rowId: string, options?: any): Promise<any>;
}

/**
 * Local row-level audit log and undo/redo manager backed by `_audit_log`.
 */
export class AuditManager {
  private db: LocalDBAdapter;
  private initialized = false;

  constructor(db: LocalDBAdapter) {
    this.db = db;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS _audit_log (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        row_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        actor TEXT,
        created_at INTEGER NOT NULL,
        undone INTEGER NOT NULL DEFAULT 0
      )
    `);
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_audit_log_table_row ON _audit_log (table_name, row_id, created_at DESC)`,
    );
    this.initialized = true;
  }

  async record(params: {
    tableName: string;
    rowId: string;
    operation: SyncOp;
    before?: Record<string, any> | null;
    after?: Record<string, any> | null;
    actor?: string | null;
    createdAt?: number;
  }): Promise<AuditEntry> {
    await this.initialize();
    const id = generateUUID();
    const createdAt = params.createdAt ?? Date.now();
    await this.db.execute(
      `INSERT INTO _audit_log (id, table_name, row_id, operation, before_json, after_json, actor, created_at, undone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        id,
        params.tableName,
        params.rowId,
        params.operation,
        params.before ? JSON.stringify(params.before) : null,
        params.after ? JSON.stringify(params.after) : null,
        params.actor ?? null,
        createdAt,
      ],
    );
    return {
      id,
      tableName: params.tableName,
      rowId: params.rowId,
      operation: params.operation,
      before: params.before ?? null,
      after: params.after ?? null,
      actor: params.actor ?? null,
      createdAt,
      undone: false,
    };
  }

  async getHistory(options?: {
    tableName?: string;
    rowId?: string;
    limit?: number;
    includeUndone?: boolean;
  }): Promise<AuditEntry[]> {
    await this.initialize();
    const where: string[] = [];
    const params: any[] = [];
    if (options?.tableName) {
      where.push('table_name = ?');
      params.push(options.tableName);
    }
    if (options?.rowId) {
      where.push('row_id = ?');
      params.push(options.rowId);
    }
    if (!options?.includeUndone) {
      where.push('undone = 0');
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limitSql =
      typeof options?.limit === 'number'
        ? `LIMIT ${Math.max(1, options.limit)}`
        : '';
    const rows = await this.db.execute(
      `SELECT * FROM _audit_log ${whereSql} ORDER BY created_at DESC, rowid DESC ${limitSql}`,
      params,
    );
    return rows.map((r: any) => ({
      id: r.id,
      tableName: r.table_name,
      rowId: r.row_id,
      operation: r.operation as SyncOp,
      before: r.before_json ? JSON.parse(r.before_json) : null,
      after: r.after_json ? JSON.parse(r.after_json) : null,
      actor: r.actor ?? null,
      createdAt: Number(r.created_at),
      undone: r.undone === 1 || r.undone === true,
    }));
  }

  /**
   * Reverts the most recent active audit entry on the provided client.
   */
  async undo(client: AuditClientLike): Promise<AuditEntry | null> {
    await this.initialize();
    const [latest] = await this.getHistory({ limit: 1, includeUndone: false });
    if (!latest) return null;

    if (latest.operation === 'INSERT') {
      await client.delete(latest.tableName, latest.rowId);
    } else if (latest.operation === 'UPDATE' && latest.before) {
      await client.update(latest.tableName, latest.rowId, latest.before);
    } else if (latest.operation === 'DELETE' && latest.before) {
      await client.insert(latest.tableName, {
        ...latest.before,
        [client.getPrimaryKey()]: latest.rowId,
      });
    }

    await this.db.execute(`UPDATE _audit_log SET undone = 1 WHERE id = ?`, [
      latest.id,
    ]);
    return { ...latest, undone: true };
  }

  /**
   * Re-applies the most recently undone audit entry on the provided client.
   */
  async redo(client: AuditClientLike): Promise<AuditEntry | null> {
    await this.initialize();
    const rows = await this.db.execute(
      `SELECT * FROM _audit_log WHERE undone = 1 ORDER BY created_at ASC, rowid ASC LIMIT 1`,
    );
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    const entry: AuditEntry = {
      id: r.id,
      tableName: r.table_name,
      rowId: r.row_id,
      operation: r.operation as SyncOp,
      before: r.before_json ? JSON.parse(r.before_json) : null,
      after: r.after_json ? JSON.parse(r.after_json) : null,
      actor: r.actor ?? null,
      createdAt: Number(r.created_at),
      undone: true,
    };

    if (entry.operation === 'INSERT' && entry.after) {
      await client.insert(entry.tableName, {
        ...entry.after,
        [client.getPrimaryKey()]: entry.rowId,
      });
    } else if (entry.operation === 'UPDATE' && entry.after) {
      await client.update(entry.tableName, entry.rowId, entry.after);
    } else if (entry.operation === 'DELETE') {
      await client.delete(entry.tableName, entry.rowId);
    }

    await this.db.execute(`UPDATE _audit_log SET undone = 0 WHERE id = ?`, [
      entry.id,
    ]);
    return { ...entry, undone: false };
  }
}
