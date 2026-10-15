import { LocalDBAdapter, LocalTransaction } from '../adapters/local/index.js';
import { RemoteDBAdapter } from '../adapters/remote/index.js';
import { EventEmitter } from '../reactive/event-emitter.js';
import { SyncWorker, SyncWorkerOptions } from './sync-worker.js';
import { TableManager } from './table-manager.js';
import { OutboxStore } from './outbox-store.js';
import { MetaStore } from './meta-store.js';
import { SchemaManager } from './schema-manager.js';
import {
  BatchMutation,
  ConflictResolver,
  ConflictStrategy,
  MutateOptions,
  NetworkStatusProvider,
  OutboxRecord,
  OutboxStatus,
  QueryOptions,
  RetryConfig,
  SyncMetrics,
  SyncOp,
  TableChangeEvent,
} from './types.js';
import { SyncLogger, CustomLogger, LogLevel } from '../utils/logger.js';
import { generateUUID } from '../utils/uuid.js';
import { escapeIdentifier } from '../utils/sql.js';
import { applyQueryOptions } from './query.js';

export interface LocalFirstClientConfig {
  local: LocalDBAdapter;
  remote: RemoteDBAdapter;
  network?: NetworkStatusProvider;
  conflictResolver?: ConflictStrategy | ConflictResolver;
  primaryKey?: string;
  pushIntervalMs?: number;
  pullIntervalMs?: number;
  maxRetries?: number;
  retry?: number | RetryConfig;
  logger?: SyncLogger | CustomLogger | boolean;
  logLevel?: LogLevel;
  autoSchema?: boolean;
  tables?: string[];
  migrations?: string[];
  autoStart?: boolean;
}

export class TransactionalClient {
  constructor(
    private parent: LocalFirstClient,
    private tx: LocalTransaction,
    private queuedTableEvents: Array<{ tableName: string; event: TableChangeEvent }>,
    private queuedOutboxIds: string[]
  ) { }

