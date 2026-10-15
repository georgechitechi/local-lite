import { LocalDBAdapter } from '../adapters/local/index.js';
import { RemoteDBAdapter } from '../adapters/remote/index.js';
import { EventEmitter } from '../reactive/event-emitter.js';
import {
  ConflictEvent,
  ConflictResolver,
  ConflictStrategy,
  DeltaChanges,
  NetworkStatusProvider,
  OutboxRecord,
  PullEvent,
  PushEvent,
  RetryConfig,
  SyncMetrics,
  SyncOperation,
  SyncStatusEvent,
} from './types.js';
import { getConflictResolver } from './conflict.js';
import { DefaultNetworkStatusProvider } from '../adapters/network/index.js';
import { OutboxStore } from './outbox-store.js';
import { MetaStore } from './meta-store.js';
import { TableManager } from './table-manager.js';
import { SchemaManager } from './schema-manager.js';
import { SyncLogger, CustomLogger, LogLevel, defaultLogger } from '../utils/logger.js';

export interface SyncWorkerOptions {
  pushIntervalMs?: number;
  pullIntervalMs?: number;
  maxRetries?: number;
  retry?: number | RetryConfig;
  logger?: SyncLogger | CustomLogger | boolean;
  logLevel?: LogLevel;
  conflictResolver?: ConflictStrategy | ConflictResolver;
  network?: NetworkStatusProvider;
  primaryKey?: string;
  autoSchema?: boolean;
  schemaManager?: SchemaManager;
  autoSync?: boolean;
}

export class SyncWorker {
  private db: LocalDBAdapter;
  private remote: RemoteDBAdapter;
  private events: EventEmitter;
  private network: NetworkStatusProvider;
  private conflictResolver: ConflictResolver;
  private primaryKey: string;
  private autoSchema: boolean;
  private schemaManager?: SchemaManager;
  public logger: SyncLogger;
  public retryConfig: RetryConfig;

  private pushIntervalMs: number;
  private pullIntervalMs: number;
  private maxRetries: number;

  private pushIntervalTimer?: any;
  private pullIntervalTimer?: any;
  private pushDebounceTimer?: any;
  private networkUnsubscribe?: () => void;
  private remoteUnsubscribe?: () => void;
  private subscriptionGeneration = 0;
  private automaticSync: boolean;

  private isPushing = false;
  private isPulling = false;
  private lastPulledTimestamp = 0;
  private cursorLoaded = false;
  private deltaQueue: Promise<void> = Promise.resolve();

  // Telemetry metrics
  private totalPushedOperations = 0;
  private totalPulledDeltas = 0;
  private totalPushCycles = 0;
  private totalPullCycles = 0;
  private lastPushDurationMs = 0;
  private lastPullDurationMs = 0;
  private lastPushTimestamp = 0;
  private lastPullTimestamp = 0;
  private lastPushError: string | null = null;
  private lastPullError: string | null = null;

  constructor(
    db: LocalDBAdapter,
    remote: RemoteDBAdapter,
    events: EventEmitter,
    options: SyncWorkerOptions = {}
  ) {
    this.db = db;
    this.automaticSync = options.autoSync ?? true;
    this.remote = remote;
    this.events = events;
    this.network = options.network ?? new DefaultNetworkStatusProvider();
    this.conflictResolver = getConflictResolver(options.conflictResolver ?? 'last-write-wins');
    this.primaryKey = options.primaryKey ?? 'id';
    this.autoSchema = options.autoSchema ?? false;
    this.schemaManager = options.schemaManager;
    this.pushIntervalMs = options.pushIntervalMs ?? 5000;
    this.pullIntervalMs = options.pullIntervalMs ?? 10000;

    // Configure logger
    if (options.logger instanceof SyncLogger) {
      this.logger = options.logger;
    } else if (typeof options.logger === 'boolean') {
      this.logger = new SyncLogger({ enabled: options.logger, level: options.logLevel });
    } else if (options.logger && typeof options.logger === 'object') {
      this.logger = new SyncLogger({ customLogger: options.logger, level: options.logLevel });
    } else {
      this.logger = options.logLevel ? new SyncLogger({ level: options.logLevel }) : defaultLogger;
    }

    // Configure retries & backoff
    const r = options.retry;
    if (typeof r === 'number') {
      this.retryConfig = {
        maxRetries: r,
        initialDelayMs: 1000,
        backoffMultiplier: 1.5,
        maxDelayMs: 30000,
        jitter: true,
      };
    } else if (typeof r === 'object' && r !== null) {
      this.retryConfig = {
        maxRetries: r.maxRetries ?? options.maxRetries ?? 5,
        initialDelayMs: r.initialDelayMs ?? 1000,
        backoffMultiplier: r.backoffMultiplier ?? 1.5,
        maxDelayMs: r.maxDelayMs ?? 30000,
        jitter: r.jitter ?? true,
        shouldRetry: r.shouldRetry,
      };
    } else {
      this.retryConfig = {
        maxRetries: options.maxRetries ?? 5,
        initialDelayMs: 1000,
        backoffMultiplier: 1.5,
        maxDelayMs: 30000,
        jitter: true,
      };
    }
    this.maxRetries = this.retryConfig.maxRetries ?? 5;
  }

