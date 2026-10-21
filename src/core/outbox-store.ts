import { LocalDBAdapter, LocalTransaction } from '../adapters/local/index.js';
import { OutboxRecord, OutboxStatus, SyncOp, SyncOperation } from './types.js';

/**
 * Maps a raw sync_outbox row into an OutboxRecord.
 */
function mapOutboxRow(r: any): OutboxRecord {
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
    // Indexes for the hot paths: pending scans (push), per-row conflict lookups (pull),
    // and status counts (telemetry). Executed separately: many drivers prepare one statement.
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_ts ON sync_outbox (status, timestamp);`
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_retry ON sync_outbox (status, retry_count, timestamp);`
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_sync_outbox_row ON sync_outbox (table_name, row_id, timestamp);`
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
   * Inserts multiple outbox entries in high-throughput multi-row SQL chunks within an existing transaction.
   */
  static async insertRecords(tx: LocalTransaction, ops: SyncOperation[]): Promise<void> {
    if (!ops || ops.length === 0) return;
    const CHUNK_SIZE = 50;
    for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
      const chunk = ops.slice(i, i + CHUNK_SIZE);
      const valueClauses: string[] = [];
      const params: any[] = [];
      for (const op of chunk) {
        valueClauses.push('(?, ?, ?, ?, ?, ?, "PENDING", 0)');
        params.push(
          op.id,
          op.tableName,
          op.rowId,
          op.operation,
          op.payload ? JSON.stringify(op.payload) : null,
          op.timestamp
        );
      }
      try {
        await tx.execute(
          `INSERT INTO sync_outbox (id, table_name, row_id, operation, payload, timestamp, status, retry_count) VALUES ${valueClauses.join(', ')}`,
          params
        );
      } catch {
        // Transparent fallback to per-record insert for mock drivers or custom engines
        for (const op of chunk) {
          await this.insertRecord(tx, op);
        }
      }
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

    return rows.map(mapOutboxRow);
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

    return mapOutboxRow(rows[0]);
  }

  /**
   * Retrieves active (non-FAILED) pending outbox records indexed by `${table_name}:${row_id}`.
   * Enables O(1) in-memory conflict lookup during delta ingestion, eliminating N+1 queries.
   */
  static async getActivePendingMap(tx: LocalTransaction): Promise<Map<string, OutboxRecord>> {
    const map = new Map<string, OutboxRecord>();
    try {
      const rows = await tx.execute(
        `SELECT * FROM sync_outbox WHERE status != 'FAILED' ORDER BY timestamp DESC`
      );
      if (!rows || rows.length === 0) return map;

      for (const r of rows) {
        const record = mapOutboxRow(r);
        const key = `${record.tableName}:${record.rowId}`;
        // Preserve the latest record for each table_name:row_id
        if (!map.has(key)) {
          map.set(key, record);
        }
      }
      return map;
    } catch {
      return map;
    }
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
   * Updates an outbox record's payload (used during conflict merge or coalescing).
   */
  static async updatePayload(
    tx: LocalTransaction,
    id: string,
    payload: Record<string, any>,
    timestamp?: number
  ): Promise<void> {
    if (timestamp) {
      await tx.execute(
        `UPDATE sync_outbox SET payload = ?, timestamp = ? WHERE id = ?`,
        [JSON.stringify(payload), timestamp, id]
      );
    } else {
      await tx.execute(
        `UPDATE sync_outbox SET payload = ? WHERE id = ?`,
        [JSON.stringify(payload), id]
      );
    }
  }

  /**
   * Updates an outbox record's operation and payload (used during mutation coalescing).
   */
  static async updateOperation(
    tx: LocalTransaction,
    id: string,
    operation: SyncOp,
    payload: Record<string, any> | null,
    timestamp?: number
  ): Promise<void> {
    const ts = timestamp ?? Date.now();
    await tx.execute(
      `UPDATE sync_outbox SET operation = ?, payload = ?, timestamp = ? WHERE id = ?`,
      [operation, payload ? JSON.stringify(payload) : null, ts, id]
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
      // Aggregate in SQLite (index-only scan) instead of loading every row and payload into JS.
      const rows = await db.execute(
        `SELECT status, COUNT(*) AS count FROM sync_outbox GROUP BY status`
      );

      let pending = 0;
      let failed = 0;
      let processing = 0;
      let total = 0;

      for (const row of rows || []) {
        const count = Number(row.count ?? 0);
        total += count;
        if (row.status === 'PENDING') pending = count;
        else if (row.status === 'FAILED') failed = count;
        else if (row.status === 'PROCESSING') processing = count;
      }

      return { pending, failed, processing, total };
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
        const rows = await db.execute(`SELECT COUNT(*) AS count FROM sync_outbox WHERE status = 'FAILED'`);
        const count = Number(rows?.[0]?.count ?? (Array.isArray(rows) ? rows.length : 0));
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
        const rows = await db.execute(`SELECT COUNT(*) AS count FROM sync_outbox WHERE status = 'FAILED'`);
        const count = Number(rows?.[0]?.count ?? (Array.isArray(rows) ? rows.length : 0));
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
      // Filter, order and paginate in SQLite so only the requested page is parsed.
      const params: any[] = [];
      let query = `SELECT * FROM sync_outbox`;
      if (options?.status) {
        query += ` WHERE status = ?`;
        params.push(options.status);
      }
      query += ` ORDER BY timestamp DESC`;

      const limit = options?.limit && options.limit > 0 ? options.limit : -1;
      const offset = options?.offset && options.offset > 0 ? options.offset : 0;
      if (limit > 0 || offset > 0) {
        // SQLite requires LIMIT when OFFSET is used; -1 means "no limit".
        query += ` LIMIT ? OFFSET ?`;
        params.push(limit, offset);
      }

      const rows = await db.execute(query, params);
      if (!rows || rows.length === 0) return [];
      return rows.map(mapOutboxRow);
    } catch {
      return [];
    }
  }
}
