import { LocalDBAdapter, LocalTransaction } from '../adapters/local/index.js';
import { RemoteDBAdapter } from '../adapters/remote/index.js';
import { EventEmitter } from '../reactive/event-emitter.js';
import {
  ConflictResolver,
  ConflictStrategy,
  DeltaChange,
  DeltaChanges,
  NetworkStatusProvider,
  OutboxRecord,
  SyncOperation,
} from './types.js';
import { getConflictResolver } from './conflict.js';
import { DefaultNetworkStatusProvider } from '../adapters/network/index.js';

export interface SyncWorkerOptions {
  pushIntervalMs?: number;
  pullIntervalMs?: number;
  maxRetries?: number;
  conflictResolver?: ConflictStrategy | ConflictResolver;
  network?: NetworkStatusProvider;
  primaryKey?: string;
}

export class SyncWorker {
  private db: LocalDBAdapter;
  private remote: RemoteDBAdapter;
  private events: EventEmitter;
  private network: NetworkStatusProvider;
  private conflictResolver: ConflictResolver;
  private primaryKey: string;

  private pushIntervalMs: number;
  private pullIntervalMs: number;
  private maxRetries: number;

  private pushIntervalTimer?: any;
  private pullIntervalTimer?: any;
  private pushDebounceTimer?: any;
  private networkUnsubscribe?: () => void;

  private isPushing = false;
  private isPulling = false;
  private lastPulledTimestamp = 0;

  constructor(
    db: LocalDBAdapter,
    remote: RemoteDBAdapter,
    events: EventEmitter,
    options: SyncWorkerOptions = {}
  ) {
    this.db = db;
    this.remote = remote;
    this.events = events;
    this.network = options.network ?? new DefaultNetworkStatusProvider();
    this.conflictResolver = getConflictResolver(options.conflictResolver ?? 'last-write-wins');
    this.primaryKey = options.primaryKey ?? 'id';
    this.pushIntervalMs = options.pushIntervalMs ?? 5000;
    this.pullIntervalMs = options.pullIntervalMs ?? 10000;
    this.maxRetries = options.maxRetries ?? 5;
  }

  start(): void {
    this.stop();

    // Regular interval loops
    this.pushIntervalTimer = setInterval(() => this.pushLocalChanges(), this.pushIntervalMs);
    this.pullIntervalTimer = setInterval(() => this.pullRemoteChanges(), this.pullIntervalMs);

    // Subscribe to live remote changes
    this.remote.subscribeToLiveChanges((deltas) => {
      this.applyDeltasLocally(deltas).catch((err) => {
        console.error('Error applying live remote deltas:', err);
      });
    });

    // Subscribe to network connectivity changes
    this.networkUnsubscribe = this.network.subscribe((online) => {
      if (online) {
        // Immediately push and pull when connectivity is restored
        this.schedulePush(0);
        this.pullRemoteChanges().catch((err) => {
          console.error('Error pulling changes on reconnect:', err);
        });
      }
    });

    // Initial pull
    this.pullRemoteChanges().catch((err) => {
      console.error('Initial pull failed:', err);
    });
  }

  stop(): void {
    if (this.pushIntervalTimer) {
      clearInterval(this.pushIntervalTimer);
      this.pushIntervalTimer = undefined;
    }
    if (this.pullIntervalTimer) {
      clearInterval(this.pullIntervalTimer);
      this.pullIntervalTimer = undefined;
    }
    if (this.pushDebounceTimer) {
      clearTimeout(this.pushDebounceTimer);
      this.pushDebounceTimer = undefined;
    }
    if (this.networkUnsubscribe) {
      this.networkUnsubscribe();
      this.networkUnsubscribe = undefined;
    }
  }

  schedulePush(delayMs: number = 50): void {
    if (this.pushDebounceTimer) {
      clearTimeout(this.pushDebounceTimer);
    }
    this.pushDebounceTimer = setTimeout(() => {
      this.pushDebounceTimer = undefined;
      this.pushLocalChanges().catch((err) => {
        console.error('Debounced push failed:', err);
      });
    }, delayMs);
  }

