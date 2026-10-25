import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { RemoteDBAdapter } from './index.js';
import { DeltaChange, DeltaChanges, PushResult, SyncOp, SyncOperation } from '../../core/types.js';
import {
  SyncLogger,
  CustomLogger,
  LogLevel,
  createSyncLogger,
  formatSupabaseError,
} from '../../utils/logger.js';

export interface SupabaseAdapterOptions {
  /**
   * The list of Postgres tables to sync.
   * e.g. ['todos', 'notes']
   */
  tables?: string[];

  /**
   * Timestamp column name on Postgres tables used to track updates.
   * Default: 'updated_at'
   */
  updatedAtColumn?: string;

  /**
   * Optional subset of tables to which dynamic `syncScope` filters should apply.
   * If provided, scope filters (like `tenant_id` or `org_id`) will only be attached to queries for these tables.
   * Tables not in this list (e.g. global tables, user profiles) will be fetched without the scope filter.
   */
  scopedTables?: string[];

  /**
   * Primary key column name on Postgres tables.
   * Default: 'id'
   */
  primaryKey?: string;

  /**
   * Soft-delete column name (e.g. 'deleted', 'is_deleted', or 'deleted_at').
   * Default: 'deleted'
   */
  deletedColumn?: string;

  /**
   * Value to write when soft-deleting a row.
   * Default: true
   */
  deletedValue?: any;

  /**
   * Optional custom Postgres RPC function name for batch pushing.
   * If provided, will call `supabase.rpc(pushRpcName, { operations })`.
   */
  pushRpcName?: string;

  /**
   * Postgres schema name.
   * Default: 'public'
   */
  schema?: string;

  /**
   * Name of the Realtime channel.
   * Default: 'local_first_sync'
   */
  channelName?: string;

  /**
   * Custom logger or false to silence logs in production.
   */
  logger?: SyncLogger | CustomLogger | boolean;

  /**
   * Minimum log level. Default: 'info'
   */
  logLevel?: LogLevel;

  /**
   * Maximum records pulled per page from Supabase. Default: 1000
   */
  fetchLimit?: number;
}

export type AnySupabaseClient = SupabaseClient<any, any, any> | any;

export type SupabaseClientResolver =
  | AnySupabaseClient
  | (() => AnySupabaseClient | null | undefined)
  | null
  | undefined;

export class SupabaseRemoteAdapter implements RemoteDBAdapter {
  private clientResolver?: SupabaseClientResolver;
  private activeLiveCallback?: (changes: DeltaChanges) => void;
  private tables: string[];
  private scopedTables?: string[];
  private updatedAtColumn: string;
  private primaryKey: string;
  private deletedColumn: string;
  private deletedValue: any;
  private pushRpcName?: string;
  private schema: string;
  private channelName: string;
  private activeChannel?: RealtimeChannel;
  private fetchLimit: number;
  public logger: SyncLogger;

  constructor(
    clientOrOptions?: SupabaseClientResolver | SupabaseAdapterOptions,
    maybeOptions: SupabaseAdapterOptions = {}
  ) {
    let client: SupabaseClientResolver;
    let options: SupabaseAdapterOptions;

    // Allow new SupabaseRemoteAdapter(options) shorthand when no client is passed initially
    if (
      clientOrOptions &&
      typeof clientOrOptions === 'object' &&
      !('channel' in clientOrOptions) &&
      !('from' in clientOrOptions) &&
      !('auth' in clientOrOptions)
    ) {
      client = null;
      options = clientOrOptions as SupabaseAdapterOptions;
    } else {
      client = clientOrOptions as SupabaseClientResolver;
      options = maybeOptions;
    }

    this.clientResolver = client;
    this.tables = options.tables ?? [];
    this.scopedTables = options.scopedTables;
    this.updatedAtColumn = options.updatedAtColumn ?? 'updated_at';
    this.primaryKey = options.primaryKey ?? 'id';
    this.deletedColumn = options.deletedColumn ?? 'deleted';
    this.deletedValue = options.deletedValue !== undefined ? options.deletedValue : true;
    this.pushRpcName = options.pushRpcName;
    this.schema = options.schema ?? 'public';
    this.channelName = options.channelName ?? 'local_first_sync';
    this.fetchLimit = options.fetchLimit ?? 1000;
    this.logger = createSyncLogger(options.logger, options.logLevel);
  }

  /**
   * Resolves the active Supabase client instance dynamically.
   */
  public getClient(): AnySupabaseClient {
    if (typeof this.clientResolver === 'function') {
      try {
        return this.clientResolver() ?? null;
      } catch {
        return null;
      }
    }
    return this.clientResolver ?? null;
  }

