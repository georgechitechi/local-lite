import { LocalDBAdapter } from '../adapters/local/index.js';
import { OutboxStatus } from './types.js';
import { escapeIdentifier, isInternalTable } from '../utils/sql.js';

export interface PruneOutboxOptions {
  /**
   * Only delete outbox records older than this many days.
   * e.g. retentionDays: 7 deletes records older than 7 days.
   */
  retentionDays?: number;

  /**
   * Explicit cutoff timestamp in milliseconds. Records older than this timestamp are eligible.
   */
  beforeTimestamp?: number;

  /**
   * Maximum number of outbox entries to retain. If the outbox exceeds this count,
   * the oldest matching records are pruned.
   */
  maxEntries?: number;

  /**
   * Target statuses to prune. Defaults to ['COMPLETED', 'FAILED'].
   * PENDING records are protected from pruning by default unless explicitly included.
   */
  statuses?: OutboxStatus[];
}

export interface OutboxStorageStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface StorageStats {
  /** Row count per table */
  tables: Record<string, number>;
  /** Breakdown of sync outbox items */
  outbox: OutboxStorageStats;
  /** SQLite allocation page size in bytes */
  pageSize: number;
  /** Total allocated SQLite database pages */
  pageCount: number;
  /** Total calculated database size on disk in bytes */
  databaseSizeBytes: number;
}

export type CheckpointMode = 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE';

export class DatabaseMaintenance {
  constructor(
    private readonly db: LocalDBAdapter,
    private readonly getKnownTables: () => string[] = () => [],
  ) {}

  /**
   * Reclaims unused space, defragments the database file, and optimizes internal B-trees.
   */
  async vacuum(): Promise<void> {
    await this.db.execute('VACUUM');
  }

  /**
   * Checkpoints WAL (Write-Ahead Log) pages into the main database file.
   * 'TRUNCATE' (default) copies all WAL frames to the database file and resets WAL size to zero.
   */
  async checkpoint(mode: CheckpointMode = 'TRUNCATE'): Promise<void> {
    await this.db.execute(`PRAGMA wal_checkpoint(${mode})`);
  }

  /**
   * Prunes old or completed mutations from the sync_outbox table to keep database footprint small.
   * Returns the count of deleted outbox records.
   */
  async pruneOutbox(options: PruneOutboxOptions = {}): Promise<number> {
    const statuses = options.statuses ?? ['COMPLETED', 'FAILED'];
    if (statuses.length === 0) return 0;

    let cutoffTimestamp: number | undefined = options.beforeTimestamp;
    if (options.retentionDays !== undefined && options.retentionDays >= 0) {
      const daysMs = options.retentionDays * 24 * 60 * 60 * 1000;
      const calculatedCutoff = Date.now() - daysMs;
      cutoffTimestamp = cutoffTimestamp !== undefined
        ? Math.min(cutoffTimestamp, calculatedCutoff)
        : calculatedCutoff;
    }

    const conditions: string[] = [];
    const params: any[] = [];

    const statusPlaceholders = statuses.map(() => '?').join(', ');
    conditions.push(`status IN (${statusPlaceholders})`);
    params.push(...statuses);

    if (cutoffTimestamp !== undefined) {
      conditions.push('timestamp < ?');
      params.push(cutoffTimestamp);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // If maxEntries is set, only prune if total matching exceeds maxEntries
    if (options.maxEntries !== undefined && options.maxEntries >= 0) {
      const countRes = await this.db.execute(
        `SELECT COUNT(*) as total FROM sync_outbox ${whereClause}`,
        params,
      );
      const totalMatching = Number(countRes[0]?.total ?? 0);
      const excess = totalMatching - options.maxEntries;
      if (excess <= 0) {
        return 0;
      }

      // Delete the oldest `excess` records
      const selectOldest = await this.db.execute(
        `SELECT id FROM sync_outbox ${whereClause} ORDER BY timestamp ASC LIMIT ?`,
        [...params, excess],
      );
      if (selectOldest.length === 0) return 0;

      const ids = selectOldest.map((r: any) => r.id);
      const idPlaceholders = ids.map(() => '?').join(', ');
      await this.db.execute(
        `DELETE FROM sync_outbox WHERE id IN (${idPlaceholders})`,
        ids,
      );
      return ids.length;
    }

    // Standard cutoff delete
    const beforeCountRes = await this.db.execute(
      `SELECT COUNT(*) as total FROM sync_outbox ${whereClause}`,
      params,
    );
    const toDeleteCount = Number(beforeCountRes[0]?.total ?? 0);
    if (toDeleteCount === 0) return 0;

    await this.db.execute(`DELETE FROM sync_outbox ${whereClause}`, params);
    return toDeleteCount;
  }

  /**
   * Gathers storage metrics: table row counts, outbox status distribution, and database size.
   */
  async getStorageStats(options: { includeInternal?: boolean } = {}): Promise<StorageStats> {
    const includeInternal = options.includeInternal ?? false;
    // 1. Table row counts
    const tableCounts: Record<string, number> = {};
    let tableNames: string[] = [];

    try {
      const masterRows = await this.db.execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'android_%'`,
      );
      tableNames = masterRows.map((r: any) => r.name);
    } catch {
      tableNames = this.getKnownTables();
    }

    if (!includeInternal) {
      tableNames = tableNames.filter(name => !isInternalTable(name));
    }

    for (const tableName of tableNames) {
      try {
        const safeTable = escapeIdentifier(tableName);
        const rows = await this.db.execute(`SELECT COUNT(*) as count FROM ${safeTable}`);
        tableCounts[tableName] = Number(rows[0]?.count ?? 0);
      } catch {
        // Table might not exist or be accessible
      }
    }

    // 2. Outbox breakdown
    const outboxStats: OutboxStorageStats = {
      total: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };

    try {
      const outboxRows = await this.db.execute(
        `SELECT status, COUNT(*) as count FROM sync_outbox GROUP BY status`,
      );
      for (const row of outboxRows) {
        const st = String(row.status).toUpperCase();
        const cnt = Number(row.count ?? 0);
        outboxStats.total += cnt;
        if (st === 'PENDING') outboxStats.pending = cnt;
        else if (st === 'PROCESSING') outboxStats.processing = cnt;
        else if (st === 'COMPLETED') outboxStats.completed = cnt;
        else if (st === 'FAILED') outboxStats.failed = cnt;
      }
    } catch {
      // sync_outbox table may not exist yet
    }

    // 3. SQLite database sizing via PRAGMAs
    let pageSize = 4096;
    let pageCount = 0;

    try {
      const pageSizeRes = await this.db.execute('PRAGMA page_size');
      if (pageSizeRes[0]) {
        pageSize = Number(Object.values(pageSizeRes[0])[0] ?? 4096);
      }
    } catch {
      // fallback
    }

    try {
      const pageCountRes = await this.db.execute('PRAGMA page_count');
      if (pageCountRes[0]) {
        pageCount = Number(Object.values(pageCountRes[0])[0] ?? 0);
      }
    } catch {
      // fallback
    }

    return {
      tables: tableCounts,
      outbox: outboxStats,
      pageSize,
      pageCount,
      databaseSizeBytes: pageSize * pageCount,
    };
  }
}
