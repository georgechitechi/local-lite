import { LocalDBAdapter, LocalTransaction } from '../adapters/local/index.js';
import { RemoteDBAdapter } from '../adapters/remote/index.js';
import { EventEmitter } from '../reactive/event-emitter.js';
import { SyncWorker, SyncWorkerOptions } from './sync-worker.js';
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

  async initialize(): Promise<void> {
    await this.ensureSchema();
    this.syncWorker.start();
  }

  private async ensureSchema(): Promise<void> {
    await this.db.execute(
      `CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        row_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT,
        timestamp INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );`
    );
  }

  /**
   * Performs an atomic dual-write: updates the local table AND inserts
   * into sync_outbox within the same database transaction.
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
      await this.applyLocalTableMutation(tx, tableName, rowId, operation, payload, pk);

      // 2. Insert into sync_outbox (if not skipped)
      if (!options.skipOutbox) {
        await tx.execute(
          `INSERT INTO sync_outbox (id, table_name, row_id, operation, payload, timestamp, status, retry_count)
           VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0)`,
          [outboxId, tableName, rowId, operation, payload ? JSON.stringify(payload) : null, timestamp]
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
      this.events.emit('sync_outbox', { operation: 'INSERT', rowId: outboxId });
      // 4. Trigger immediate debounced push
      this.syncWorker.schedulePush(20);
    }
  }

  /**
   * Tracks an existing mutation into sync_outbox.
   * Can be passed an existing transaction to keep execution atomic with custom SQL.
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
      await tx.execute(
        `INSERT INTO sync_outbox (id, table_name, row_id, operation, payload, timestamp, status, retry_count)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0)`,
        [outboxId, tableName, rowId, operation, payload ? JSON.stringify(payload) : null, timestamp]
      );
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

    // Trigger immediate debounced push
    this.syncWorker.schedulePush(20);

    return outboxId;
  }

  private async applyLocalTableMutation(
    tx: LocalTransaction,
    tableName: string,
    rowId: string,
    operation: SyncOp,
    payload: Record<string, any> | null,
    primaryKey: string
  ): Promise<void> {
    const safeTable = `"${tableName.replace(/"/g, '""')}"`;
    const safePk = `"${primaryKey.replace(/"/g, '""')}"`;

    if (operation === 'DELETE') {
      await tx.execute(`DELETE FROM ${safeTable} WHERE ${safePk} = ?`, [rowId]);
      return;
    }

    const rowData: Record<string, any> = { ...(payload || {}), [primaryKey]: rowId };
    const keys = Object.keys(rowData);
    if (keys.length === 0) return;

    const existing = await tx.execute(
      `SELECT 1 FROM ${safeTable} WHERE ${safePk} = ? LIMIT 1`,
      [rowId]
    );

    if (existing && existing.length > 0) {
      const updateKeys = keys.filter((k) => k !== primaryKey);
      if (updateKeys.length > 0) {
        const setClause = updateKeys.map((k) => `"${k.replace(/"/g, '""')}" = ?`).join(', ');
        const values = updateKeys.map((k) => rowData[k]);
        values.push(rowId);
        await tx.execute(`UPDATE ${safeTable} SET ${setClause} WHERE ${safePk} = ?`, values);
      }
    } else {
      const cols = keys.map((k) => `"${k.replace(/"/g, '""')}"`).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map((k) => rowData[k]);
      await tx.execute(`INSERT INTO ${safeTable} (${cols}) VALUES (${placeholders})`, values);
    }
  }

  stop(): void {
    this.syncWorker.stop();
  }
}