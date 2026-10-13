import { LocalDBAdapter, LocalTransaction } from '../adapters/local/index.js';
import { RemoteDBAdapter } from '../adapters/remote/index.js';
import { EventEmitter } from '../reactive/event-emitter.js';
import { SyncWorker, SyncWorkerOptions } from './sync-worker.js';
import { TableManager } from './table-manager.js';
import { OutboxStore } from './outbox-store.js';
import { MetaStore } from './meta-store.js';
import { SchemaManager } from './schema-manager.js';
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
  autoSchema?: boolean;
  tables?: string[];
}

export class LocalFirstClient {
  public db: LocalDBAdapter;
  public remote: RemoteDBAdapter;
  public events: EventEmitter;
  public syncWorker: SyncWorker;
  public schemaManager: SchemaManager;
  public autoSchema: boolean;
  public tables: string[];
  private primaryKey: string;

  constructor(config: LocalFirstClientConfig) {
    this.db = config.local;
    this.remote = config.remote;
    this.events = new EventEmitter();
    this.primaryKey = config.primaryKey ?? 'id';
    this.autoSchema = config.autoSchema ?? false;
    this.tables = config.tables ?? [];
    this.schemaManager = new SchemaManager();

    const workerOptions: SyncWorkerOptions = {
      network: config.network,
      conflictResolver: config.conflictResolver,
      primaryKey: this.primaryKey,
      pushIntervalMs: config.pushIntervalMs,
      pullIntervalMs: config.pullIntervalMs,
      maxRetries: config.maxRetries,
      autoSchema: this.autoSchema,
      schemaManager: this.schemaManager,
    };

    this.syncWorker = new SyncWorker(this.db, this.remote, this.events, workerOptions);
  }

  /**
   * Initializes the client: creates sync_outbox schema, ensures autoSchema tables if enabled,
   * and starts the background sync worker.
   */
  async initialize(): Promise<void> {
    await OutboxStore.ensureSchema(this.db);
    await MetaStore.ensureSchema(this.db);
    await OutboxStore.resetStaleProcessing(this.db);

    if (this.autoSchema && this.tables.length > 0) {
      for (const table of this.tables) {
        await this.schemaManager.ensureTable(this.db, table, this.primaryKey);
      }
    }

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
      await TableManager.applyMutation(tx, tableName, rowId, operation, payload, pk, {
        autoSchema: this.autoSchema,
        schemaManager: this.schemaManager,
      });

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
   * Convenience helper to insert a record into a table.
   * Auto-generates a UUID if rowId is omitted or passed inside payload.
   * 
   * Example:
   * await client.insert('todos', { title: 'Buy milk' });
   * await client.insert('todos', 'custom-id', { title: 'Buy milk' });
   */
  async insert(
    tableName: string,
    rowIdOrPayload: string | Record<string, any>,
    payloadOrOptions?: Record<string, any> | MutateOptions,
    options?: MutateOptions
  ): Promise<string> {
    let rowId: string;
    let payload: Record<string, any>;
    let opts: MutateOptions = {};

    if (typeof rowIdOrPayload === 'string') {
      rowId = rowIdOrPayload;
      payload = (payloadOrOptions as Record<string, any>) || {};
      opts = options || {};
    } else {
      payload = rowIdOrPayload || {};
      rowId = payload[this.primaryKey] || generateUUID();
      opts = (payloadOrOptions as MutateOptions) || {};
    }

    await this.mutate(tableName, rowId, 'INSERT', payload, opts);
    return rowId;
  }

  /**
   * Convenience helper to update an existing record by ID.
   * 
   * Example:
   * await client.update('todos', 'todo-1', { completed: 1 });
   */
  async update(
    tableName: string,
    rowId: string,
    payload: Record<string, any>,
    options: MutateOptions = {}
  ): Promise<void> {
    await this.mutate(tableName, rowId, 'UPDATE', payload, options);
  }

  /**
   * Convenience helper to delete a record by ID.
   * 
   * Example:
   * await client.delete('todos', 'todo-1');
   */
  async delete(
    tableName: string,
    rowId: string,
    options: MutateOptions = {}
  ): Promise<void> {
    await this.mutate(tableName, rowId, 'DELETE', null, options);
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
   * Retrieves the persisted last_synced_at timestamp cursor (in ms).
   */
  async getLastSyncedAt(): Promise<number> {
    return await this.syncWorker.getLastPulledTimestamp();
  }

  /**
   * Resets the persistent sync cursor back to 0, forcing the next pull
   * to query all remote records.
   */
  async resetSyncCursor(): Promise<void> {
    await this.syncWorker.resetSyncCursor();
  }

  /**
   * Stops all active intervals, background sync loops, and network listeners.
   */
  stop(): void {
    this.syncWorker.stop();
  }
}