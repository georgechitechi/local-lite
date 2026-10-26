import { LocalDBAdapter, LocalTransaction } from '../adapters/local/index.js';
import { RemoteDBAdapter } from '../adapters/remote/index.js';
import { EventEmitter } from '../reactive/event-emitter.js';
import { SyncWorker, SyncWorkerOptions } from './sync-worker.js';
import { TableManager } from './table-manager.js';
import { OutboxStore } from './outbox-store.js';
import { MetaStore } from './meta-store.js';
import { DatabaseMaintenance } from './maintenance.js';
import { SchemaManager, DBExecutable } from './schema-manager.js';
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
  SyncOperation,
  TableChangeEvent,
  WhereFilter,
} from './types.js';
import { SyncLogger, CustomLogger, LogLevel } from '../utils/logger.js';
import { generateUUID } from '../utils/uuid.js';
import { escapeIdentifier } from '../utils/sql.js';
import { isDeletedRecord, applyQueryOptions } from './query.js';
import { QueryBuilder, AggregateSpec, AggregateResult } from './query-builder.js';
import {
  exportTablesToJson,
  importTablesFromJson,
  exportTableToCsv,
  importTableFromCsv,
  type ExportJsonOptions,
  type ImportJsonOptions,
  type ExportCsvOptions,
  type ImportCsvOptions,
  type ImportSummary,
} from '../utils/portability.js';
import {
  performBackup,
  performRestore,
  type BackupStorage,
  type CreateDatabaseBackupOptions,
  type EncryptedBackupOptions,
  type RestoreEncryptedBackupOptions,
} from '../backups/index.js';
import {
  ActionManager,
  type ActionManagerOptions,
} from '../actions/index.js';
import {
  ApiKeyManager,
  type ApiKeyManagerOptions,
} from '../keys/index.js';
import {
  KVManager,
  type KVStoreOptions,
} from '../kv/index.js';
import {
  SearchManager,
} from '../search/index.js';
import {
  BlobStorageManager,
  type BlobStorageManagerOptions,
} from '../storage/index.js';
import {
  JobScheduler,
  type JobSchedulerOptions,
} from '../scheduler/index.js';

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
  jsonColumns?: Record<string, string[]>;
  autoHydrateJSON?: boolean;
  syncScope?: Record<string, any> | (() => Record<string, any> | Promise<Record<string, any>>);
  autoPauseOnBackground?: boolean;
  /**
   * Stamp an "updated at" column on every local INSERT/UPDATE write so reactive
   * queries (which compare rows by `id` + `updated_at`/`updatedAt`) detect offline edits.
   * Only the local SQLite row is stamped; outbox payloads sent to the remote are unchanged.
   * - `true` (default): column inferred from the remote adapter's `updatedAtColumn`, else 'updated_at'
   * - `string`: explicit column name
   * - `false`: disabled
   */
  touchUpdatedAt?: boolean | string;
  actions?: ActionManagerOptions;
  keys?: ApiKeyManagerOptions;
  kv?: KVStoreOptions;
  storage?: BlobStorageManagerOptions;
  scheduler?: JobSchedulerOptions;
}

function hasFunctionFilter(value: any): boolean {
  if (typeof value === 'function') return true;
  if (Array.isArray(value)) return value.some(hasFunctionFilter);
  if (value && typeof value === 'object') return Object.values(value).some(hasFunctionFilter);
  return false;
}

function shouldUseClientSideQuery(options?: QueryOptions): boolean {
  return hasFunctionFilter(options?.where);
}

async function executeFindById<T>(
  db: DBExecutable,
  tableName: string,
  id: string,
  primaryKey: string,
  hydrateRow: (t: string, r: any) => T,
  includeDeleted?: boolean
): Promise<T | null> {
  const safeTable = escapeIdentifier(tableName);
  const safePk = escapeIdentifier(primaryKey);
  try {
    const rows = await db.execute(`SELECT * FROM ${safeTable} WHERE ${safePk} = ? LIMIT 1`, [id]);
    if (!rows || rows.length === 0) return null;
    const row = hydrateRow(tableName, rows[0]);
    return !includeDeleted && isDeletedRecord(row) ? null : row;
  } catch (err: any) {
    const msg = String(err?.message || err || '');
    if (msg.includes('no such table') || msg.includes('no such column')) return null;
    throw err;
  }
}

