import { LocalDBAdapter } from '../adapters/local/index.js';
import { RemoteDBAdapter } from '../adapters/remote/index.js';
import { EventEmitter } from '../reactive/event-emitter.js';
import {
  ConflictResolver,
  ConflictStrategy,
  DeltaChanges,
  NetworkStatusProvider,
  OutboxRecord,
  SyncOperation,
} from './types.js';
import { getConflictResolver } from './conflict.js';
import { DefaultNetworkStatusProvider } from '../adapters/network/index.js';
import { OutboxStore } from './outbox-store.js';
import { TableManager } from './table-manager.js';

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

  /**
   * Starts background interval push/pull loops and listens for network & realtime updates.
   */
  start(): void {
    this.stop();

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

  /**
   * Stops all active intervals, timers, and listeners.
   */
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

  /**
   * Schedules an immediate push with a short debounce.
   */
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

  /**
   * Pushes pending outbox records to the remote database.
   */
  async pushLocalChanges(): Promise<void> {
    if (this.isPushing) return;
    if (!(await this.isOnline())) return;

    this.isPushing = true;
    let pendingRecords: OutboxRecord[] = [];

    try {
      pendingRecords = await OutboxStore.getPending(this.db, this.maxRetries);

      if (pendingRecords.length === 0) {
        return;
      }

      const operations: SyncOperation[] = pendingRecords.map((r) => ({
        id: r.id,
        tableName: r.tableName,
        rowId: r.rowId,
        operation: r.operation,
        payload: r.payload,
        timestamp: r.timestamp,
      }));

      const recordIds = operations.map((o) => o.id);

      // Mark records as PROCESSING
      await OutboxStore.markProcessing(this.db, recordIds);

      const success = await this.remote.pushChanges(operations);

      if (success) {
        // Successful push: delete rows from outbox
        await OutboxStore.deleteCompleted(this.db, recordIds);
        this.events.emit('sync_outbox', { operation: 'DELETE', rowId: 'batch' });
      } else {
        await this.handlePushFailure(recordIds, 'Remote push returned false');
      }
    } catch (error: any) {
      console.error('Sync Engine Outbox Push Error:', error);
      if (pendingRecords.length > 0) {
        const recordIds = pendingRecords.map((r) => r.id);
        await this.handlePushFailure(recordIds, error?.message || String(error));
      }
    } finally {
      this.isPushing = false;
    }
  }

  private async handlePushFailure(recordIds: string[], errorMessage: string): Promise<void> {
    try {
      await OutboxStore.markFailed(this.db, recordIds, errorMessage);
      this.events.emit('sync_outbox', { operation: 'UPDATE', rowId: 'batch' });
    } catch (err) {
      console.error('Failed to update outbox failure status:', err);
    }
  }

  /**
   * Pulls delta changes from the remote backend since lastPulledTimestamp.
   */
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

  /**
   * Applies incoming server delta changes to local tables with conflict resolution.
   */
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
        const localPendingRecord = await OutboxStore.findPendingByRow(
          tx,
          change.tableName,
          change.rowId
        );

        // 2. Query current local row if it exists
        const localRow = await TableManager.fetchRow(
          tx,
          change.tableName,
          change.rowId,
          this.primaryKey
        );

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
            // Local offline change takes precedence
            continue;
          }

          if (resolution === 'apply-remote') {
            // Remote change wins: remove the superseded local pending outbox mutation
            await OutboxStore.deleteRecord(tx, localPendingRecord.id);
          } else if (typeof resolution === 'object' && resolution.mergePayload) {
            // Merge scenario
            change.payload = resolution.mergePayload;
            await OutboxStore.updatePayload(tx, localPendingRecord.id, resolution.mergePayload);
          }
        }

        // 4. Apply remote change to local database
        await TableManager.applyMutation(
          tx,
          change.tableName,
          change.rowId,
          change.operation,
          change.payload,
          this.primaryKey
        );

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

  getLastPulledTimestamp(): number {
    return this.lastPulledTimestamp;
  }
}