  /**
   * Active Supabase client instance.
   */
  public get client(): AnySupabaseClient {
    return this.getClient();
  }

  /**
   * Dynamically sets or updates the Supabase client or getter function.
   * Automatically cleans up the previous realtime channel and re-subscribes if active.
   */
  public setClient(client: SupabaseClientResolver): void {
    const previousClient = this.getClient();
    this.clientResolver = client;
    const newClient = this.getClient();

    if (this.activeChannel && previousClient?.removeChannel && previousClient !== newClient) {
      try {
        previousClient.removeChannel(this.activeChannel);
      } catch {}
      this.activeChannel = undefined;
    }

    if (this.activeLiveCallback && newClient && typeof newClient.channel === 'function') {
      this.subscribeToLiveChanges(this.activeLiveCallback);
    }
  }

  /**
   * Set or update tracked tables dynamically.
   */
  setTables(tables: string[]): void {
    this.tables = tables;
  }

  /**
   * Pushes outbox operations to Supabase.
   */
  async pushChanges(operations: SyncOperation[]): Promise<boolean | PushResult> {
    if (!operations || operations.length === 0) {
      return true;
    }

    const client = this.getClient();
    if (!client) {
      this.logger.debug('Supabase client is not available; skipping remote push.');
      return false;
    }

    // 1. If custom RPC is configured, perform atomic batch RPC
    if (this.pushRpcName) {
      const { error } = await client.rpc(this.pushRpcName, {
        operations: operations.map((op) => ({
          id: op.id,
          table_name: op.tableName,
          row_id: op.rowId,
          operation: op.operation,
          payload: op.payload,
          timestamp: op.timestamp,
        })),
      });

      if (error) {
        this.logger.error(formatSupabaseError(error, { operation: 'batch_rpc' }));
        return false;
      }
      return true;
    }

    // 2. Direct table operations with consecutive batching and per-operation tracking
    const successfulIds: string[] = [];
    const failedIds: string[] = [];
    const errors: Record<string, string> = {};

    let i = 0;
    while (i < operations.length) {
      const op = operations[i];

      // Batch consecutive INSERTs for the same table
      if (op.operation === 'INSERT') {
        const batch: SyncOperation[] = [];
        while (
          i < operations.length &&
          operations[i].operation === 'INSERT' &&
          operations[i].tableName === op.tableName
        ) {
          batch.push(operations[i]);
          i++;
        }

        if (batch.length === 1) {
          try {
            const rowData = this.buildRowData(batch[0]);
            const { error } = await client.from(op.tableName).upsert(rowData);
            if (error) {
              const msg = formatSupabaseError(error, { table: op.tableName, operation: 'INSERT' });
              this.logger.error(msg);
              failedIds.push(batch[0].id);
              errors[batch[0].id] = msg;
            } else {
              successfulIds.push(batch[0].id);
            }
          } catch (err: any) {
            const msg = formatSupabaseError(err, { table: op.tableName, operation: 'INSERT' });
            this.logger.error(msg);
            failedIds.push(batch[0].id);
            errors[batch[0].id] = msg;
          }
        } else {
          // Bulk upsert for multiple consecutive inserts
          const retryIndividually = async () => {
            for (const item of batch) {
              try {
                const singleRow = this.buildRowData(item);
                const { error: singleErr } = await client.from(op.tableName).upsert(singleRow);
                if (singleErr) {
                  const msg = formatSupabaseError(singleErr, { table: op.tableName, operation: 'INSERT' });
                  failedIds.push(item.id);
                  errors[item.id] = msg;
                } else {
                  successfulIds.push(item.id);
                }
              } catch (singleErr: any) {
                const msg = formatSupabaseError(singleErr, { table: op.tableName, operation: 'INSERT' });
                failedIds.push(item.id);
                errors[item.id] = msg;
              }
            }
          };

          try {
            const rows = batch.map((item) => this.buildRowData(item));
            const { error } = await client.from(op.tableName).upsert(rows);
            if (!error) {
              for (const item of batch) successfulIds.push(item.id);
            } else {
              await retryIndividually();
            }
          } catch {
            await retryIndividually();
          }
        }
        continue;
      }

      // Batch consecutive DELETEs for the same table
      if (op.operation === 'DELETE') {
        const batch: SyncOperation[] = [];
        while (
          i < operations.length &&
          operations[i].operation === 'DELETE' &&
          operations[i].tableName === op.tableName
        ) {
          batch.push(operations[i]);
          i++;
        }

        const patch: Record<string, any> = {
          [this.deletedColumn]: this.deletedValue,
        };
        if (this.updatedAtColumn) {
          patch[this.updatedAtColumn] = new Date(op.timestamp).toISOString();
        }

        if (batch.length === 1) {
          try {
            const { error } = await client
              .from(op.tableName)
              .update(patch)
              .eq(this.primaryKey, op.rowId);

            if (error) {
              const msg = formatSupabaseError(error, { table: op.tableName, operation: 'DELETE' });
              this.logger.error(msg);
              failedIds.push(op.id);
              errors[op.id] = msg;
            } else {
              successfulIds.push(op.id);
            }
          } catch (err: any) {
            const msg = formatSupabaseError(err, { table: op.tableName, operation: 'DELETE' });
            this.logger.error(msg);
            failedIds.push(op.id);
            errors[op.id] = msg;
          }
        } else {
          // Bulk soft-delete using .in() to collapse N round-trips into 1
          const rowIds = batch.map((item) => item.rowId);
          try {
            const { error } = await client
              .from(op.tableName)
              .update(patch)
              .in(this.primaryKey, rowIds);

            if (!error) {
              for (const item of batch) successfulIds.push(item.id);
            } else {
              // Fallback to individual updates if .in() fails
              for (const item of batch) {
                try {
                  const { error: singleErr } = await client
                    .from(op.tableName)
                    .update(patch)
                    .eq(this.primaryKey, item.rowId);
                  if (singleErr) {
                    const msg = formatSupabaseError(singleErr, { table: op.tableName, operation: 'DELETE' });
                    failedIds.push(item.id);
                    errors[item.id] = msg;
                  } else {
                    successfulIds.push(item.id);
                  }
                } catch (singleErr: any) {
                  const msg = formatSupabaseError(singleErr, { table: op.tableName, operation: 'DELETE' });
                  failedIds.push(item.id);
                  errors[item.id] = msg;
                }
              }
            }
          } catch {
            for (const item of batch) failedIds.push(item.id);
          }
        }
        continue;
      }

      // Batch consecutive UPDATEs for the same table
      if (op.operation === 'UPDATE') {
        const batch: SyncOperation[] = [];
        while (
          i < operations.length &&
          operations[i].operation === 'UPDATE' &&
          operations[i].tableName === op.tableName
        ) {
          batch.push(operations[i]);
          i++;
        }

        if (batch.length === 1) {
          const item = batch[0];
          try {
            const patch = this.buildRowData(item);
            const { error, data } = await client
              .from(op.tableName)
              .update(patch)
              .eq(this.primaryKey, item.rowId)
              .select(this.primaryKey);

            if (error) {
              const msg = formatSupabaseError(error, { table: op.tableName, operation: 'UPDATE' });
              this.logger.error(msg);
              failedIds.push(item.id);
              errors[item.id] = msg;
            } else if (!data || data.length === 0) {
              const { error: upsertErr } = await client.from(op.tableName).upsert(patch);
              if (upsertErr) {
                const msg = formatSupabaseError(upsertErr, { table: op.tableName, operation: 'UPSERT_FALLBACK' });
                this.logger.error(msg);
                failedIds.push(item.id);
                errors[item.id] = msg;
              } else {
                successfulIds.push(item.id);
              }
            } else {
              successfulIds.push(item.id);
            }
          } catch (err: any) {
            const msg = formatSupabaseError(err, { table: op.tableName, operation: 'UPDATE' });
            this.logger.error(msg);
            failedIds.push(item.id);
            errors[item.id] = msg;
          }
        } else {
          // Bulk upsert for multiple consecutive updates (merges fields by primaryKey in 1 HTTP call)
          const rows = batch.map((item) => this.buildRowData(item));
          try {
            const { error } = await client.from(op.tableName).upsert(rows);
            if (!error) {
              for (const item of batch) successfulIds.push(item.id);
            } else {
              // Fallback to individual updates if bulk upsert has a schema conflict
              for (const item of batch) {
                try {
                  const singleRow = this.buildRowData(item);
                  const { error: singleErr } = await client.from(op.tableName).upsert(singleRow);
                  if (singleErr) {
                    const msg = formatSupabaseError(singleErr, { table: op.tableName, operation: 'UPDATE' });
                    failedIds.push(item.id);
                    errors[item.id] = msg;
                  } else {
                    successfulIds.push(item.id);
                  }
                } catch (singleErr: any) {
                  const msg = formatSupabaseError(singleErr, { table: op.tableName, operation: 'UPDATE' });
                  failedIds.push(item.id);
                  errors[item.id] = msg;
                }
              }
            }
          } catch {
            for (const item of batch) {
              failedIds.push(item.id);
            }
          }
        }
        continue;
      }

      i++;
    }

    if (failedIds.length === 0) {
      return true;
    }

    return {
      success: false,
      successfulIds,
      failedIds,
      errors,
    };
  }