  private async isOnline(): Promise<boolean> {
    try {
      return await Promise.resolve(this.network.isOnline());
    } catch {
      return true;
    }
  }

  async pushLocalChanges(): Promise<void> {
    if (this.isPushing) return;
    if (!(await this.isOnline())) return;

    this.isPushing = true;
    let pendingRecords: any[] = [];

    try {
      pendingRecords = await this.db.execute(
        `SELECT * FROM sync_outbox 
         WHERE status = 'PENDING' OR (status = 'FAILED' AND retry_count < ?) 
         ORDER BY timestamp ASC LIMIT 50`,
        [this.maxRetries]
      );

      if (!pendingRecords || pendingRecords.length === 0) {
        return;
      }

      const operations: SyncOperation[] = pendingRecords.map((r: any) => ({
        id: r.id,
        tableName: r.table_name,
        rowId: r.row_id,
        operation: r.operation,
        payload: r.payload ? JSON.parse(r.payload) : null,
        timestamp: Number(r.timestamp),
      }));

      const recordIds = operations.map((o) => o.id);
      const inPlaceholders = recordIds.map(() => '?').join(',');

      // Mark as PROCESSING
      await this.db.execute(
        `UPDATE sync_outbox SET status = 'PROCESSING' WHERE id IN (${inPlaceholders})`,
        recordIds
      );

      const success = await this.remote.pushChanges(operations);

      if (success) {
        // Successful push: delete rows from outbox
        await this.db.execute(
          `DELETE FROM sync_outbox WHERE id IN (${inPlaceholders})`,
          recordIds
        );
        this.events.emit('sync_outbox', { operation: 'DELETE', rowId: 'batch' });
      } else {
        // Failed: record retry
        await this.handlePushFailure(recordIds, 'Remote push returned false');
      }
    } catch (error: any) {
      console.error('Sync Engine Outbox Push Error:', error);
      if (pendingRecords.length > 0) {
        const recordIds = pendingRecords.map((r: any) => r.id);
        await this.handlePushFailure(recordIds, error?.message || String(error));
      }
    } finally {
      this.isPushing = false;
    }
  }

  private async handlePushFailure(recordIds: string[], errorMessage: string): Promise<void> {
    try {
      const inPlaceholders = recordIds.map(() => '?').join(',');
      await this.db.execute(
        `UPDATE sync_outbox 
         SET status = 'FAILED', 
             retry_count = retry_count + 1, 
             last_error = ? 
         WHERE id IN (${inPlaceholders})`,
        [errorMessage, ...recordIds]
      );
      this.events.emit('sync_outbox', { operation: 'UPDATE', rowId: 'batch' });
    } catch (err) {
      console.error('Failed to update outbox failure status:', err);
    }
  }

  async pullRemoteChanges(): Promise<void> {
    if (this.isPulling) return;
    if (!(await this.isOnline())) return;

    this.isPulling = true;
    try {
      const deltas = await this.remote.fetchChanges(this.lastPulledTimestamp);
      if (deltas) {
        await this.applyDeltasLocally(deltas);
      }
    } catch (error) {
      console.error('Sync Engine Delta Pull Error:', error);
    } finally {
      this.isPulling = false;
    }
  }

