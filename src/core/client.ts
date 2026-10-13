import { LocalDBAdapter, LocalTransaction } from '../adapters/local/index.js';
import { RemoteDBAdapter } from '../adapters/remote/index.js';
import { EventEmitter } from '../reactive/event-emitter.js';
import { SyncWorker, SyncWorkerOptions } from './sync-worker.js';
import { TableManager } from './table-manager.js';
import { OutboxStore } from './outbox-store.js';
import {
  ConflictResolver,
  ConflictStrategy,
  MutateOptions,
  NetworkStatusProvider,
  SyncOp,
} from './types.js';
import { generateUUID } from '../utils/uuid.js';

export interface LocalFirstClientConfig {
  local: LocalDBAdapter;
  remote: RemoteDBAdapter;
  network?: NetworkStatusProvider;
  conflictResolver?: ConflictStrategy | ConflictResolver;
  primaryKey?: string;
  pushIntervalMs?: number;
  pullIntervalMs?: number;
  maxRetries?: number;
}

export class LocalFirstClient {
  public db: LocalDBAdapter;
  public remote: RemoteDBAdapter;
  public events: EventEmitter;
  public syncWorker: SyncWorker;
  private primaryKey: string;

  constructor(config: LocalFirstClientConfig) {
    this.db = config.local;
    this.remote = config.remote;
    this.events = new EventEmitter();
    this.primaryKey = config.primaryKey ?? 'id';

    const workerOptions: SyncWorkerOptions = {
      network: config.network,
      conflictResolver: config.conflictResolver,
      primaryKey: this.primaryKey,
      pushIntervalMs: config.pushIntervalMs,
      pullIntervalMs: config.pullIntervalMs,
      maxRetries: config.maxRetries,
    };

    this.syncWorker = new SyncWorker(this.db, this.remote, this.events, workerOptions);
  }

  /**
   * Initializes the client: creates sync_outbox schema and starts the background sync worker.
   */
  async initialize(): Promise<void> {
    await OutboxStore.ensureSchema(this.db);
    this.syncWorker.start();
  }

  /**
   * Performs an atomic dual-write: mutates the local data table AND writes
   * to sync_outbox within the same database transaction.
   */
  async mutate(
    tableName: string,
    rowId: string,
    operation: SyncOp,
    payload: Record<string, any> | null,
    options: MutateOptions = {}
  ): Promise<void> {
    const pk = options.primaryKey ?? this.primaryKey;
    const outboxId = generateUUID();
    const timestamp = options.customTimestamp ?? Date.now();

    const executeInTransaction = async (tx: LocalTransaction) => {
      // 1. Mutate local table
      await TableManager.applyMutation(tx, tableName, rowId, operation, payload, pk);

      // 2. Insert into sync_outbox (if not skipped)
      if (!options.skipOutbox) {
        await OutboxStore.insertRecord(tx, {
          id: outboxId,
          tableName,
          rowId,
          operation,
          payload,
          timestamp,
        });
      }
    };

    if (options.tx) {
      await executeInTransaction(options.tx);
    } else {
      await this.db.transaction(executeInTransaction);
    }

    // 3. Emit reactive change events
    this.events.emit(tableName, {
      operation,
      rowId,
      payload,
      source: 'local',
    });

    if (!options.skipOutbox) {
      this.events.emit('sync_outbox', { operation: 'INSERT', rowId: outboxId });
      // 4. Trigger immediate debounced push
      this.syncWorker.schedulePush(20);
    }
  }

  /**
   * Tracks an existing mutation into sync_outbox without modifying the table.
   * Can accept an external transaction `options.tx` for custom atomic SQL workflows.
   */
  async trackMutation(
    tableName: string,
    rowId: string,
    operation: SyncOp,
    payload: Record<string, any> | null,
    options: MutateOptions = {}
  ): Promise<string> {
    const outboxId = generateUUID();
    const timestamp = options.customTimestamp ?? Date.now();

    const executeInsert = async (tx: LocalTransaction) => {
      await OutboxStore.insertRecord(tx, {
        id: outboxId,
        tableName,
        rowId,
        operation,
        payload,
        timestamp,
      });
    };

    if (options.tx) {
      await executeInsert(options.tx);
    } else {
      await this.db.transaction(executeInsert);
    }

    this.events.emit(tableName, {
      operation,
      rowId,
      payload,
      source: 'local',
    });
    this.events.emit('sync_outbox', { operation: 'INSERT', rowId: outboxId });

    this.syncWorker.schedulePush(20);

    return outboxId;
  }

  /**
   * Stops all active intervals, background sync loops, and network listeners.
   */
  stop(): void {
    this.syncWorker.stop();
  }
}