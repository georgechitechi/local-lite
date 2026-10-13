import { LocalDBAdapter, LocalTransaction } from '../adapters/local/index.js';
import { OutboxRecord, SyncOperation } from './types.js';

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
   * Fetches pending and eligible failed outbox records for synchronization.
   */
  static async getPending(
    db: LocalDBAdapter,
    maxRetries: number = 5,
    limit: number = 50
  ): Promise<OutboxRecord[]> {
    const rows = await db.execute(
      `SELECT * FROM sync_outbox 
       WHERE status = 'PENDING' OR (status = 'FAILED' AND retry_count < ?) 
       ORDER BY timestamp ASC LIMIT ?`,
      [maxRetries, limit]
    );

    if (!rows || rows.length === 0) return [];

    return rows.map((r: any) => ({
      id: r.id,
      tableName: r.table_name,
      rowId: r.row_id,
      operation: r.operation,
      payload: r.payload ? JSON.parse(r.payload) : null,
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
      payload: r.payload ? JSON.parse(r.payload) : null,
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
}
