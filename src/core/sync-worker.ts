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
import { SyncLogger, CustomLogger, LogLevel, createSyncLogger } from '../utils/logger.js';
import { safeDynamicRequire } from '../utils/dynamic.js';
const REACT_NATIVE_PKG = ['react', 'native'].join('-');

/** Maximum outbox records sent per push cycle. */
const PUSH_BATCH_SIZE = 50;

/** Maximum incoming delta changes applied in a single database transaction. */
const DELTA_CHUNK_SIZE = 250;

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
  syncScope?: Record<string, any> | (() => Record<string, any> | Promise<Record<string, any>>);
  autoPauseOnBackground?: boolean;
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
  private syncScope?: Record<string, any> | (() => Record<string, any> | Promise<Record<string, any>>);
  public logger: SyncLogger;
  public retryConfig: RetryConfig;

  private pushIntervalMs: number;
  private pullIntervalMs: number;
  private maxRetries: number;
  private autoPauseOnBackground: boolean;
  private isPaused = false;
  private lifecycleUnsubscribe?: () => void;

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
  private statusRun?: Promise<void>;
  private statusRerunRequested = false;

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
    this.syncScope = options.syncScope;
    this.autoPauseOnBackground = options.autoPauseOnBackground ?? true;

    this.logger = createSyncLogger(options.logger, options.logLevel);

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
    this.isPaused = false;
    const generation = this.subscriptionGeneration;

    this.setupLifecycleListener();

    // If currently backgrounded, pause immediately and wait for foreground
    if (this.isAppBackgrounded()) {
      this.isPaused = true;
      this.logger.info('App currently in background: sync worker paused until foreground');
      this.emitStatus();
      return;
    }

    this.pushIntervalTimer = setInterval(() => this.pushLocalChanges(), this.pushIntervalMs);
    this.pullIntervalTimer = setInterval(() => this.pullRemoteChanges(), this.pullIntervalMs);

    // Subscribe to live remote changes
    const unsubscribe = this.remote.subscribeToLiveChanges((deltas) => {
      if (generation !== this.subscriptionGeneration || this.isPaused) return;
      // A realtime event is not a complete pull page and cannot advance its checkpoint.
      this.applyDeltasLocally(deltas, { advanceCursor: false }).catch((err) => {
        this.logger.error('Error applying live remote deltas:', err);
      });
    });

    if (typeof unsubscribe === 'function') this.remoteUnsubscribe = unsubscribe;

    // Subscribe to network connectivity changes (only pull on actual offline -> online transition)
    let lastNetworkOnline: boolean | undefined = undefined;
    this.networkUnsubscribe = this.network.subscribe((online) => {
      this.emitStatus();
      if (online && lastNetworkOnline === false && !this.isPaused) {
        this.schedulePush(0);
        this.pullRemoteChanges().catch((err) => {
          this.logger.error('Error pulling changes on reconnect:', err);
        });
      }
      lastNetworkOnline = online;
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
    this.isPaused = false;
    this.subscriptionGeneration++;
    if (this.lifecycleUnsubscribe) {
      this.lifecycleUnsubscribe();
      this.lifecycleUnsubscribe = undefined;
    }
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
   * Pauses recurring interval timers and active sync loops to conserve battery and data.
   */
  pause(): void {
    if (this.isPaused) return;
    this.isPaused = true;
    this.logger.info('App backgrounded: pausing sync timers');

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
    this.emitStatus();
  }

  /**
   * Resumes recurring interval timers and triggers an immediate catch-up push and pull.
   */
  resume(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.logger.info('App foregrounded: resuming sync');

    if (this.automaticSync) {
      if (!this.pushIntervalTimer) {
        this.pushIntervalTimer = setInterval(() => this.pushLocalChanges(), this.pushIntervalMs);
      }
      if (!this.pullIntervalTimer) {
        this.pullIntervalTimer = setInterval(() => this.pullRemoteChanges(), this.pullIntervalMs);
      }

      this.schedulePush(0);
      this.pullRemoteChanges().catch((err) => {
        this.logger.error('Error pulling changes on app resume:', err);
      });
    }
    this.emitStatus();
  }

  /**
   * Returns whether the sync worker is currently suspended due to app backgrounding.
   */
  get isBackgroundPaused(): boolean {
    return this.isPaused;
  }

  private isAppBackgrounded(): boolean {
    if (!this.autoPauseOnBackground) return false;

    // React Native AppState
    try {
      const { AppState } = require('react-native');
      if (AppState?.currentState && typeof AppState.currentState === 'string') {
        return Boolean(AppState.currentState.match(/inactive|background/));
      }
    } catch {
      // Not React Native
    }

    // Web Page Visibility API
    if (typeof document !== 'undefined' && typeof document.hidden === 'boolean') {
      return document.hidden;
    }

    return false;
  }

  private setupLifecycleListener(): void {
    if (!this.autoPauseOnBackground || this.lifecycleUnsubscribe) return;

    // 1. Try React Native AppState
    try {
      const { AppState } = require('react-native');
      if (AppState && typeof AppState.addEventListener === 'function') {
        const sub = AppState.addEventListener('change', (state: string) => {
          if (state.match(/inactive|background/)) {
            this.pause();
          } else if (state === 'active') {
            this.resume();
          }
        });

        this.lifecycleUnsubscribe = () => {
          if (typeof sub?.remove === 'function') {
            sub.remove();
          }
        };
        return;
      }
    } catch {
      // Not React Native
    }

    // 2. Web Page Visibility API
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      const onVisibilityChange = () => {
        if (document.hidden) {
          this.pause();
        } else {
          this.resume();
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      this.lifecycleUnsubscribe = () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      };
    }
  }

  /**
   * Schedules an immediate push with a short debounce.
   */
  schedulePush(delayMs: number = 50): void {
    if (!this.automaticSync || this.isPaused) return;
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

  /**
   * Dynamically sets or updates the active sync scope (e.g. switching active businessId or userId).
   */
  setSyncScope(scope?: Record<string, any> | (() => Record<string, any> | Promise<Record<string, any>>)): void {
    this.syncScope = scope;
  }

  private async isOnline(): Promise<boolean> {
    try {
      return await Promise.resolve(this.network.isOnline());
    } catch {
      return true;
    }
  }

  /**
   * Emits a `sync:status` snapshot. Calls are coalesced: while one snapshot is being
   * computed, further requests collapse into a single trailing run that reflects the
   * latest state, so bursts of push/pull transitions cost at most two COUNT queries.
   */
  private emitStatus(): Promise<void> {
    if (this.statusRun) {
      this.statusRerunRequested = true;
      return this.statusRun;
    }

    const run = async () => {
      do {
        this.statusRerunRequested = false;
        try {
          const online = await this.isOnline();
          const counts = await OutboxStore.getCounts(this.db);
          const statusEvent: SyncStatusEvent = {
            isOnline: online,
            isPushing: this.isPushing,
            isPulling: this.isPulling,
            pendingCount: counts.total,
          };
          this.events.emit('sync:status', statusEvent);
        } catch {
          // Ignored
        }
      } while (this.statusRerunRequested);
    };

    this.statusRun = run().finally(() => {
      this.statusRun = undefined;
    });
    return this.statusRun;
  }

  /**
   * Pushes pending outbox records to the remote database.
   */
  async pushLocalChanges(): Promise<void> {
    if (this.isPushing || this.isPaused) return;

    this.isPushing = true;
    this.emitStatus();
    const startTime = Date.now();
    let pendingRecords: OutboxRecord[] = [];

    try {
      if (!(await this.isOnline())) return;
      this.totalPushCycles++;
      // No push is active: recover records left behind by a failed status write.
      await OutboxStore.resetStaleProcessing(this.db);
      pendingRecords = await OutboxStore.getPending(this.db, this.maxRetries, PUSH_BATCH_SIZE);

      if (pendingRecords.length === 0) {
        return;
      }

      // Filter out internal/ephemeral tables (e.g. starting with '_') so they are never sent to remote backends
      const internalRecords = pendingRecords.filter((r) => r.tableName.startsWith('_'));
      if (internalRecords.length > 0) {
        await OutboxStore.deleteCompleted(
          this.db,
          internalRecords.map((r) => r.id),
        ).catch(() => { });
      }

      const validRecords = pendingRecords.filter((r) => !r.tableName.startsWith('_'));
      if (validRecords.length === 0) {
        return;
      }

      const operations: SyncOperation[] = validRecords.map((r) => ({
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

      const pushRes = await this.remote.pushChanges(operations);
      const durationMs = Date.now() - startTime;
      this.lastPushDurationMs = durationMs;
      this.lastPushTimestamp = Date.now();

      let isSuccess = false;
      let successfulIds: string[] = [];
      let failedIds: string[] = [];
      let errorsMap: Record<string, string> = {};

      if (typeof pushRes === 'boolean') {
        isSuccess = pushRes;
        if (pushRes) {
          successfulIds = recordIds;
        } else {
          failedIds = recordIds;
        }
      } else if (pushRes && typeof pushRes === 'object') {
        isSuccess = Boolean(pushRes.success);
        successfulIds = pushRes.successfulIds ?? (isSuccess ? recordIds : []);
        failedIds = pushRes.failedIds ?? (isSuccess ? [] : recordIds.filter((id) => !successfulIds.includes(id)));
        errorsMap = pushRes.errors ?? {};
      }

      if (successfulIds.length > 0) {
        // Delete records that were pushed successfully
        await OutboxStore.deleteCompleted(this.db, successfulIds);
        this.totalPushedOperations += successfulIds.length;
        this.events.emit('sync_outbox', { operation: 'DELETE', rowId: 'batch' });
      }

      if (failedIds.length === 0) {
        this.lastPushError = null;
        const pushEvent: PushEvent = {
          success: true,
          count: successfulIds.length,
          durationMs,
          error: null,
        };
        this.events.emit('sync:push', pushEvent);

        // Drain backlog: if a full batch was processed and all succeeded, continue immediately
        if (operations.length >= PUSH_BATCH_SIZE) {
          this.schedulePush(0);
        }
      } else {
        const errMsg = Object.values(errorsMap)[0] || 'Remote push returned failure';
        this.lastPushError = errMsg;
        const pushEvent: PushEvent = {
          success: false,
          count: failedIds.length,
          durationMs,
          error: errMsg,
        };
        this.events.emit('sync:push', pushEvent);

        const failedRecords = pendingRecords.filter((r) => failedIds.includes(r.id));
        await this.handlePushFailure(failedRecords, errMsg, undefined, errorsMap);

        // If part of the batch succeeded, keep draining the rest
        if (successfulIds.length > 0 && operations.length >= PUSH_BATCH_SIZE) {
          this.schedulePush(0);
        }
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
    errorObj?: any,
    errorsByRecordId?: Record<string, string>
  ): Promise<void> {
    try {
      if (errorsByRecordId && Object.keys(errorsByRecordId).length > 0) {
        for (const rec of records) {
          const msg = errorsByRecordId[rec.id] || errorMessage;
          await OutboxStore.markFailed(this.db, [rec.id], msg);
        }
      } else {
        const recordIds = records.map((r) => r.id);
        await OutboxStore.markFailed(this.db, recordIds, errorMessage);
      }
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
    if (this.isPulling || this.isPaused) return;

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

      const scope = typeof this.syncScope === 'function' ? await this.syncScope() : this.syncScope;
      const deltas = scope !== undefined
        ? await this.remote.fetchChanges(this.lastPulledTimestamp, scope)
        : await this.remote.fetchChanges(this.lastPulledTimestamp);
      const durationMs = Date.now() - startTime;
      this.lastPullDurationMs = durationMs;
      this.lastPullTimestamp = Date.now();
      this.lastPullError = null;

      const changesCount = deltas?.changes?.length || 0;
      if (deltas) {
        this.totalPulledDeltas += changesCount;
        await this.applyDeltasLocally(deltas);
        if (deltas.timestamp && deltas.timestamp > this.lastPulledTimestamp) {
          this.lastPulledTimestamp = deltas.timestamp;
          await MetaStore.setLastSyncedAt(this.db, deltas.timestamp);
        }
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

    const totalChanges = deltas.changes.length;

    // Apply incoming deltas in chunks to avoid holding long SQLite write locks
    // and starving concurrent UI reads on mobile/embedded environments.
    for (let i = 0; i < totalChanges; i += DELTA_CHUNK_SIZE) {
      const chunk = deltas.changes.slice(i, i + DELTA_CHUNK_SIZE);
      const isLastChunk = i + DELTA_CHUNK_SIZE >= totalChanges;
      const queuedEvents: Array<{ event: string; data: any }> = [];

      await this.db.transaction(async (tx) => {
        // Pre-fetch active pending outbox records in 1 query for this chunk to eliminate N+1 bridge roundtrips
        const pendingOutboxMap = await OutboxStore.getActivePendingMap(tx);

        for (const change of chunk) {
          const outboxKey = `${change.tableName}:${change.rowId}`;
          // 1. Check in-memory map for pending local mutations for this (table_name, row_id)
          const localPendingRecord = pendingOutboxMap.get(outboxKey);

          // 2. Conflict resolution if there is a pending local change
          if (localPendingRecord) {
            // Only load the current local row when a resolver actually needs it.
            const localRow = await TableManager.fetchRow(
              tx,
              change.tableName,
              change.rowId,
              this.primaryKey,
              { autoSchema: this.autoSchema, schemaManager: this.schemaManager }
            );

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
            queuedEvents.push({ event: 'sync:conflict', data: conflictEvent });

            if (resolution === 'keep-local') {
              // Local offline change takes precedence
              continue;
            }

            if (resolution === 'apply-remote') {
              // Remote change wins: remove the superseded local pending outbox mutation
              await OutboxStore.deleteRecord(tx, localPendingRecord.id);
              pendingOutboxMap.delete(outboxKey);
            } else if (typeof resolution === 'object' && resolution.mergePayload) {
              // Merge scenario
              change.payload = resolution.mergePayload;
              await OutboxStore.updatePayload(tx, localPendingRecord.id, resolution.mergePayload);
              localPendingRecord.payload = resolution.mergePayload;
            }
          }

          // 3. Apply remote change to local database
          await TableManager.applyMutation(
            tx,
            change.tableName,
            change.rowId,
            change.operation,
            change.payload ?? null,
            this.primaryKey,
            { autoSchema: this.autoSchema, schemaManager: this.schemaManager }
          );

          // 4. Queue table change event to notify reactive listeners after commit
          queuedEvents.push({
            event: change.tableName,
            data: {
              operation: change.operation,
              rowId: change.rowId,
              payload: change.payload,
              source: 'remote',
            },
          });
        }

        // Advance durable checkpoint only when a valid pull timestamp was provided
        if (isLastChunk && deltas.timestamp && deltas.timestamp > this.lastPulledTimestamp) {
          await MetaStore.setLastSyncedAt(tx, deltas.timestamp);
          this.lastPulledTimestamp = deltas.timestamp;
        }
      });

      // Emit events after chunk commit
      for (const item of queuedEvents) {
        this.events.emit(item.event, item.data);
      }

      // Yield between chunks if there are multiple chunks
      if (totalChanges > DELTA_CHUNK_SIZE && !isLastChunk) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

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