  /**
   * Starts background interval push/pull loops and listens for network & realtime updates.
   */
  start(): void {
    this.stop();
    this.automaticSync = true;
    const generation = this.subscriptionGeneration;

    this.pushIntervalTimer = setInterval(() => this.pushLocalChanges(), this.pushIntervalMs);
    this.pullIntervalTimer = setInterval(() => this.pullRemoteChanges(), this.pullIntervalMs);

    // Subscribe to live remote changes
    const unsubscribe = this.remote.subscribeToLiveChanges((deltas) => {
      if (generation !== this.subscriptionGeneration) return;
      // A realtime event is not a complete pull page and cannot advance its checkpoint.
      this.applyDeltasLocally(deltas, { advanceCursor: false }).catch((err) => {
        this.logger.error('Error applying live remote deltas:', err);
      });
    });

    if (typeof unsubscribe === 'function') this.remoteUnsubscribe = unsubscribe;

    // Subscribe to network connectivity changes
    this.networkUnsubscribe = this.network.subscribe((online) => {
      this.emitStatus();
      if (online) {
        this.schedulePush(0);
        this.pullRemoteChanges().catch((err) => {
          this.logger.error('Error pulling changes on reconnect:', err);
        });
      }
    });

    // Initial pull
    this.pullRemoteChanges().catch((err) => {
      this.logger.error('Initial pull failed:', err);
    });

    this.emitStatus();
  }