  async mutate(
    tableName: string,
    rowId: string,
    operation: SyncOp,
    payload: Record<string, any> | null,
    options: MutateOptions = {}
  ): Promise<void> {
    const pk = options.primaryKey ?? this.parent.getPrimaryKey();
    const outboxId = generateUUID();
    const timestamp = options.customTimestamp ?? Date.now();

    await TableManager.applyMutation(this.tx, tableName, rowId, operation, payload, pk, {
      autoSchema: this.parent.autoSchema,
      schemaManager: this.parent.schemaManager,
    });

    if (!options.skipOutbox) {
      await OutboxStore.insertRecord(this.tx, {
        id: outboxId,
        tableName,
        rowId,
        operation,
        payload,
        timestamp,
      });
      this.queuedOutboxIds.push(outboxId);
    }

    this.queuedTableEvents.push({
      tableName,
      event: {
        operation,
        rowId,
        payload,
        source: 'local',
      },
    });
  }

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
      rowId = payload[this.parent.getPrimaryKey()] || generateUUID();
      opts = (payloadOrOptions as MutateOptions) || {};
    }

    await this.mutate(tableName, rowId, 'INSERT', payload, opts);
    return rowId;
  }

  async update(
    tableName: string,
    rowId: string,
    payload: Record<string, any>,
    options: MutateOptions = {}
  ): Promise<void> {
    await this.mutate(tableName, rowId, 'UPDATE', payload, options);
  }

  async delete(
    tableName: string,
    rowId: string,
    options: MutateOptions = {}
  ): Promise<void> {
    await this.mutate(tableName, rowId, 'DELETE', null, options);
  }

  get rawTx(): LocalTransaction {
    return this.tx;
  }
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
  private migrations: string[];
  private autoStart: boolean;
  private initialization?: Promise<void>;

  constructor(config: LocalFirstClientConfig) {
    this.db = config.local;
    this.remote = config.remote;
    this.events = new EventEmitter();
    this.primaryKey = config.primaryKey ?? 'id';
    this.autoSchema = config.autoSchema ?? false;
    this.tables = config.tables ?? [];
    this.migrations = config.migrations ?? [];
    this.autoStart = config.autoStart ?? true;
    this.schemaManager = new SchemaManager();

    const workerOptions: SyncWorkerOptions = {
      network: config.network,
      conflictResolver: config.conflictResolver,
      primaryKey: this.primaryKey,
      pushIntervalMs: config.pushIntervalMs,
      pullIntervalMs: config.pullIntervalMs,
      maxRetries: config.maxRetries,
      retry: config.retry,
      logger: config.logger,
      logLevel: config.logLevel,
      autoSchema: this.autoSchema,
      schemaManager: this.schemaManager,
      autoSync: this.autoStart,
    };

    this.syncWorker = new SyncWorker(this.db, this.remote, this.events, workerOptions);
  }

  getPrimaryKey(): string {
    return this.primaryKey;
  }

  /**
   * Initializes the client: creates sync_outbox schema, ensures autoSchema tables if enabled,
   * applies migrations, and optionally starts automatic sync. Concurrent/repeated calls
   * share initialization; failures can be retried. After stop(), explicitly start the worker.
   */
  async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initializeStorage().catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    }
    await this.initialization;
  }

  private async initializeStorage(): Promise<void> {
    await OutboxStore.ensureSchema(this.db);
    await MetaStore.ensureSchema(this.db);
    await OutboxStore.resetStaleProcessing(this.db);

    if (this.migrations.length > 0) {
      await this.db.transaction(async (tx) => {
        for (const query of this.migrations) {
          if (query.trim()) await tx.execute(query);
        }
      });
    }

    if (this.autoSchema && this.tables.length > 0) {
      for (const table of this.tables) {
        await this.schemaManager.ensureTable(this.db, table, this.primaryKey);
      }
    }

    if (this.autoStart) this.syncWorker.start();
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
   * Executes multiple mutations in a single atomic database transaction.
   * Inserts all corresponding outbox entries together and schedules a single push.
   */
  async batch(mutations: BatchMutation[], options: MutateOptions = {}): Promise<string[]> {
    if (!mutations || mutations.length === 0) return [];

    const generatedIds: string[] = [];
    const queuedEvents: Array<{ tableName: string; event: TableChangeEvent }> = [];
    const queuedOutboxIds: string[] = [];

    const executeInTx = async (tx: LocalTransaction) => {
      for (const m of mutations) {
        const pk = m.primaryKey ?? options.primaryKey ?? this.primaryKey;
        const payload = m.payload ?? null;
        const rowId: string =
          m.rowId ||
          (payload && payload[pk] !== undefined && payload[pk] !== null
            ? String(payload[pk])
            : generateUUID());
        generatedIds.push(rowId);

        await TableManager.applyMutation(tx, m.tableName, rowId, m.operation, payload, pk, {
          autoSchema: this.autoSchema,
          schemaManager: this.schemaManager,
        });

        const skipOutbox = m.skipOutbox ?? options.skipOutbox ?? false;
        if (!skipOutbox) {
          const outboxId = generateUUID();
          const timestamp = m.customTimestamp ?? options.customTimestamp ?? Date.now();
          await OutboxStore.insertRecord(tx, {
            id: outboxId,
            tableName: m.tableName,
            rowId,
            operation: m.operation,
            payload,
            timestamp,
          });
          queuedOutboxIds.push(outboxId);
        }

        queuedEvents.push({
          tableName: m.tableName,
          event: {
            operation: m.operation,
            rowId,
            payload,
            source: 'local',
          },
        });
      }
    };

    if (options.tx) {
      await executeInTx(options.tx);
    } else {
      await this.db.transaction(executeInTx);
    }

    // Emit all buffered events after transaction commits
    for (const item of queuedEvents) {
      this.events.emit(item.tableName, item.event);
    }

    if (queuedOutboxIds.length > 0) {
      this.events.emit('sync_outbox', { operation: 'INSERT', rowId: 'batch' });
      this.syncWorker.schedulePush(20);
    }

    return generatedIds;
  }

  /**
   * Convenience helper to insert an array of records into a table atomically.
   */
  async insertMany(
    tableName: string,
    records: Record<string, any>[],
    options: MutateOptions = {}
  ): Promise<string[]> {
    const pk = options.primaryKey ?? this.primaryKey;
    const mutations: BatchMutation[] = records.map((record) => {
      const rowId = record[pk] || generateUUID();
      return {
        tableName,
        rowId,
        operation: 'INSERT',
        payload: record,
        primaryKey: pk,
      };
    });
    return await this.batch(mutations, options);
  }

  /**
   * Runs an arbitrary callback inside an atomic transaction with a scoped TransactionalClient.
   * If the callback resolves, all changes and outbox records commit and events are emitted.
   * If the callback throws, SQLite rolls back and no change events are emitted.
   */
  async transaction<T>(action: (txClient: TransactionalClient) => Promise<T>): Promise<T> {
    const queuedEvents: Array<{ tableName: string; event: TableChangeEvent }> = [];
    const queuedOutboxIds: string[] = [];

    const result = await this.db.transaction(async (tx) => {
      const txClient = new TransactionalClient(this, tx, queuedEvents, queuedOutboxIds);
      return await action(txClient);
    });

    for (const item of queuedEvents) {
      this.events.emit(item.tableName, item.event);
    }

    if (queuedOutboxIds.length > 0) {
      this.events.emit('sync_outbox', { operation: 'INSERT', rowId: 'batch' });
      this.syncWorker.schedulePush(20);
    }

    return result;
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
   * Reads records from a local SQLite table without requiring manual SQL.
   * Supports where filtering with rich operators ($in, $gt, $contains, $or, etc.), order, limit, and offset.
   * Gracefully returns [] if table or columns have not been populated yet on empty schemas.
   *
   * Example:
   * const tenants = await client.findMany('tenants', { where: { status: 'ACTIVE' }, orderBy: 'name' });
   * const expensive = await client.findMany('properties', { where: { rent: { $gte: 2000 } } });
   */
  async findMany<T = any>(tableName: string, options?: QueryOptions): Promise<T[]> {
    const safeTable = escapeIdentifier(tableName);
    let rows: any[];
    try {
      rows = await this.db.execute(`SELECT * FROM ${safeTable}`);
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (msg.includes('no such table') || msg.includes('no such column')) {
        return [];
      }
      throw err;
    }

    return applyQueryOptions<T>(rows, options);
  }

  /**
   * Finds a single record by primary key.
   *
   * Example:
   * const tenant = await client.findById('tenants', 'ten-1');
   */
  async findById<T = any>(tableName: string, id: string): Promise<T | null> {
    // Primary-key lookup in SQLite instead of loading the whole table into JS.
    const safeTable = escapeIdentifier(tableName);
    const safePk = escapeIdentifier(this.primaryKey);
    try {
      const rows = await this.db.execute(
        `SELECT * FROM ${safeTable} WHERE ${safePk} = ? LIMIT 1`,
        [id]
      );
      return rows && rows.length > 0 ? (rows[0] as T) : null;
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (msg.includes('no such table') || msg.includes('no such column')) {
        return null;
      }
      throw err;
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
   * Returns real-time telemetry metrics captured by the sync engine.
   */
  async getMetrics(): Promise<SyncMetrics> {
    return await this.syncWorker.getMetrics();
  }

  /**
   * Fetches outbox records with optional status filtering and pagination.
   */
  async getOutboxRecords(options?: {
    status?: OutboxStatus;
    limit?: number;
    offset?: number;
  }): Promise<OutboxRecord[]> {
    return await OutboxStore.getAllRecords(this.db, options);
  }

  /**
   * Re-queues failed outbox mutations for retry by resetting their status to PENDING.
   * Triggers an immediate sync push.
   */
  async retryFailedMutations(ids?: string[]): Promise<number> {
    const count = await OutboxStore.retryFailed(this.db, ids);
    if (count > 0) {
      this.events.emit('sync_outbox', { operation: 'UPDATE', rowId: 'retry' });
      this.syncWorker.schedulePush(0);
    }
    return count;
  }

  /**
   * Permanently clears failed mutations (removes poison-pill outbox records).
   */
  async clearFailedMutations(ids?: string[]): Promise<number> {
    const count = await OutboxStore.clearFailed(this.db, ids);
    if (count > 0) {
      this.events.emit('sync_outbox', { operation: 'DELETE', rowId: 'clear' });
    }
    return count;
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

  /**
   * Stops background sync workers, cleans up remote listeners,
   * and closes the local database adapter connection (releasing native locks).
   */
  async close(): Promise<void> {
    this.stop();
    if (typeof (this.remote as any).destroy === 'function') {
      (this.remote as any).destroy();
    }
    if (typeof this.db.close === 'function') {
      await this.db.close();
    }
  }

  /**
   * Resets local state by stopping sync and deleting or dropping all managed tables,
   * clearing the sync_outbox and _sync_meta stores, and resetting the sync cursor.
   */
  async reset(options: { dropTables?: boolean } = {}): Promise<void> {
    this.stop();

    const tablesToReset = Array.from(new Set([...this.tables, 'sync_outbox', 'sync_meta']));
    for (const table of tablesToReset) {
      try {
        if (options.dropTables) {
          await this.db.execute(`DROP TABLE IF EXISTS "${table}"`);
        } else {
          await this.db.execute(`DELETE FROM "${table}"`);
        }
      } catch {
        // Table may not exist yet; safe to ignore
      }
    }

    if (options.dropTables) {
      this.initialization = undefined;
      // Dropped tables must be re-created by autoSchema on next write.
      this.schemaManager.clearCache();
    }
    await this.resetSyncCursor();
    this.events.emit('reset', { dropTables: options.dropTables ?? false });
  }
}