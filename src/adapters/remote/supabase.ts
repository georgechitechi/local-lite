import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { RemoteDBAdapter } from './index.js';
import { DeltaChange, DeltaChanges, SyncOp, SyncOperation } from '../../core/types.js';

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
   * Column name if soft deletes are used.
   * e.g. 'deleted_at' or 'is_deleted'.
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
   * Optional table name for tracking hard deletes via tombstones.
   * Default: 'sync_tombstones'
   */
  tombstoneTable?: string;
}

export class SupabaseRemoteAdapter implements RemoteDBAdapter {
  private client: SupabaseClient;
  private tables: string[];
  private updatedAtColumn: string;
  private primaryKey: string;
  private deletedAtColumn?: string;
  private pushRpcName?: string;
  private schema: string;
  private channelName: string;
  private tombstoneTable?: string;
  private activeChannel?: RealtimeChannel;

  constructor(client: SupabaseClient, options: SupabaseAdapterOptions = {}) {
    this.client = client;
    this.tables = options.tables ?? [];
    this.updatedAtColumn = options.updatedAtColumn ?? 'updated_at';
    this.primaryKey = options.primaryKey ?? 'id';
    this.deletedAtColumn = options.deletedAtColumn;
    this.pushRpcName = options.pushRpcName;
    this.schema = options.schema ?? 'public';
    this.channelName = options.channelName ?? 'local_first_sync';
    this.tombstoneTable = options.tombstoneTable ?? 'sync_tombstones';
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
  async pushChanges(operations: SyncOperation[]): Promise<boolean> {
    if (!operations || operations.length === 0) {
      return true;
    }

    // 1. If custom RPC is configured, perform atomic batch RPC
    if (this.pushRpcName) {
      const { error } = await this.client.rpc(this.pushRpcName, {
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
        console.error('Supabase batch push RPC error:', error);
        return false;
      }
      return true;
    }

    // 2. Direct table operations
    for (const op of operations) {
      try {
        if (op.operation === 'DELETE') {
          if (this.deletedAtColumn) {
            // Soft delete
            const { error } = await this.client
              .from(op.tableName)
              .update({ [this.deletedAtColumn]: new Date(op.timestamp).toISOString() })
              .eq(this.primaryKey, op.rowId);

            if (error) {
              console.error(`Supabase soft-delete error on ${op.tableName}:`, error);
              return false;
            }
          } else {
            // Hard delete
            const { error } = await this.client
              .from(op.tableName)
              .delete()
              .eq(this.primaryKey, op.rowId);

            if (error) {
              console.error(`Supabase delete error on ${op.tableName}:`, error);
              return false;
            }
          }
        } else {
          // INSERT or UPDATE -> upsert into table
          const rowData = {
            ...(op.payload || {}),
            [this.primaryKey]: op.rowId,
          };

          // If updatedAtColumn is present, stamp it if not already provided
          if (this.updatedAtColumn && !rowData[this.updatedAtColumn]) {
            rowData[this.updatedAtColumn] = new Date(op.timestamp).toISOString();
          }

          const { error } = await this.client
            .from(op.tableName)
            .upsert(rowData);

          if (error) {
            console.error(`Supabase upsert error on ${op.tableName}:`, error);
            return false;
          }
        }
      } catch (err) {
        console.error(`Unexpected error syncing operation to ${op.tableName}:`, err);
        return false;
      }
    }

    return true;
  }

  /**
   * Fetches delta changes from Supabase since a given timestamp.
   * Tracks server timestamps to eliminate client clock skew, and queries
   * tombstone table to reliably deliver hard deletes to offline clients.
   */
  async fetchChanges(sinceTimestamp: number): Promise<DeltaChanges> {
    const changes: DeltaChange[] = [];
    const sinceIso = sinceTimestamp > 0 ? new Date(sinceTimestamp).toISOString() : null;
    let maxServerTimestamp = sinceTimestamp;

    // 1. Fetch updated / created rows from active tables
    for (const table of this.tables) {
      try {
        let query = this.client
          .from(table)
          .select('*');

        if (sinceIso) {
          query = query.gt(this.updatedAtColumn, sinceIso);
        }

        if (typeof query.order === 'function') {
          query = query.order(this.updatedAtColumn, { ascending: true });
        }

        const { data, error } = await query;
        if (error) {
          console.error(`Supabase fetchChanges error on ${table}:`, error);
          continue;
        }

        if (data && Array.isArray(data)) {
          for (const row of data) {
            const isSoftDeleted = this.deletedAtColumn
              ? Boolean(row[this.deletedAtColumn])
              : false;

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
        }
      } catch (err) {
        console.error(`Unexpected error fetching changes from ${table}:`, err);
      }
    }

    // 2. Fetch tombstones for hard deletes (if tombstone table is configured)
    if (this.tombstoneTable && this.tables.length > 0) {
      try {
        let tombQuery = this.client
          .from(this.tombstoneTable)
          .select('*');

        if (typeof tombQuery.in === 'function') {
          tombQuery = tombQuery.in('table_name', this.tables);
        }

        if (sinceIso && typeof tombQuery.gt === 'function') {
          tombQuery = tombQuery.gt('deleted_at', sinceIso);
        }

        if (typeof tombQuery.order === 'function') {
          tombQuery = tombQuery.order('deleted_at', { ascending: true });
        }

        const { data: tombstones, error: tombError } = await tombQuery;
        if (!tombError && Array.isArray(tombstones)) {
          for (const tomb of tombstones) {
            const tombTime = tomb.deleted_at
              ? new Date(tomb.deleted_at).getTime()
              : Date.now();

            if (tombTime > maxServerTimestamp) {
              maxServerTimestamp = tombTime;
            }

            changes.push({
              tableName: String(tomb.table_name),
              operation: 'DELETE',
              rowId: String(tomb.row_id),
              payload: null,
              timestamp: tombTime,
            });
          }
        }
      } catch (err) {
        // Ignored if tombstone table does not exist
      }
    }

    return {
      timestamp: changes.length > 0 ? maxServerTimestamp : sinceTimestamp,
      changes,
    };
  }

  /**
   * Subscribes to live realtime postgres_changes from Supabase.
   */
  subscribeToLiveChanges(callback: (changes: DeltaChanges) => void): void {
    if (this.activeChannel) {
      this.client.removeChannel(this.activeChannel);
      this.activeChannel = undefined;
    }

    if (this.tables.length === 0) {
      return;
    }

    const channel = this.client.channel(this.channelName);

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

          const isSoftDeleted = this.deletedAtColumn && op !== 'DELETE'
            ? Boolean(record[this.deletedAtColumn])
            : false;

          const finalOp: SyncOp = isSoftDeleted ? 'DELETE' : op;
          const rowId = String(record[this.primaryKey]);
          const timestamp = record[this.updatedAtColumn]
            ? new Date(record[this.updatedAtColumn]).getTime()
            : Date.now();

          callback({
            timestamp: Date.now(),
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
        // Connected to Supabase Realtime channel
      }
    });

    this.activeChannel = channel;
  }

  /**
   * Unsubscribe from Realtime channel.
   */
  unsubscribe(): void {
    if (this.activeChannel) {
      this.client.removeChannel(this.activeChannel);
      this.activeChannel = undefined;
    }
  }
}