  /**
   * Stops all active intervals, timers, and listeners.
   */
  stop(): void {
    this.automaticSync = false;
    this.subscriptionGeneration++;
    if (this.remoteUnsubscribe) {
      this.remoteUnsubscribe();
      this.remoteUnsubscribe = undefined;
    }
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
    if (!this.automaticSync) return;
    if (this.pushDebounceTimer) {
      clearTimeout(this.pushDebounceTimer);
    }
    this.pushDebounceTimer = setTimeout(() => {
      this.pushDebounceTimer = undefined;
      this.pushLocalChanges().catch((err) => {
        this.logger.error('Debounced push failed:', err);
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

  private async emitStatus(): Promise<void> {
    try {
      const online = await this.isOnline();
      const counts = await OutboxStore.getCounts(this.db);
      const statusEvent: SyncStatusEvent = {
        isOnline: online,
        isPushing: this.isPushing,
        isPulling: this.isPulling,
        pendingCount: counts.pending,
      };
      this.events.emit('sync:status', statusEvent);
    } catch {
      // Ignored
    }
  }

  /**
   * Pushes pending outbox records to the remote database.
   */
  async pushLocalChanges(): Promise<void> {
    if (this.isPushing) return;

    this.isPushing = true;
    this.emitStatus();
    const startTime = Date.now();
    let pendingRecords: OutboxRecord[] = [];

    try {
      if (!(await this.isOnline())) return;
      this.totalPushCycles++;
      // No push is active: recover records left behind by a failed status write.
      await OutboxStore.resetStaleProcessing(this.db);
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
      const durationMs = Date.now() - startTime;
      this.lastPushDurationMs = durationMs;
      this.lastPushTimestamp = Date.now();

      if (success) {
        // Successful push: delete rows from outbox
        await OutboxStore.deleteCompleted(this.db, recordIds);
        this.totalPushedOperations += operations.length;
        this.lastPushError = null;

        const pushEvent: PushEvent = {
          success: true,
          count: operations.length,
          durationMs,
          error: null,
        };
        this.events.emit('sync:push', pushEvent);
        this.events.emit('sync_outbox', { operation: 'DELETE', rowId: 'batch' });
      } else {
        const errMsg = 'Remote push returned false';
        this.lastPushError = errMsg;
        const pushEvent: PushEvent = {
          success: false,
          count: operations.length,
          durationMs,
          error: errMsg,
        };
        this.events.emit('sync:push', pushEvent);
        await this.handlePushFailure(pendingRecords, errMsg);
      }
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      this.lastPushDurationMs = durationMs;
      this.lastPushTimestamp = Date.now();
      const errMsg = error?.message || String(error);
      this.lastPushError = errMsg;

      this.logger.error('Sync Engine Outbox Push Error:', error);
      const pushEvent: PushEvent = {
        success: false,
        count: pendingRecords.length,
        durationMs,
        error: errMsg,
      };
      this.events.emit('sync:push', pushEvent);

      if (pendingRecords.length > 0) {
        await this.handlePushFailure(pendingRecords, errMsg, error);
      }
    } finally {
      this.isPushing = false;
      this.emitStatus();
    }
  }

  private async handlePushFailure(
    records: OutboxRecord[],
    errorMessage: string,
    errorObj?: any
  ): Promise<void> {
    try {
      const recordIds = records.map((r) => r.id);
      await OutboxStore.markFailed(this.db, recordIds, errorMessage);
      this.events.emit('sync_outbox', { operation: 'UPDATE', rowId: 'batch' });

      // If custom shouldRetry filter specifies an operation should NOT be retried, mark it FAILED permanently
      if (this.retryConfig.shouldRetry && errorObj) {
        for (const rec of records) {
          if (!this.retryConfig.shouldRetry(errorObj, rec)) {
            await OutboxStore.markFailed(this.db, [rec.id], `Non-retryable error: ${errorMessage}`);
          }
        }
      }

      // Schedule next retry with exponential backoff & optional jitter
      const currentRetry = Math.max(...records.map((r) => r.retryCount || 0));
      const isInfinite = !Number.isFinite(this.maxRetries) || this.maxRetries === -1;
      if (isInfinite || currentRetry < this.maxRetries) {
        let backoffDelay = Math.min(
          (this.retryConfig.initialDelayMs || 1000) *
          Math.pow(this.retryConfig.backoffMultiplier || 1.5, currentRetry),
          this.retryConfig.maxDelayMs || 30000
        );

        // Apply ±15% jitter if enabled to avoid synchronized retry stampedes
        if (this.retryConfig.jitter !== false) {
          const jitterFactor = 0.85 + Math.random() * 0.3;
          backoffDelay = Math.round(backoffDelay * jitterFactor);
        }

        this.schedulePush(backoffDelay);
      }
    } catch (err) {
      this.logger.error('Failed to update outbox failure status:', err);
    }
  }

  /**
   * Pulls delta changes from the remote backend since lastPulledTimestamp.
   */
  async pullRemoteChanges(): Promise<void> {
    if (this.isPulling) return;

    this.isPulling = true;
    this.emitStatus();
    const startTime = Date.now();

    try {
      if (!(await this.isOnline())) return;
      this.totalPullCycles++;
      if (!this.cursorLoaded) {
        this.lastPulledTimestamp = await MetaStore.getLastSyncedAt(this.db);
        this.cursorLoaded = true;
      }

      const deltas = await this.remote.fetchChanges(this.lastPulledTimestamp);
      const durationMs = Date.now() - startTime;
      this.lastPullDurationMs = durationMs;
      this.lastPullTimestamp = Date.now();
      this.lastPullError = null;

      const changesCount = deltas?.changes?.length || 0;
      if (deltas) {
        this.totalPulledDeltas += changesCount;
        await this.applyDeltasLocally(deltas);
      }

      const pullEvent: PullEvent = {
        success: true,
        changesCount,
        durationMs,
        timestamp: this.lastPulledTimestamp,
        error: null,
      };
      this.events.emit('sync:pull', pullEvent);
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      this.lastPullDurationMs = durationMs;
      this.lastPullTimestamp = Date.now();
      const errMsg = error?.message || String(error);
      this.lastPullError = errMsg;

      this.logger.error('Sync Engine Delta Pull Error:', error);
      const pullEvent: PullEvent = {
        success: false,
        changesCount: 0,
        durationMs,
        timestamp: this.lastPulledTimestamp,
        error: errMsg,
      };
      this.events.emit('sync:pull', pullEvent);
    } finally {
      this.isPulling = false;
      this.emitStatus();
    }
  }

  /**
   * Applies incoming server delta changes to local tables with conflict resolution.
   * Serializes execution in a queue to prevent concurrent SQLite transactions.
   */
  async applyDeltasLocally(
    deltas: DeltaChanges,
    options: { advanceCursor?: boolean } = {}
  ): Promise<void> {
    const task = async () => {
      await this.getLastPulledTimestamp();
      await this.processDeltasLocally(
        options.advanceCursor === false ? { ...deltas, timestamp: 0 } : deltas
      );
    };

    const next = this.deltaQueue.then(task, task);
    this.deltaQueue = next.catch(() => { });
    return await next;
  }

  private async processDeltasLocally(deltas: DeltaChanges): Promise<void> {
    if (!deltas.changes || deltas.changes.length === 0) {
      if (deltas.timestamp && deltas.timestamp > this.lastPulledTimestamp) {
        await MetaStore.setLastSyncedAt(this.db, deltas.timestamp);
        this.lastPulledTimestamp = deltas.timestamp;
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
          this.primaryKey,
          { autoSchema: this.autoSchema, schemaManager: this.schemaManager }
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

          const resolutionStr = typeof resolution === 'string' ? resolution : 'merge';
          const conflictEvent: ConflictEvent = {
            tableName: change.tableName,
            rowId: change.rowId,
            resolution: resolutionStr,
            timestamp: Date.now(),
          };
          this.events.emit('sync:conflict', conflictEvent);

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
          this.primaryKey,
          { autoSchema: this.autoSchema, schemaManager: this.schemaManager }
        );

        // 5. Emit table change event to notify reactive listeners
        this.events.emit(change.tableName, {
          operation: change.operation,
          rowId: change.rowId,
          payload: change.payload,
          source: 'remote',
        });
      }

      // Persist sync cursor atomically within the same transaction as delta writes
      if (deltas.timestamp && deltas.timestamp > this.lastPulledTimestamp) {
        await MetaStore.setLastSyncedAt(tx, deltas.timestamp);
      }
    });

    if (deltas.timestamp) {
      this.lastPulledTimestamp = Math.max(this.lastPulledTimestamp, deltas.timestamp);
    }
  }

  async getLastPulledTimestamp(): Promise<number> {
    if (!this.cursorLoaded) {
      this.lastPulledTimestamp = await MetaStore.getLastSyncedAt(this.db);
      this.cursorLoaded = true;
    }
    return this.lastPulledTimestamp;
  }

  async resetSyncCursor(): Promise<void> {
    await MetaStore.clearLastSyncedAt(this.db);
    this.lastPulledTimestamp = 0;
    this.cursorLoaded = true;
  }

  /**
   * Collects real-time engine telemetry snapshot.
   */
  async getMetrics(): Promise<SyncMetrics> {
    const counts = await OutboxStore.getCounts(this.db);
    const online = await this.isOnline();
    return {
      outboxPendingCount: counts.pending,
      outboxFailedCount: counts.failed,
      outboxProcessingCount: counts.processing,
      totalPushedOperations: this.totalPushedOperations,
      totalPulledDeltas: this.totalPulledDeltas,
      totalPushCycles: this.totalPushCycles,
      totalPullCycles: this.totalPullCycles,
      lastPushDurationMs: this.lastPushDurationMs,
      lastPullDurationMs: this.lastPullDurationMs,
      lastPushTimestamp: this.lastPushTimestamp,
      lastPullTimestamp: this.lastPullTimestamp,
      lastPushError: this.lastPushError,
      lastPullError: this.lastPullError,
      isOnline: online,
      isPushing: this.isPushing,
      isPulling: this.isPulling,
    };
  }
}