  async applyDeltasLocally(deltas: DeltaChanges): Promise<void> {
    if (!deltas.changes || deltas.changes.length === 0) {
      if (deltas.timestamp) {
        this.lastPulledTimestamp = Math.max(this.lastPulledTimestamp, deltas.timestamp);
      }
      return;
    }

    await this.db.transaction(async (tx) => {
      for (const change of deltas.changes) {
        // 1. Check for pending local mutations for this (table_name, row_id)
        const pendingRows = await tx.execute(
          `SELECT * FROM sync_outbox 
           WHERE table_name = ? AND row_id = ? AND status != 'FAILED' 
           ORDER BY timestamp DESC LIMIT 1`,
          [change.tableName, change.rowId]
        );

        let localPendingRecord: OutboxRecord | undefined;
        if (pendingRows && pendingRows.length > 0) {
          const row = pendingRows[0];
          localPendingRecord = {
            id: row.id,
            tableName: row.table_name,
            rowId: row.row_id,
            operation: row.operation,
            payload: row.payload ? JSON.parse(row.payload) : null,
            timestamp: Number(row.timestamp),
            status: row.status,
            retryCount: Number(row.retry_count),
            lastError: row.last_error,
          };
        }

        // 2. Query current local row if it exists
        const safeTable = `"${change.tableName.replace(/"/g, '""')}"`;
        const safePk = `"${this.primaryKey.replace(/"/g, '""')}"`;
        const existingRows = await tx.execute(
          `SELECT * FROM ${safeTable} WHERE ${safePk} = ? LIMIT 1`,
          [change.rowId]
        );
        const localRow = existingRows && existingRows.length > 0 ? existingRows[0] : null;

        // 3. Conflict resolution if there is a pending local change
        if (localPendingRecord) {
          const resolution = await Promise.resolve(
            this.conflictResolver({
              tableName: change.tableName,
              rowId: change.rowId,
              remoteChange: change,
              localOutboxRecord: localPendingRecord,
              localRow,
            })
          );

          if (resolution === 'keep-local') {
            // Local change takes precedence; skip applying remote change
            continue;
          }

          if (resolution === 'apply-remote') {
            // Remote change wins; discard the superseded local pending outbox mutation
            await tx.execute(`DELETE FROM sync_outbox WHERE id = ?`, [localPendingRecord.id]);
          } else if (typeof resolution === 'object' && resolution.mergePayload) {
            // Merge scenario: update payload for remote change and local outbox
            change.payload = resolution.mergePayload;
            await tx.execute(
              `UPDATE sync_outbox SET payload = ? WHERE id = ?`,
              [JSON.stringify(resolution.mergePayload), localPendingRecord.id]
            );
          }
        }

        // 4. Apply remote change to local database
        await this.applyChangeToTable(tx, change);

        // 5. Emit table change event to notify reactive listeners
        this.events.emit(change.tableName, {
          operation: change.operation,
          rowId: change.rowId,
          payload: change.payload,
          source: 'remote',
        });
      }
    });

    if (deltas.timestamp) {
      this.lastPulledTimestamp = Math.max(this.lastPulledTimestamp, deltas.timestamp);
    }
  }

  private async applyChangeToTable(tx: LocalTransaction, change: DeltaChange): Promise<void> {
    const safeTable = `"${change.tableName.replace(/"/g, '""')}"`;
    const safePk = `"${this.primaryKey.replace(/"/g, '""')}"`;

    if (change.operation === 'DELETE') {
      await tx.execute(`DELETE FROM ${safeTable} WHERE ${safePk} = ?`, [change.rowId]);
      return;
    }

    const payload = change.payload || {};
    const rowData: Record<string, any> = { ...payload, [this.primaryKey]: change.rowId };
    const keys = Object.keys(rowData);
    if (keys.length === 0) return;

    const existing = await tx.execute(
      `SELECT 1 FROM ${safeTable} WHERE ${safePk} = ? LIMIT 1`,
      [change.rowId]
    );

    if (existing && existing.length > 0) {
      // Update existing record
      const updateKeys = keys.filter((k) => k !== this.primaryKey);
      if (updateKeys.length > 0) {
        const setClause = updateKeys.map((k) => `"${k.replace(/"/g, '""')}" = ?`).join(', ');
        const values = updateKeys.map((k) => rowData[k]);
        values.push(change.rowId);
        await tx.execute(`UPDATE ${safeTable} SET ${setClause} WHERE ${safePk} = ?`, values);
      }
    } else {
      // Insert new record
      const cols = keys.map((k) => `"${k.replace(/"/g, '""')}"`).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map((k) => rowData[k]);
      await tx.execute(`INSERT INTO ${safeTable} (${cols}) VALUES (${placeholders})`, values);
    }
  }

  getLastPulledTimestamp(): number {
    return this.lastPulledTimestamp;
  }
}