  /**
   * Fetches delta changes from Supabase since a given timestamp.
   * Reads updated records and checks `deleted: true` to propagate soft deletes.
   */
  async fetchChanges(sinceTimestamp: number, scope?: Record<string, any>): Promise<DeltaChanges> {
    const client = this.getClient();
    if (!client) {
      this.logger.debug('Supabase client is not available; skipping fetchChanges.');
      return {
        timestamp: sinceTimestamp,
        changes: [],
      };
    }

    const changes: DeltaChange[] = [];
    const sinceIso = sinceTimestamp > 0 ? new Date(sinceTimestamp).toISOString() : null;
    let maxServerTimestamp = sinceTimestamp;

    const fetchTableDeltas = async (table: string): Promise<DeltaChange[]> => {
      const isTableScoped = !this.scopedTables || this.scopedTables.includes(table);
      const tableChanges: DeltaChange[] = [];
      let hasMore = true;
      let currentSinceIso = sinceIso;

      while (hasMore) {
        let query = client.from(table).select('*');

        if (isTableScoped && scope && typeof scope === 'object') {
          for (const [col, val] of Object.entries(scope)) {
            if (val !== undefined && val !== null && typeof query.eq === 'function') {
              query = query.eq(col, val);
            }
          }
        }

        if (currentSinceIso) {
          query = query.gt(this.updatedAtColumn, currentSinceIso);
        }

        if (typeof query.order === 'function') {
          query = query.order(this.updatedAtColumn, { ascending: true });
        }

        if (typeof query.limit === 'function') {
          query = query.limit(this.fetchLimit);
        }

        let { data, error } = await query;

        // If PostgreSQL returns 42703 (undefined column) because a scoped column does not exist on this table,
        // gracefully fallback to querying without the scope filter so synchronization doesn't halt.
        if (
          error &&
          (error.code === '42703' || String(error.message || '').includes('does not exist')) &&
          isTableScoped
        ) {
          this.logger.debug(
            `[local-lite] Column in scope does not exist on table "${table}". Retrying without scope filter.`
          );
          let fallbackQuery = client.from(table).select('*');
          if (currentSinceIso) {
            fallbackQuery = fallbackQuery.gt(this.updatedAtColumn, currentSinceIso);
          }
          if (typeof fallbackQuery.order === 'function') {
            fallbackQuery = fallbackQuery.order(this.updatedAtColumn, { ascending: true });
          }
          if (typeof fallbackQuery.limit === 'function') {
            fallbackQuery = fallbackQuery.limit(this.fetchLimit);
          }
          const fallbackResult = await fallbackQuery;
          data = fallbackResult.data;
          error = fallbackResult.error;
        }

        if (error) {
          throw error;
        }

        if (data && Array.isArray(data) && data.length > 0) {
          for (const row of data) {
            const isSoftDeleted = this.isSoftDeleted(row);
            const operation: SyncOp = isSoftDeleted ? 'DELETE' : 'UPDATE';
            const rowTime = row[this.updatedAtColumn]
              ? new Date(row[this.updatedAtColumn]).getTime()
              : Date.now();

            tableChanges.push({
              tableName: table,
              operation,
              rowId: String(row[this.primaryKey]),
              payload: isSoftDeleted ? null : row,
              timestamp: rowTime,
            });
          }

          // Stop paging if unpaginated query or fewer rows than limit returned
          if (typeof query.limit !== 'function' || data.length < this.fetchLimit) {
            hasMore = false;
          } else {
            const lastRow = data[data.length - 1];
            const nextIso = lastRow[this.updatedAtColumn]
              ? new Date(lastRow[this.updatedAtColumn]).toISOString()
              : null;
            if (nextIso && nextIso !== currentSinceIso) {
              currentSinceIso = nextIso;
            } else {
              hasMore = false;
            }
          }
        } else {
          hasMore = false;
        }
      }

      return tableChanges;
    };

    // Query tables in concurrent chunks of 5 to avoid 100+ second serial roundtrips
    const CHUNK_SIZE = 5;
    for (let i = 0; i < this.tables.length; i += CHUNK_SIZE) {
      const chunk = this.tables.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map(async (table) => {
          try {
            return await fetchTableDeltas(table);
          } catch (err: any) {
            const msg = formatSupabaseError(err, { table, operation: 'PULL' });
            if (msg.includes('Network Offline') || msg.includes('Failed to reach')) {
              this.logger.warn(msg);
            } else {
              this.logger.error(msg);
            }
            throw err;
          }
        })
      );
      for (const tableChanges of results) {
        for (const change of tableChanges) {
          if (change.timestamp !== undefined && change.timestamp > maxServerTimestamp) {
            maxServerTimestamp = change.timestamp;
          }
          changes.push(change);
        }
      }
    }

