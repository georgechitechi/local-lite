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
  coalesceOutbox?: boolean;
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
      const outboxId = await this.parent.recordOutboxMutation(
        this.tx,
        tableName,
        rowId,
        operation,
        payload,
        timestamp
      );
      if (outboxId) {
        this.queuedOutboxIds.push(outboxId);
      }
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
  public coalesceOutbox: boolean;
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
    this.coalesceOutbox = config.coalesceOutbox ?? true;
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
   * Writes a mutation to the outbox table, optionally coalescing with existing PENDING records for the same row.
   * Returns the affected outboxId, or undefined if an offline INSERT was deleted offline before pushing.
   */
  async recordOutboxMutation(
    tx: LocalTransaction,
    tableName: string,
    rowId: string,
    operation: SyncOp,
    payload: Record<string, any> | null,
    timestamp: number
  ): Promise<string | undefined> {
    if (this.coalesceOutbox) {
      const existing = await OutboxStore.findPendingByRow(tx, tableName, rowId);
      if (existing && existing.status === 'PENDING') {
        if (operation === 'DELETE') {
          if (existing.operation === 'INSERT') {
            // Created offline and deleted offline before ever being pushed to server: clean up outbox completely
            await OutboxStore.deleteRecord(tx, existing.id);
            return undefined;
          } else {
            await OutboxStore.updateOperation(tx, existing.id, 'DELETE', null, timestamp);
            return existing.id;
          }
        } else if (operation === 'UPDATE') {
          const merged = { ...(existing.payload || {}), ...(payload || {}) };
          await OutboxStore.updatePayload(tx, existing.id, merged, timestamp);
          return existing.id;
        } else if (operation === 'INSERT') {
          await OutboxStore.updateOperation(tx, existing.id, 'INSERT', payload, timestamp);
          return existing.id;
        }
      }
    }

    const outboxId = generateUUID();
    await OutboxStore.insertRecord(tx, {
      id: outboxId,
      tableName,
      rowId,
      operation,
      payload,
      timestamp,
    });
    return outboxId;
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

    let affectedOutboxId: string | undefined;

    const executeInTransaction = async (tx: LocalTransaction) => {
      // 1. Mutate local table
      await TableManager.applyMutation(tx, tableName, rowId, operation, payload, pk, {
        autoSchema: this.autoSchema,
        schemaManager: this.schemaManager,
      });

      // 2. Insert into sync_outbox (if not skipped)
      if (!options.skipOutbox) {
        affectedOutboxId = await this.recordOutboxMutation(
          tx,
          tableName,
          rowId,
          operation,
          payload,
          timestamp
        );
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
      this.events.emit('sync_outbox', {
        operation: affectedOutboxId ? 'INSERT' : 'DELETE',
        rowId: affectedOutboxId || rowId,
      });
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
          const timestamp = m.customTimestamp ?? options.customTimestamp ?? Date.now();
          const outboxId = await this.recordOutboxMutation(
            tx,
            m.tableName,
            rowId,
            m.operation,
            payload,
            timestamp
          );
          if (outboxId) {
            queuedOutboxIds.push(outboxId);
          }
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
   * Pushes simple equality where clauses down to SQLite for high performance, with memory fallback.
   * Gracefully returns [] if table or columns have not been populated yet on empty schemas.
   *
   * Example:
   * const tenants = await client.findMany('tenants', { where: { status: 'ACTIVE' }, orderBy: 'name' });
   * const expensive = await client.findMany('properties', { where: { rent: { $gte: 2000 } } });
   */
  async findMany<T = any>(tableName: string, options?: QueryOptions): Promise<T[]> {
    const safeTable = escapeIdentifier(tableName);
    let rows: any[];
    let sql = `SELECT * FROM ${safeTable}`;
    const params: any[] = [];

    // Push down where conditions to SQLite
    if (options?.where && typeof options.where === 'object' && !Array.isArray(options.where)) {
      const whereClauses: string[] = [];
      for (const [col, filter] of Object.entries(options.where)) {
        if (col === '$or' || col === '$and') continue;
        const safeCol = escapeIdentifier(col);

        if (filter === null) {
          whereClauses.push(`${safeCol} IS NULL`);
        } else if (typeof filter === 'boolean') {
          whereClauses.push(`${safeCol} = ?`);
          params.push(filter ? 1 : 0);
        } else if (typeof filter === 'string' || typeof filter === 'number') {
          whereClauses.push(`${safeCol} = ?`);
          params.push(filter);
        } else if (typeof filter === 'object' && !Array.isArray(filter)) {
          const ops = filter as any;
          if (ops.$eq !== undefined) {
            whereClauses.push(`${safeCol} = ?`);
            params.push(typeof ops.$eq === 'boolean' ? (ops.$eq ? 1 : 0) : ops.$eq);
          }
          if (ops.$ne !== undefined) {
            whereClauses.push(`${safeCol} != ?`);
            params.push(typeof ops.$ne === 'boolean' ? (ops.$ne ? 1 : 0) : ops.$ne);
          }
          if (ops.$gt !== undefined) {
            whereClauses.push(`${safeCol} > ?`);
            params.push(ops.$gt);
          }
          if (ops.$gte !== undefined) {
            whereClauses.push(`${safeCol} >= ?`);
            params.push(ops.$gte);
          }
          if (ops.$lt !== undefined) {
            whereClauses.push(`${safeCol} < ?`);
            params.push(ops.$lt);
          }
          if (ops.$lte !== undefined) {
            whereClauses.push(`${safeCol} <= ?`);
            params.push(ops.$lte);
          }
          if (Array.isArray(ops.$in) && ops.$in.length > 0) {
            const placeholders = ops.$in.map(() => '?').join(', ');
            whereClauses.push(`${safeCol} IN (${placeholders})`);
            params.push(...ops.$in.map((v: any) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)));
          }
          if (Array.isArray(ops.$nin) && ops.$nin.length > 0) {
            const placeholders = ops.$nin.map(() => '?').join(', ');
            whereClauses.push(`${safeCol} NOT IN (${placeholders})`);
            params.push(...ops.$nin.map((v: any) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)));
          }
          if (ops.$null !== undefined) {
            whereClauses.push(ops.$null ? `${safeCol} IS NULL` : `${safeCol} IS NOT NULL`);
          }
        }
      }
      if (whereClauses.length > 0) {
        sql += ` WHERE ${whereClauses.join(' AND ')}`;
      }
    }

    // Push down ORDER BY
    if (options?.orderBy && typeof options.orderBy === 'string') {
      const safeCol = escapeIdentifier(options.orderBy);
      const dir = options.order && String(options.order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      sql += ` ORDER BY ${safeCol} ${dir}`;
    }

    // Push down LIMIT & OFFSET
    if (typeof options?.limit === 'number' && options.limit > 0) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
      if (typeof options.offset === 'number' && options.offset > 0) {
        sql += ` OFFSET ?`;
        params.push(options.offset);
      }
    }

    try {
      rows = await this.db.execute(sql, params);
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (msg.includes('no such table') || msg.includes('no such column')) {
        return [];
      }
      // Fallback to select * if pushdown syntax differs
      try {
        rows = await this.db.execute(`SELECT * FROM ${safeTable}`);
      } catch {
        return [];
      }
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