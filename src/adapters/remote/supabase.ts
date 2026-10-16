import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { RemoteDBAdapter } from './index.js';
import { DeltaChange, DeltaChanges, PushResult, SyncOp, SyncOperation } from '../../core/types.js';
import {
  SyncLogger,
  CustomLogger,
  LogLevel,
  defaultLogger,
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
   * Legacy alias for deletedColumn.
   */
  deletedAtColumn?: string;

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
    this.updatedAtColumn = options.updatedAtColumn ?? 'updated_at';
    this.primaryKey = options.primaryKey ?? 'id';
    this.deletedColumn = options.deletedColumn ?? options.deletedAtColumn ?? 'deleted';
    this.deletedValue = options.deletedValue !== undefined ? options.deletedValue : true;
    this.pushRpcName = options.pushRpcName;
    this.schema = options.schema ?? 'public';
    this.channelName = options.channelName ?? 'local_first_sync';
    this.fetchLimit = options.fetchLimit ?? 1000;

    if (options.logger instanceof SyncLogger) {
      this.logger = options.logger;
    } else if (typeof options.logger === 'boolean') {
      this.logger = new SyncLogger({ enabled: options.logger, level: options.logLevel });
    } else if (options.logger && typeof options.logger === 'object') {
      this.logger = new SyncLogger({ customLogger: options.logger, level: options.logLevel });
    } else {
      this.logger = options.logLevel ? new SyncLogger({ level: options.logLevel }) : defaultLogger;
    }
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
   * Property getter for backwards-compatibility.
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

        const buildRowData = (item: SyncOperation) => {
          const row: Record<string, any> = {
            ...(item.payload || {}),
            [this.primaryKey]: item.rowId,
            [this.deletedColumn]: false,
          };
          if (this.updatedAtColumn && !row[this.updatedAtColumn]) {
            row[this.updatedAtColumn] = new Date(item.timestamp).toISOString();
          }
          return row;
        };

        if (batch.length === 1) {
          try {
            const rowData = buildRowData(batch[0]);
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
          try {
            const rows = batch.map(buildRowData);
            const { error } = await client.from(op.tableName).upsert(rows);
            if (!error) {
              for (const item of batch) successfulIds.push(item.id);
            } else {
              // On bulk failure, retry individually to isolate only the failing records
              for (const item of batch) {
                try {
                  const singleRow = buildRowData(item);
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
            }
          } catch {
            // Retry individually if bulk threw
            for (const item of batch) {
              try {
                const singleRow = buildRowData(item);
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
          }
        }
        continue;
      }

      // Handle DELETE
      if (op.operation === 'DELETE') {
        try {
          const patch: Record<string, any> = {
            [this.deletedColumn]: this.deletedValue,
          };
          if (this.updatedAtColumn) {
            patch[this.updatedAtColumn] = new Date(op.timestamp).toISOString();
          }

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
        i++;
        continue;
      }

      // Handle UPDATE
      if (op.operation === 'UPDATE') {
        try {
          const patch: Record<string, any> = {
            ...(op.payload || {}),
            [this.deletedColumn]: false,
          };
          if (this.updatedAtColumn) {
            patch[this.updatedAtColumn] = new Date(op.timestamp).toISOString();
          }

          const { error, data } = await client
            .from(op.tableName)
            .update(patch)
            .eq(this.primaryKey, op.rowId)
            .select(this.primaryKey);

          if (error) {
            const msg = formatSupabaseError(error, { table: op.tableName, operation: 'UPDATE' });
            this.logger.error(msg);
            failedIds.push(op.id);
            errors[op.id] = msg;
          } else if (!data || data.length === 0) {
            // If row did not exist remotely, fallback to upsert
            const rowData = {
              ...patch,
              [this.primaryKey]: op.rowId,
            };
            const { error: upsertErr } = await client.from(op.tableName).upsert(rowData);
            if (upsertErr) {
              const msg = formatSupabaseError(upsertErr, { table: op.tableName, operation: 'UPSERT_FALLBACK' });
              this.logger.error(msg);
              failedIds.push(op.id);
              errors[op.id] = msg;
            } else {
              successfulIds.push(op.id);
            }
          } else {
            successfulIds.push(op.id);
          }
        } catch (err: any) {
          const msg = formatSupabaseError(err, { table: op.tableName, operation: 'UPDATE' });
          this.logger.error(msg);
          failedIds.push(op.id);
          errors[op.id] = msg;
        }
        i++;
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
  async fetchChanges(sinceTimestamp: number): Promise<DeltaChanges> {
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

    for (const table of this.tables) {
      try {
        let hasMore = true;
        let currentSinceIso = sinceIso;

        while (hasMore) {
          let query = client
            .from(table)
            .select('*');

          if (currentSinceIso) {
            query = query.gt(this.updatedAtColumn, currentSinceIso);
          }

          if (typeof query.order === 'function') {
            query = query.order(this.updatedAtColumn, { ascending: true });
          }

          if (typeof query.limit === 'function') {
            query = query.limit(this.fetchLimit);
          }

          const { data, error } = await query;
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

              if (rowTime > maxServerTimestamp) {
                maxServerTimestamp = rowTime;
              }

              changes.push({
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
      } catch (err) {
        this.logger.error(formatSupabaseError(err, { table, operation: 'PULL' }));
        throw err;
      }
    }

    return {
      timestamp: changes.length > 0 ? maxServerTimestamp : sinceTimestamp,
      changes,
    };
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

          callback({
            timestamp,
            changes: [
              {
                tableName: table,
                operation: finalOp,
                rowId,
                payload: finalOp === 'DELETE' ? null : record,
                timestamp,
              },
            ],
          });
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