    return {
      timestamp: changes.length > 0 ? maxServerTimestamp : sinceTimestamp,
      changes,
    };
  }

  /**
   * Formats a row payload for remote Supabase storage (adds primaryKey, deleted: false, updated_at).
   */
  private buildRowData(item: SyncOperation): Record<string, any> {
    const row: Record<string, any> = {
      ...(item.payload || {}),
      [this.primaryKey]: item.rowId,
      [this.deletedColumn]: false,
    };
    if (this.updatedAtColumn && !row[this.updatedAtColumn]) {
      row[this.updatedAtColumn] = new Date(item.timestamp).toISOString();
    }
    return row;
  }

  /**
   * Helper to determine if a record represents a soft delete.
   */
  private isSoftDeleted(record: Record<string, any> | null | undefined): boolean {
    if (!record) return false;
    const val = record[this.deletedColumn];
    if (val === true || val === 1) return true;
    if (val && !['false', '0', 'null', 'undefined'].includes(String(val).toLowerCase())) {
      return true;
    }
    return false;
  }

  /**
   * Subscribes to live realtime postgres_changes from Supabase.
   * Batches rapid burst events in the same microtask turn into a single SQLite sync transaction.
   */
  subscribeToLiveChanges(callback: (changes: DeltaChanges) => void): (() => void) | void {
    this.activeLiveCallback = callback;
    const client = this.getClient();

    if (this.activeChannel && client?.removeChannel) {
      try {
        client.removeChannel(this.activeChannel);
      } catch {}
      this.activeChannel = undefined;
    }

    if (!client || typeof client.channel !== 'function') {
      this.logger.debug('Supabase client is not available; skipping live changes subscription.');
      return () => {
        this.activeLiveCallback = undefined;
        this.destroy();
      };
    }

    if (this.tables.length === 0) {
      return () => {
        this.activeLiveCallback = undefined;
        this.destroy();
      };
    }

    const channel = client.channel(this.channelName);
    let pendingLiveChanges: DeltaChange[] = [];
    let isScheduled = false;

    const flushLiveChanges = () => {
      isScheduled = false;
      if (pendingLiveChanges.length === 0) return;
      const toSend = pendingLiveChanges;
      pendingLiveChanges = [];
      const maxTimestamp = Math.max(...toSend.map((c) => c.timestamp || 0), Date.now());
      callback({
        timestamp: maxTimestamp,
        changes: toSend,
      });
    };

    const scheduleFlush =
      typeof queueMicrotask === 'function'
        ? queueMicrotask
        : (fn: () => void) => setTimeout(fn, 0);

    for (const table of this.tables) {
      channel.on(
        'postgres_changes' as any,
        { event: '*', schema: this.schema, table },
        (payload: any) => {
          let op: SyncOp = 'UPDATE';
          if (payload.eventType === 'INSERT') op = 'INSERT';
          else if (payload.eventType === 'DELETE') op = 'DELETE';

          const record = op === 'DELETE' ? payload.old : payload.new;
          if (!record) return;

          const isSoftDeleted = op !== 'DELETE' && this.isSoftDeleted(record);

          const finalOp: SyncOp = isSoftDeleted ? 'DELETE' : op;
          const rowId = String(record[this.primaryKey]);
          const timestamp = record[this.updatedAtColumn]
            ? new Date(record[this.updatedAtColumn]).getTime()
            : Date.now();

          pendingLiveChanges.push({
            tableName: table,
            operation: finalOp,
            rowId,
            payload: finalOp === 'DELETE' ? null : record,
            timestamp,
          });

          if (!isScheduled) {
            isScheduled = true;
            scheduleFlush(flushLiveChanges);
          }
        }
      );
    }

    channel.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        // Successfully subscribed to Supabase realtime
      }
    });

    this.activeChannel = channel;

    return () => {
      flushLiveChanges();
      this.activeLiveCallback = undefined;
      this.destroy();
    };
  }

  /**
   * Clean up active realtime channels.
   */
  destroy(): void {
    const client = this.getClient();
    if (this.activeChannel && client?.removeChannel) {
      try {
        client.removeChannel(this.activeChannel);
      } catch {}
      this.activeChannel = undefined;
    }
  }
}
