import { DBExecutable } from '../core/schema-manager.js';
import { ActionFilterOptions, ActionPruneOptions, ActionRecord, ActionStatus } from './types.js';

export const DEFAULT_ACTIONS_TABLE = '_local_actions';

/**
 * Maps raw database row into a typed ActionRecord.
 */
export function mapActionRow(r: any): ActionRecord {
  return {
    id: r.id,
    action: r.action,
    payload: r.payload ? (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) : {},
    idempotencyKey: r.idempotency_key ?? null,
    status: r.status as ActionStatus,
    createdAt: Number(r.created_at || 0),
    expiresAt: r.expires_at != null ? Number(r.expires_at) : null,
    executedAt: r.executed_at != null ? Number(r.executed_at) : null,
    retryCount: Number(r.retry_count || 0),
    maxRetries: Number(r.max_retries || 3),
    lastError: r.last_error ?? null,
    result: r.result ? (typeof r.result === 'string' ? JSON.parse(r.result) : r.result) : null,
  };
}

export class ActionStore {
  /**
   * Initializes the action outbox schema and indexes if they do not exist.
   */
  static async ensureSchema(db: DBExecutable, tableName: string = DEFAULT_ACTIONS_TABLE): Promise<void> {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS ${tableName} (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        payload TEXT NOT NULL,
        idempotency_key TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        executed_at INTEGER,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        last_error TEXT,
        result TEXT
      );`
    );

    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_status ON ${tableName} (status, created_at);`
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_idempotency ON ${tableName} (idempotency_key);`
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_action ON ${tableName} (action, status);`
    );
  }

  /**
   * Resets interrupted 'EXECUTING' records back to 'PENDING' on startup.
   */
  static async resetStaleExecuting(db: DBExecutable, tableName: string = DEFAULT_ACTIONS_TABLE): Promise<void> {
    await db.execute(
      `UPDATE ${tableName} SET status = 'PENDING' WHERE status = 'EXECUTING';`
    );
  }

  /**
   * Inserts an action record into storage.
   */
  static async insertRecord(
    db: DBExecutable,
    tableName: string = DEFAULT_ACTIONS_TABLE,
    record: ActionRecord
  ): Promise<void> {
    await db.execute(
      `INSERT INTO ${tableName} (
        id, action, payload, idempotency_key, status, created_at, expires_at, executed_at, retry_count, max_retries, last_error, result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.action,
        typeof record.payload === 'string' ? record.payload : JSON.stringify(record.payload ?? {}),
        record.idempotencyKey ?? null,
        record.status,
        record.createdAt,
        record.expiresAt ?? null,
        record.executedAt ?? null,
        record.retryCount,
        record.maxRetries,
        record.lastError ?? null,
        record.result ? (typeof record.result === 'string' ? record.result : JSON.stringify(record.result)) : null,
      ]
    );
  }

  /**
   * Finds an action record by ID.
   */
  static async findById(
    db: DBExecutable,
    tableName: string = DEFAULT_ACTIONS_TABLE,
    id: string
  ): Promise<ActionRecord | null> {
    const rows = await db.execute(`SELECT * FROM ${tableName} WHERE id = ? LIMIT 1;`, [id]);
    if (!rows || rows.length === 0) return null;
    return mapActionRow(rows[0]);
  }

  /**
   * Finds an existing action by its idempotency key.
   */
  static async findByIdempotencyKey(
    db: DBExecutable,
    tableName: string = DEFAULT_ACTIONS_TABLE,
    key: string
  ): Promise<ActionRecord | null> {
    const rows = await db.execute(
      `SELECT * FROM ${tableName} WHERE idempotency_key = ? LIMIT 1;`,
      [key]
    );
    if (!rows || rows.length === 0) return null;
    return mapActionRow(rows[0]);
  }

  /**
   * Retrieves pending actions ordered by creation timestamp.
   */
  static async getPending(
    db: DBExecutable,
    tableName: string = DEFAULT_ACTIONS_TABLE,
    limit: number = 50
  ): Promise<ActionRecord[]> {
    const rows = await db.execute(
      `SELECT * FROM ${tableName} WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT ?;`,
      [limit]
    );
    return (rows || []).map(mapActionRow);
  }

  /**
   * Updates the status and optional metadata fields of an action record.
   */
  static async updateStatus(
    db: DBExecutable,
    tableName: string = DEFAULT_ACTIONS_TABLE,
    id: string,
    status: ActionStatus,
    updates: {
      executedAt?: number | null;
      retryCount?: number;
      lastError?: string | null;
      result?: any;
    } = {}
  ): Promise<void> {
    const sets: string[] = ['status = ?'];
    const params: any[] = [status];

    if (updates.executedAt !== undefined) {
      sets.push('executed_at = ?');
      params.push(updates.executedAt);
    }
    if (updates.retryCount !== undefined) {
      sets.push('retry_count = ?');
      params.push(updates.retryCount);
    }
    if (updates.lastError !== undefined) {
      sets.push('last_error = ?');
      params.push(updates.lastError);
    }
    if (updates.result !== undefined) {
      sets.push('result = ?');
      params.push(updates.result ? JSON.stringify(updates.result) : null);
    }

    params.push(id);
    await db.execute(`UPDATE ${tableName} SET ${sets.join(', ')} WHERE id = ?;`, params);
  }

  /**
   * Queries action records with optional filtering.
   */
  static async list(
    db: DBExecutable,
    tableName: string = DEFAULT_ACTIONS_TABLE,
    filter: ActionFilterOptions = {}
  ): Promise<ActionRecord[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter.status) {
      if (Array.isArray(filter.status)) {
        if (filter.status.length > 0) {
          conditions.push(`status IN (${filter.status.map(() => '?').join(', ')})`);
          params.push(...filter.status);
        }
      } else {
        conditions.push(`status = ?`);
        params.push(filter.status);
      }
    }

    if (filter.action) {
      if (Array.isArray(filter.action)) {
        if (filter.action.length > 0) {
          conditions.push(`action IN (${filter.action.map(() => '?').join(', ')})`);
          params.push(...filter.action);
        }
      } else {
        conditions.push(`action = ?`);
        params.push(filter.action);
      }
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    let limitClause = '';
    if (filter.limit !== undefined) {
      limitClause = ` LIMIT ?`;
      params.push(filter.limit);
      if (filter.offset !== undefined) {
        limitClause += ` OFFSET ?`;
        params.push(filter.offset);
      }
    }

    const rows = await db.execute(
      `SELECT * FROM ${tableName}${whereClause} ORDER BY created_at DESC${limitClause};`,
      params
    );
    return (rows || []).map(mapActionRow);
  }

  /**
   * Cancels a pending action if it has not yet executed.
   */
  static async cancel(
    db: DBExecutable,
    tableName: string = DEFAULT_ACTIONS_TABLE,
    id: string
  ): Promise<boolean> {
    const rows = await db.execute(
      `UPDATE ${tableName} SET status = 'CANCELLED' WHERE id = ? AND status = 'PENDING';`,
      [id]
    );
    // In drivers that return affected rows or execute successfully
    const record = await this.findById(db, tableName, id);
    return record?.status === 'CANCELLED';
  }

  /**
   * Prunes old completed, failed, or expired action records.
   */
  static async prune(
    db: DBExecutable,
    tableName: string = DEFAULT_ACTIONS_TABLE,
    options: ActionPruneOptions = {}
  ): Promise<number> {
    const now = Date.now();
    let deletedCount = 0;

    if (options.completedOlderThanMs !== undefined) {
      const cutoff = now - options.completedOlderThanMs;
      await db.execute(
        `DELETE FROM ${tableName} WHERE status = 'COMPLETED' AND executed_at IS NOT NULL AND executed_at <= ?;`,
        [cutoff]
      );
    }

    if (options.failedOlderThanMs !== undefined) {
      const cutoff = now - options.failedOlderThanMs;
      await db.execute(
        `DELETE FROM ${tableName} WHERE status = 'FAILED' AND created_at <= ?;`,
        [cutoff]
      );
    }

    if (options.expiredOlderThanMs !== undefined) {
      const cutoff = now - options.expiredOlderThanMs;
      await db.execute(
        `DELETE FROM ${tableName} WHERE status = 'EXPIRED' AND created_at <= ?;`,
        [cutoff]
      );
    }

    if (options.cancelledOlderThanMs !== undefined) {
      const cutoff = now - options.cancelledOlderThanMs;
      await db.execute(
        `DELETE FROM ${tableName} WHERE status = 'CANCELLED' AND created_at <= ?;`,
        [cutoff]
      );
    }

    return deletedCount;
  }
}