async function executeFindByIds<T>(
  db: DBExecutable,
  tableName: string,
  ids: string[],
  primaryKey: string,
  hydrateRow: (t: string, r: any) => T,
  includeDeleted?: boolean
): Promise<T[]> {
  if (!ids || ids.length === 0) return [];
  const safeTable = escapeIdentifier(tableName);
  const safePk = escapeIdentifier(primaryKey);
  const placeholders = ids.map(() => '?').join(', ');
  try {
    const rows = await db.execute(`SELECT * FROM ${safeTable} WHERE ${safePk} IN (${placeholders})`, ids);
    if (!rows || rows.length === 0) return [];
    const hydrated = rows.map((r) => hydrateRow(tableName, r));
    return !includeDeleted ? hydrated.filter((r) => !isDeletedRecord(r)) : hydrated;
  } catch (err: any) {
    const msg = String(err?.message || err || '');
    if (msg.includes('no such table') || msg.includes('no such column')) return [];
    throw err;
  }
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
    const timestamp = options.customTimestamp ?? Date.now();

    await TableManager.applyMutation(
      this.tx,
      tableName,
      rowId,
      operation,
      payload,
      pk,
      this.parent.localMutationOptions(timestamp)
    );

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

  async updateMany(
    tableName: string,
    updates: Array<{ id: string; payload: Record<string, any> }>,
    options: MutateOptions = {}
  ): Promise<void> {
    for (const u of updates) {
      await this.update(tableName, u.id, u.payload, options);
    }
  }

  async delete(
    tableName: string,
    rowId: string,
    options: MutateOptions = {}
  ): Promise<void> {
    await this.mutate(tableName, rowId, 'DELETE', null, options);
  }

  async findById<T = any>(
    tableName: string,
    id: string,
    options?: { includeDeleted?: boolean }
  ): Promise<T | null> {
    return executeFindById<T>(this.tx, tableName, id, this.parent.getPrimaryKey(), (t, r) => this.parent.hydrateRow<T>(t, r), options?.includeDeleted);
  }

  async findByIds<T = any>(
    tableName: string,
    ids: string[],
    options?: { includeDeleted?: boolean }
  ): Promise<T[]> {
    return executeFindByIds<T>(this.tx, tableName, ids, this.parent.getPrimaryKey(), (t, r) => this.parent.hydrateRow<T>(t, r), options?.includeDeleted);
  }

  async findMany<T = any>(tableName: string, options?: QueryOptions): Promise<T[]> {
    if (!this.parent.db.supportsSqlPushdown || shouldUseClientSideQuery(options)) {
      const rows = await this.from<T>(tableName).execute();
      return applyQueryOptions<T>(rows, options);
    }
    return this.from<T>(tableName).applyOptions(options).execute();
  }

  /**
   * Alias for findMany().
   */
  async find<T = any>(tableName: string, options?: QueryOptions): Promise<T[]> {
    return this.findMany<T>(tableName, options);
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return (await this.tx.execute(sql, params)) as T[];
  }

  from<T = any>(tableName: string): QueryBuilder<T> {
    return new QueryBuilder<T>(this, tableName);
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
  public jsonColumns: Record<string, string[]>;
  public autoHydrateJSON: boolean;
  /** Local column stamped on INSERT/UPDATE writes, or null when disabled. */
  public touchColumn: string | null;
  public readonly maintenance: DatabaseMaintenance;
  public readonly actions: ActionManager;
  public readonly keys: ApiKeyManager;
  public readonly kv: KVManager;
  public readonly search: SearchManager;
  public readonly storage: BlobStorageManager;
  public readonly scheduler: JobScheduler;
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
    this.jsonColumns = config.jsonColumns ?? {};
    this.autoHydrateJSON = config.autoHydrateJSON ?? false;
    const touch = config.touchUpdatedAt ?? true;
    this.touchColumn =
      touch === false
        ? null
        : typeof touch === 'string'
          ? touch
          : ((this.remote as any)?.updatedAtColumn as string | undefined) || 'updated_at';
    this.schemaManager = new SchemaManager();
    this.maintenance = new DatabaseMaintenance(this.db, () => [
      ...this.tables,
      '_local_kv',
      '_local_blobs',
      '_local_scheduled_jobs',
      '_local_job_runs',
      '_local_api_keys',
      '_local_actions',
    ]);

    const actionNetwork = config.actions?.network ?? config.network;
    this.keys = new ApiKeyManager(this.db, config.keys);
    this.kv = new KVManager(this.db, this.events, config.kv);
    this.search = new SearchManager(this.db, this.events, (table, id) => this.findById(table, id));
    this.storage = new BlobStorageManager(this.db, {
      network: config.network,
      ...config.storage,
    });
    this.scheduler = new JobScheduler(this.db, config.scheduler);

    this.actions = new ActionManager(
      this.db,
      this.events,
      () => Promise.resolve(actionNetwork ? actionNetwork.isOnline() : true),
      {
        network: actionNetwork,
        ...config.actions,
      }
    );

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
      syncScope: config.syncScope,
      autoPauseOnBackground: config.autoPauseOnBackground,
    };

    this.syncWorker = new SyncWorker(this.db, this.remote, this.events, workerOptions);
  }

  getPrimaryKey(): string {
    return this.primaryKey;
  }

  /**
   * Options for TableManager.applyMutation on locally-originated writes.
   * The touch value uses the mutation timestamp so it matches what remote
   * adapters (e.g. Supabase) write for the same operation on push.
   */
  localMutationOptions(timestamp: number) {
    return {
      autoSchema: this.autoSchema,
      schemaManager: this.schemaManager,
      touchColumn: this.touchColumn,
      touchValue: new Date(timestamp).toISOString(),
    };
  }

  /**
   * Automatically deserializes JSON string columns into JavaScript objects/arrays.
   */
  hydrateRow<T = any>(tableName: string, row: any): T {
    if (!row || typeof row !== 'object') return row;
    const cols = this.jsonColumns[tableName];
    if (cols && cols.length > 0) {
      const copy = { ...row };
      for (const col of cols) {
        if (typeof copy[col] === 'string') {
          const val = copy[col].trim();
          if ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('[') && val.endsWith(']'))) {
            try {
              copy[col] = JSON.parse(val);
            } catch {
              // keep string if not valid JSON
            }
          }
        }
      }
      return copy as T;
    }
    if (this.autoHydrateJSON) {
      const copy = { ...row };
      for (const [key, val] of Object.entries(copy)) {
        if (typeof val === 'string') {
          const trimmed = val.trim();
          if (
            (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))
          ) {
            try {
              copy[key] = JSON.parse(trimmed);
            } catch {
              // keep string
            }
          }
        }
      }
      return copy as T;
    }
    return row as T;
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
    timestamp: number,
    pendingOutboxMap?: Map<string, OutboxRecord>
  ): Promise<string | undefined> {
    const pendingKey = tableName + ':' + rowId;
    if (this.coalesceOutbox) {
      const existing = pendingOutboxMap
        ? pendingOutboxMap.get(pendingKey)
        : await OutboxStore.findPendingByRow(tx, tableName, rowId);
      if (existing && existing.status === 'PENDING') {
        if (operation === 'DELETE') {
          if (existing.operation === 'INSERT') {
            await OutboxStore.deleteRecord(tx, existing.id);
            pendingOutboxMap?.delete(pendingKey);
            return undefined;
          }
          await OutboxStore.updateOperation(tx, existing.id, 'DELETE', null, timestamp);
          if (pendingOutboxMap) {
            existing.operation = 'DELETE';
            existing.payload = null;
            existing.timestamp = timestamp;
          }
          return existing.id;
        }
        if (operation === 'UPDATE') {
          const merged = { ...(existing.payload || {}), ...(payload || {}) };
          await OutboxStore.updatePayload(tx, existing.id, merged, timestamp);
          if (pendingOutboxMap) {
            existing.payload = merged;
            existing.timestamp = timestamp;
          }
          return existing.id;
        }
        if (operation === 'INSERT') {
          await OutboxStore.updateOperation(tx, existing.id, 'INSERT', payload, timestamp);
          if (pendingOutboxMap) {
            existing.operation = 'INSERT';
            existing.payload = payload;
            existing.timestamp = timestamp;
          }
          return existing.id;
        }
      }
    }
    const outboxId = generateUUID();
    await OutboxStore.insertRecord(tx, { id: outboxId, tableName, rowId, operation, payload, timestamp });
    pendingOutboxMap?.set(pendingKey, {
      id: outboxId, tableName, rowId, operation, payload, timestamp,
      status: 'PENDING', retryCount: 0, lastError: null,
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
    try {
      await this.db.execute('PRAGMA journal_mode = WAL;');
      await this.db.execute('PRAGMA synchronous = NORMAL;');
      await this.db.execute('PRAGMA busy_timeout = 5000;');
      await this.db.execute('PRAGMA cache_size = -64000;');
    } catch {
      // Ignored for drivers, mock DBs, or in-memory modes that do not support PRAGMAs
    }

    await OutboxStore.ensureSchema(this.db);
    await MetaStore.ensureSchema(this.db);
    await OutboxStore.resetStaleProcessing(this.db);
    await this.actions.initialize();
    await this.keys.initialize();
    await this.kv.initialize();
    await this.storage.initialize();
    await this.scheduler.initialize();

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
    const timestamp = options.customTimestamp ?? Date.now();

    let affectedOutboxId: string | undefined;

    const executeInTransaction = async (tx: LocalTransaction) => {
      // 1. Mutate local table
      await TableManager.applyMutation(
        tx,
        tableName,
        rowId,
        operation,
        payload,
        pk,
        this.localMutationOptions(timestamp)
      );

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
    const pendingOutboxOps: SyncOperation[] = [];
    let pendingOutboxMap: Map<string, OutboxRecord> | undefined;

    const executeInTx = async (tx: LocalTransaction) => {
      if (this.coalesceOutbox && mutations.length > 1) {
        pendingOutboxMap = await OutboxStore.getActivePendingMap(tx);
      }
      for (const m of mutations) {
        const pk = m.primaryKey ?? options.primaryKey ?? this.primaryKey;
        const payload = m.payload ?? null;
        const rowId: string =
          m.rowId ||
          (payload && payload[pk] !== undefined && payload[pk] !== null
            ? String(payload[pk])
            : generateUUID());
        generatedIds.push(rowId);
        const timestamp = m.customTimestamp ?? options.customTimestamp ?? Date.now();

        await TableManager.applyMutation(
          tx,
          m.tableName,
          rowId,
          m.operation,
          payload,
          pk,
          this.localMutationOptions(timestamp)
        );

        const skipOutbox = m.skipOutbox ?? options.skipOutbox ?? false;
        if (!skipOutbox) {
          if (this.coalesceOutbox && m.operation !== 'INSERT') {
            const outboxId = await this.recordOutboxMutation(
              tx,
              m.tableName,
              rowId,
              m.operation,
              payload,
              timestamp,
              pendingOutboxMap
            );
            if (outboxId) {
              queuedOutboxIds.push(outboxId);
            }
          } else {
            const outboxId = generateUUID();
            pendingOutboxOps.push({
              id: outboxId,
              tableName: m.tableName,
              rowId,
              operation: m.operation,
              payload,
              timestamp,
            });
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

      if (pendingOutboxOps.length > 0) {
        await OutboxStore.insertRecords(tx, pendingOutboxOps);
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
   * Updates multiple records atomically in a single database transaction.
   * Emits reactive change events and queues outbox entries together.
   *
   * Example:
   * await client.updateMany('todos', [
   *   { id: 'todo-1', payload: { completed: 1 } },
   *   { id: 'todo-2', payload: { completed: 1 } },
   * ]);
   */
  async updateMany(
    tableName: string,
    updates: Array<{ id: string; payload: Record<string, any> }>,
    options: MutateOptions = {}
  ): Promise<void> {
    if (!updates || updates.length === 0) return;
    const mutations: BatchMutation[] = updates.map((u) => ({
      tableName,
      rowId: u.id,
      operation: 'UPDATE',
      payload: u.payload,
    }));
    await this.batch(mutations, options);
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
  /**
   * Executes a raw relational SQL query with parameters directly against SQLite.
   * Enables complex multi-table JOINs, GROUP BY aggregations (COUNT, SUM, AVG), CTEs, and window functions.
   */
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return (await this.db.execute(sql, params)) as T[];
  }

  /**
   * Returns a fluent SQL QueryBuilder for the specified table.
   * Allows writing clean JavaScript method chains (select, join, leftJoin, where, orderBy, groupBy)
   * that automatically compile into optimized native SQLite queries.
   *
   * Example:
   * const activeRentals = await client
   *   .from('contracts')
   *   .join('houses', 'contracts.house_id', 'houses.id')
   *   .leftJoin('tenants', 'contracts.tenant_id', 'tenants.id')
   *   .where({ 'contracts.business_id': bizId, 'contracts.status': 'ACTIVE' })
   *   .select('contracts.id', 'contracts.rent_amount', 'houses.house_number', 'tenants.name')
   *   .execute();
   */
  from<T = any>(tableName: string): QueryBuilder<T> {
    return new QueryBuilder<T>(this, tableName);
  }

  /**
   * Executes a native SQLite COUNT(*) query and returns the count directly.
   */
  async count(tableName: string, options?: { where?: WhereFilter }): Promise<number> {
    const qb = this.from(tableName);
    if (options?.where) qb.where(options.where);
    return qb.count();
  }

  /**
   * Executes a native SQLite SUM(column) query and returns the sum directly.
   */
  async sum(tableName: string, column: string, options?: { where?: WhereFilter }): Promise<number> {
    const qb = this.from(tableName);
    if (options?.where) qb.where(options.where);
    return qb.sum(column);
  }

  /**
   * Executes a native SQLite AVG(column) query and returns the average directly.
   */
  async avg(tableName: string, column: string, options?: { where?: WhereFilter }): Promise<number | null> {
    const qb = this.from(tableName);
    if (options?.where) qb.where(options.where);
    return qb.avg(column);
  }

  /**
   * Executes native multi-metric SQLite aggregation in a single query.
   *
   * Example:
   * const stats = await client.aggregate('receipts', {
   *   where: { business_id: bizId },
   *   count: true,
   *   sum: ['amount', 'refunded_amount'],
   *   avg: ['amount']
   * });
   */
  async aggregate(tableName: string, spec: AggregateSpec): Promise<AggregateResult> {
    const projections: string[] = [];
    if (spec.count) {
      projections.push('COUNT(*) AS "_count"');
    }
    if (spec.sum) {
      for (const col of spec.sum) {
        projections.push(`COALESCE(SUM("${col.replace(/"/g, '""')}"), 0) AS "sum_${col}"`);
      }
    }
    if (spec.avg) {
      for (const col of spec.avg) {
        projections.push(`AVG("${col.replace(/"/g, '""')}") AS "avg_${col}"`);
      }
    }
    if (spec.min) {
      for (const col of spec.min) {
        projections.push(`MIN("${col.replace(/"/g, '""')}") AS "min_${col}"`);
      }
    }
    if (spec.max) {
      for (const col of spec.max) {
        projections.push(`MAX("${col.replace(/"/g, '""')}") AS "max_${col}"`);
      }
    }

    if (projections.length === 0) {
      return {};
    }

    const qb = this.from(tableName).select(...projections);
    if (spec.where) {
      qb.where(spec.where);
    }

    const rows = await qb.execute();
    const row = (rows[0] as any) || {};
    const result: AggregateResult = {};

    if (spec.count) {
      result.count = typeof row._count === 'number' ? row._count : Number(row._count) || 0;
    }
    if (spec.sum) {
      result.sum = {};
      for (const col of spec.sum) {
        const val = row[`sum_${col}`];
        result.sum[col] = typeof val === 'number' ? val : Number(val) || 0;
      }
    }
    if (spec.avg) {
      result.avg = {};
      for (const col of spec.avg) {
        const val = row[`avg_${col}`];
        result.avg[col] = val === null || val === undefined ? null : Number(val) || 0;
      }
    }
    if (spec.min) {
      result.min = {};
      for (const col of spec.min) {
        result.min[col] = row[`min_${col}`];
      }
    }
    if (spec.max) {
      result.max = {};
      for (const col of spec.max) {
        result.max[col] = row[`max_${col}`];
      }
    }

    return result;
  }

  async findMany<T = any>(tableName: string, options?: QueryOptions): Promise<T[]> {
    if (!this.db.supportsSqlPushdown || shouldUseClientSideQuery(options)) {
      const rows = await this.from<T>(tableName).execute();
      return applyQueryOptions<T>(rows, options);
    }
    return this.from<T>(tableName).applyOptions(options).execute();
  }

  /**
   * Alias for findMany().
   */
  async find<T = any>(tableName: string, options?: QueryOptions): Promise<T[]> {
    return this.findMany<T>(tableName, options);
  }

  /**
   * Returns true if client storage has successfully initialized.
   */
  get isReady(): boolean {
    return Boolean(this.initialization);
  }

  /**
   * Convenience export of tables to JSON.
   */
  async exportToJson(tables?: string[], options?: ExportJsonOptions): Promise<string> {
    return exportTablesToJson(this, tables, options);
  }

  /**
   * Convenience import of tables from JSON.
   */
  async importFromJson(jsonString: string, options?: ImportJsonOptions): Promise<ImportSummary> {
    return importTablesFromJson(this, jsonString, options);
  }

  /**
   * Convenience export of a table to RFC-4180 CSV.
   */
  async exportToCsv(tableName: string, options?: ExportCsvOptions): Promise<string> {
    return exportTableToCsv(this, tableName, options);
  }

  /**
   * Convenience import of RFC-4180 CSV into a table.
   */
  async importFromCsv(tableName: string, csvString: string, options?: ImportCsvOptions): Promise<{ rowCount: number }> {
    return importTableFromCsv(this, tableName, csvString, options);
  }

  /**
   * Finds a single record by primary key.
   *
   * Example:
   * const tenant = await client.findById('tenants', 'ten-1');
   */
  async findById<T = any>(
    tableName: string,
    id: string,
    options?: { includeDeleted?: boolean }
  ): Promise<T | null> {
    return executeFindById<T>(this.db, tableName, id, this.primaryKey, (t, r) => this.hydrateRow<T>(t, r), options?.includeDeleted);
  }

  async findByIds<T = any>(
    tableName: string,
    ids: string[],
    options?: { includeDeleted?: boolean }
  ): Promise<T[]> {
    return executeFindByIds<T>(this.db, tableName, ids, this.primaryKey, (t, r) => this.hydrateRow<T>(t, r), options?.includeDeleted);
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
   * Dynamically sets or updates the active sync scope.
   */
  setSyncScope(scope?: Record<string, any> | (() => Record<string, any> | Promise<Record<string, any>>)): void {
    this.syncWorker.setSyncScope(scope);
  }

  /**
   * Stops all active intervals, background sync loops, and network listeners.
   */
  stop(): void {
    this.syncWorker.stop();
    this.actions.stop();
    this.scheduler.stop();
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
  async reset(options: { dropTables?: boolean; includeInternal?: boolean } = {}): Promise<void> {
    this.stop();

    const internalTables = [
      '_local_kv',
      '_local_blobs',
      '_local_scheduled_jobs',
      '_local_job_runs',
      '_local_api_keys',
      '_local_actions',
    ];
    const tablesToReset = Array.from(
      new Set([
        ...this.tables,
        'sync_outbox',
        'sync_meta',
        ...(options.includeInternal ? internalTables : []),
      ])
    );
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

  private async getAllTableNames(): Promise<string[]> {
    const list = new Set(this.tables);
    list.add('sync_outbox');
    list.add('sync_meta');
    try {
      const rows = await this.db.execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
      );
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (r.name) list.add(r.name);
        }
      }
    } catch {
      // Non-SQLite database adapter, fallback to configured tables
    }
    return Array.from(list);
  }

  /**
   * Exports the entire local database state as a portable binary snapshot.
   * If the local adapter has a native export mechanism (e.g. serialize or export),
   * it uses that; otherwise, it exports an atomic JSON snapshot of all tables.
   */
  async exportDatabase(): Promise<Uint8Array> {
    await this.initialize();
    if (typeof (this.db as any).exportDatabase === 'function') {
      return (this.db as any).exportDatabase();
    }
    if (typeof (this.db as any).serialize === 'function') {
      return new Uint8Array((this.db as any).serialize());
    }
    if (typeof (this.db as any).export === 'function') {
      return new Uint8Array((this.db as any).export());
    }

    const tables = await this.getAllTableNames();
    const snapshot: Record<string, any[]> = {};
    for (const table of tables) {
      const safeTable = escapeIdentifier(table);
      try {
        const rows = await this.db.execute(`SELECT * FROM ${safeTable}`);
        snapshot[table] = rows || [];
      } catch {
        // Table may not exist yet
      }
    }

    const payload = JSON.stringify({
      format: 'local-lite-backup-v1',
      timestamp: Date.now(),
      tables: snapshot,
    });
    return new TextEncoder().encode(payload);
  }

  /**
   * Imports database state from a backup snapshot.
   */
  async importDatabase(data: Uint8Array): Promise<void> {
    if (!data || data.length === 0) {
      throw new Error('Cannot restore an empty database snapshot.');
    }

    await this.initialize();

    if (typeof (this.db as any).importDatabase === 'function') {
      await (this.db as any).importDatabase(data);
      this.schemaManager.clearCache();
      this.events.emit('reset', { dropTables: false });
      return;
    }

    // Check if data is SQLite format (magic header: "SQLite format 3\0")
    const isSqlite =
      data.length > 16 &&
      data[0] === 0x53 &&
      data[1] === 0x51 &&
      data[2] === 0x4c &&
      data[3] === 0x69 &&
      data[4] === 0x74 &&
      data[5] === 0x65 &&
      data[6] === 0x20 &&
      data[7] === 0x66 &&
      data[8] === 0x6f &&
      data[9] === 0x72 &&
      data[10] === 0x6d &&
      data[11] === 0x61 &&
      data[12] === 0x74 &&
      data[13] === 0x20 &&
      data[14] === 0x33 &&
      data[15] === 0x00;

    if (isSqlite) {
      if (typeof (this.db as any).load === 'function') {
        await (this.db as any).load(data);
        this.schemaManager.clearCache();
        this.events.emit('reset', { dropTables: false });
        return;
      }
      throw new Error(
        'Direct SQLite binary snapshot import requires an adapter with native import/load support (e.g. sql.js).',
      );
    }

    // Parse portable JSON backup snapshot
    try {
      const text = new TextDecoder().decode(data);
      const parsed = JSON.parse(text);
      if (parsed.tables && typeof parsed.tables === 'object') {
        await this.db.transaction(async tx => {
          for (const [table, rows] of Object.entries(parsed.tables)) {
            const safeTable = escapeIdentifier(table);
            if (Array.isArray(rows) && rows.length > 0) {
              for (const row of rows) {
                if (row && typeof row === 'object') {
                  await this.schemaManager.ensureColumns(tx, table, row, this.primaryKey);
                }
              }
              await tx.execute(`DELETE FROM ${safeTable}`);
              for (const row of rows) {
                const cols = Object.keys(row);
                const safeCols = cols.map(escapeIdentifier).join(', ');
                const placeholders = cols.map(() => '?').join(', ');
                const values = cols.map(c => {
                  const val = row[c];
                  return val !== null && typeof val === 'object' ? JSON.stringify(val) : val;
                });
                await tx.execute(
                  `INSERT INTO ${safeTable} (${safeCols}) VALUES (${placeholders})`,
                  values,
                );
              }
            } else {
              try {
                await tx.execute(`DELETE FROM ${safeTable}`);
              } catch {}
            }
          }
        });
        this.schemaManager.clearCache();
        this.events.emit('reset', { dropTables: false });
        return;
      }
    } catch (err: any) {
      throw new Error(`Failed to import backup snapshot: ${err?.message || err}`);
    }
  }

  /**
   * Creates a backup directly from this client to the given cloud or local storage.
   */
  async backup(
    storage: BackupStorage,
    options?: CreateDatabaseBackupOptions & Partial<EncryptedBackupOptions>,
  ): Promise<string> {
    return performBackup(this, storage, options);
  }

  /**
   * Restores this client's database from a backup in cloud or local storage.
   */
  async restore(
    storage: BackupStorage,
    fileNameOrId: string,
    options?: Partial<RestoreEncryptedBackupOptions>,
  ): Promise<void> {
    return performRestore(this, storage, fileNameOrId, options);
  }
}