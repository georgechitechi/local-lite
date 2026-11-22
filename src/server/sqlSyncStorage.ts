import type { DeltaChanges, SyncOperation, SyncOp } from '../core/types.js';
import { quoteIdent, type SqlExecutor } from './sqlDialect.js';
import type { ServerSyncStorage } from './sync.js';
import type { SyncEventBroker } from './syncEvents.js';

export interface SqlServerSyncStorageOptions {
  changesTable?: string;
  clockTable?: string;
  scopeField?: string;
  broker?: SyncEventBroker;
}

export class SqlServerSyncStorage implements ServerSyncStorage {
  private executor: SqlExecutor;
  private changesTable: string;
  private clockTable: string;
  private scopeField: string;
  private broker?: SyncEventBroker;

  constructor(
    executor: SqlExecutor,
    options: SqlServerSyncStorageOptions = {},
  ) {
    this.executor = executor;
    this.changesTable = options.changesTable ?? '_server_changes';
    this.clockTable = options.clockTable ?? '_server_sync_clock';
    this.scopeField = options.scopeField ?? 'scope_id';
    this.broker = options.broker;
  }

  async applyOperations(
    operations: SyncOperation[],
    overrideTime?: number,
  ): Promise<{
    applied: number;
    successfulIds: string[];
    serverTime: number;
    cursor: number;
  }> {
    const serverTime = overrideTime ?? Date.now();
    const qChanges = quoteIdent(this.changesTable, this.executor.dialect);
    const qClock = quoteIdent(this.clockTable, this.executor.dialect);
    const qTs = quoteIdent('timestamp', this.executor.dialect);
    const successfulIds: string[] = [];
    const emitted: Array<{
      scopeId: string;
      tableName: string;
      checkpoint: number;
    }> = [];

    const lastCursor = await this.executor.withTransaction(async (tx) => {
      const clockRows = await tx.query<{ checkpoint: number }>(
        `SELECT checkpoint FROM ${qClock} WHERE id = 1`,
      );
      const latestRows = await tx.query<{ checkpoint: number }>(
        `SELECT COALESCE(MAX(${qTs}), 0) AS checkpoint FROM ${qChanges}`,
      );
      let checkpoint = Math.max(
        serverTime,
        Number(clockRows[0]?.checkpoint ?? 0),
        Number(latestRows[0]?.checkpoint ?? 0),
      );

      for (const op of operations) {
        if (!op.tableName || !op.rowId) continue;
        checkpoint += 1;
        const payload = op.payload || {};
        const scopeId = String(payload[this.scopeField] || '');
        const userId = String(payload.user_id || '');
        const operation: SyncOp = op.operation || 'UPDATE';

        await tx.execute(
          `INSERT INTO ${qChanges} (table_name, row_id, ${quoteIdent(this.scopeField, this.executor.dialect)}, user_id, payload, operation, ${qTs}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            op.tableName,
            String(op.rowId),
            scopeId,
            userId,
            JSON.stringify(payload),
            operation,
            checkpoint,
          ],
        );
        successfulIds.push(op.id || op.rowId);
        if (scopeId) {
          emitted.push({ scopeId, tableName: op.tableName, checkpoint });
        }
      }

      await tx.execute(`UPDATE ${qClock} SET checkpoint = ? WHERE id = 1`, [
        checkpoint,
      ]);
      return checkpoint;
    });

    if (this.broker) {
      for (const ev of emitted) {
        this.broker.publish(ev);
      }
    }

    return {
      applied: successfulIds.length,
      successfulIds,
      serverTime,
      cursor: lastCursor,
    };
  }

  async getDeltas(
    tables: string[],
    since: number,
    limit = 500,
  ): Promise<{
    changes: DeltaChanges;
    cursor: number;
    hasMore: boolean;
    serverTime: number;
  }> {
    const qChanges = quoteIdent(this.changesTable, this.executor.dialect);
    const qTs = quoteIdent('timestamp', this.executor.dialect);
    const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
    const params: any[] = [since];
    let sql = `SELECT table_name, row_id, payload, operation, ${qTs} AS ts FROM ${qChanges} WHERE ${qTs} > ?`;

    if (tables.length > 0) {
      const placeholders = tables.map(() => '?').join(', ');
      sql += ` AND table_name IN (${placeholders})`;
      params.push(...tables);
    }

    sql += ` ORDER BY ${qTs} ASC LIMIT ?`;
    params.push(safeLimit + 1);

    const rows = await this.executor.query<any>(sql, params);
    const hasMore = rows.length > safeLimit;
    const slice = hasMore ? rows.slice(0, safeLimit) : rows;

    let maxTs = since;
    const changes: any[] = [];
    for (const row of slice) {
      const ts = Number(row.ts ?? 0);
      if (ts > maxTs) maxTs = ts;
      let payload = row.payload;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          payload = {};
        }
      }
      changes.push({
        tableName: String(row.table_name),
        rowId: String(row.row_id),
        operation: row.operation,
        payload: payload || {},
        timestamp: ts,
      });
    }

    return {
      changes: {
        timestamp: maxTs,
        changes,
        hasMore,
      },
      cursor: maxTs,
      hasMore,
      serverTime: Date.now(),
    };
  }
}
