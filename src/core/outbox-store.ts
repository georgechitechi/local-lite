import { LocalDBAdapter, LocalTransaction } from '../adapters/local/index.js';
import { OutboxRecord, OutboxStatus, SyncOperation } from './types.js';

export class OutboxStore {
  /**
   * Initializes the sync_outbox schema if it does not already exist.
   */
  static async ensureSchema(db: LocalDBAdapter): Promise<void> {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        row_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT,
        timestamp INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );`
    );
  }

  /**
   * Inserts a new outbox entry within an existing database transaction.
   */
  static async insertRecord(tx: LocalTransaction, op: SyncOperation): Promise<void> {
    await tx.execute(
      `INSERT INTO sync_outbox (id, table_name, row_id, operation, payload, timestamp, status, retry_count)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0)`,
      [
        op.id,
        op.tableName,
        op.rowId,
        op.operation,
        op.payload ? JSON.stringify(op.payload) : null,
        op.timestamp,
      ]
    );
  }

  /**
   * Inserts multiple outbox entries within an existing database transaction.
   */
  static async insertRecords(tx: LocalTransaction, ops: SyncOperation[]): Promise<void> {
    for (const op of ops) {
      await this.insertRecord(tx, op);
    }
  }

  /**
   * Fetches pending and eligible failed outbox records for synchronization.
   */
  static async getPending(
    db: LocalDBAdapter,
    maxRetries: number = 5,
    limit: number = 50
  ): Promise<OutboxRecord[]> {
    const isInfinite = !Number.isFinite(maxRetries) || maxRetries === -1;
    const query = isInfinite
      ? `SELECT * FROM sync_outbox 
         WHERE status = 'PENDING' OR status = 'FAILED' 
         ORDER BY timestamp ASC LIMIT ?`
      : `SELECT * FROM sync_outbox 
         WHERE status = 'PENDING' OR (status = 'FAILED' AND retry_count < ?) 
         ORDER BY timestamp ASC LIMIT ?`;
    const params = isInfinite ? [limit] : [maxRetries, limit];

    const rows = await db.execute(query, params);

    if (!rows || rows.length === 0) return [];

    return rows.map((r: any) => ({
      id: r.id,
      tableName: r.table_name,
      rowId: r.row_id,
      operation: r.operation,
      payload: r.payload ? (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) : null,
      timestamp: Number(r.timestamp),
      status: r.status,
      retryCount: Number(r.retry_count || 0),
      lastError: r.last_error,
    }));
  }

  /**
   * Finds the latest pending outbox record for a given table and row.
   */
  static async findPendingByRow(
    tx: LocalTransaction,
    tableName: string,
    rowId: string
  ): Promise<OutboxRecord | undefined> {
    const rows = await tx.execute(
      `SELECT * FROM sync_outbox 
       WHERE table_name = ? AND row_id = ? AND status != 'FAILED' 
       ORDER BY timestamp DESC LIMIT 1`,
      [tableName, rowId]
    );

    if (!rows || rows.length === 0) return undefined;

    const r = rows[0];
    return {
      id: r.id,
      tableName: r.table_name,
      rowId: r.row_id,
      operation: r.operation,
      payload: r.payload ? (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) : null,
      timestamp: Number(r.timestamp),
      status: r.status,
      retryCount: Number(r.retry_count || 0),
      lastError: r.last_error,
    };
  }

  /**
   * Marks a batch of outbox IDs as 'PROCESSING'.
   */
  static async markProcessing(db: LocalDBAdapter, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await db.execute(
      `UPDATE sync_outbox SET status = 'PROCESSING' WHERE id IN (${placeholders})`,
      ids
    );
  }

  /**
   * Resets any orphaned 'PROCESSING' records back to 'PENDING' on startup.
   * Protects against app kills or crashes that happened mid-push.
   */
  static async resetStaleProcessing(db: LocalDBAdapter): Promise<void> {
    try {
      await db.execute(`UPDATE sync_outbox SET status = 'PENDING' WHERE status = 'PROCESSING'`);
    } catch {
      // Table may not exist yet
    }
  }

  /**
   * Deletes a batch of successfully pushed outbox entries.
   */
  static async deleteCompleted(db: LocalDBAdapter, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await db.execute(`DELETE FROM sync_outbox WHERE id IN (${placeholders})`, ids);
  }

  /**
   * Deletes a single outbox record within an active transaction.
   */
  static async deleteRecord(tx: LocalTransaction, id: string): Promise<void> {
    await tx.execute(`DELETE FROM sync_outbox WHERE id = ?`, [id]);
  }

  /**
   * Updates an outbox record's payload (used during conflict merge).
   */
  static async updatePayload(
    tx: LocalTransaction,
    id: string,
    payload: Record<string, any>
  ): Promise<void> {
    await tx.execute(
      `UPDATE sync_outbox SET payload = ? WHERE id = ?`,
      [JSON.stringify(payload), id]
    );
  }

  /**
   * Marks a batch of outbox IDs as 'FAILED' and increments retry counters.
   */
  static async markFailed(
    db: LocalDBAdapter,
    ids: string[],
    errorMessage: string
  ): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await db.execute(
      `UPDATE sync_outbox 
       SET status = 'FAILED', 
           retry_count = retry_count + 1, 
           last_error = ? 
       WHERE id IN (${placeholders})`,
      [errorMessage, ...ids]
    );
  }

  /**
   * Retrieves accurate counts of outbox records categorized by status.
   */
  static async getCounts(db: LocalDBAdapter): Promise<{
    pending: number;
    failed: number;
    processing: number;
    total: number;
  }> {
    try {
      const rows = await db.execute(`SELECT * FROM sync_outbox`);
      if (!rows || rows.length === 0) {
        return { pending: 0, failed: 0, processing: 0, total: 0 };
      }

      let pending = 0;
      let failed = 0;
      let processing = 0;

      for (const row of rows) {
        if (row.status === 'PENDING') pending++;
        else if (row.status === 'FAILED') failed++;
        else if (row.status === 'PROCESSING') processing++;
      }

      return {
        pending,
        failed,
        processing,
        total: rows.length,
      };
    } catch {
      return { pending: 0, failed: 0, processing: 0, total: 0 };
    }
  }

  /**
   * Re-queues failed outbox records for retry by resetting their status to PENDING and resetting retry_count.
   * If ids are specified, only those records are reset. Otherwise, all FAILED records are reset.
   * Returns the count of affected records.
   */
  static async retryFailed(db: LocalDBAdapter, ids?: string[]): Promise<number> {
    try {
      if (ids && ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        await db.execute(
          `UPDATE sync_outbox 
           SET status = 'PENDING', retry_count = 0, last_error = NULL 
           WHERE status = 'FAILED' AND id IN (${placeholders})`,
          ids
        );
        return ids.length;
      } else {
        const failedRecords = await db.execute(`SELECT id FROM sync_outbox WHERE status = 'FAILED'`);
        const count = failedRecords?.length || 0;
        if (count > 0) {
          await db.execute(
            `UPDATE sync_outbox SET status = 'PENDING', retry_count = 0, last_error = NULL WHERE status = 'FAILED'`
          );
        }
        return count;
      }
    } catch {
      return 0;
    }
  }

  /**
   * Permanently clears failed outbox records (removes poison-pill mutations).
   */
  static async clearFailed(db: LocalDBAdapter, ids?: string[]): Promise<number> {
    try {
      if (ids && ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        await db.execute(
          `DELETE FROM sync_outbox WHERE status = 'FAILED' AND id IN (${placeholders})`,
          ids
        );
        return ids.length;
      } else {
        const failedRecords = await db.execute(`SELECT id FROM sync_outbox WHERE status = 'FAILED'`);
        const count = failedRecords?.length || 0;
        if (count > 0) {
          await db.execute(`DELETE FROM sync_outbox WHERE status = 'FAILED'`);
        }
        return count;
      }
    } catch {
      return 0;
    }
  }

  /**
   * Retrieves all outbox records, optionally filtered by status, ordered by timestamp.
   */
  static async getAllRecords(
    db: LocalDBAdapter,
    options?: { status?: OutboxStatus; limit?: number; offset?: number }
  ): Promise<OutboxRecord[]> {
    try {
      const rows = await db.execute(`SELECT * FROM sync_outbox`);
      if (!rows || rows.length === 0) return [];

      let mapped: OutboxRecord[] = rows.map((r: any) => ({
        id: r.id,
        tableName: r.table_name,
        rowId: r.row_id,
        operation: r.operation,
        payload: r.payload ? (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) : null,
        timestamp: Number(r.timestamp),
        status: r.status,
        retryCount: Number(r.retry_count || 0),
        lastError: r.last_error,
      }));

      if (options?.status) {
        mapped = mapped.filter((r) => r.status === options.status);
      }

      mapped.sort((a, b) => b.timestamp - a.timestamp);

      if (options?.offset && options.offset > 0) {
        mapped = mapped.slice(options.offset);
      }
      if (options?.limit && options.limit > 0) {
        mapped = mapped.slice(0, options.limit);
      }

      return mapped;
    } catch {
      return [];
    }
  }
}
