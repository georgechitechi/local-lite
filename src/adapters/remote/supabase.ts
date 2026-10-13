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
}

export class SupabaseRemoteAdapter implements RemoteDBAdapter {
  private client: SupabaseClient;
  private tables: string[];
  private updatedAtColumn: string;
  private primaryKey: string;
  private deletedColumn: string;
  private deletedValue: any;
  private pushRpcName?: string;
  private schema: string;
  private channelName: string;
  private activeChannel?: RealtimeChannel;

  constructor(client: SupabaseClient, options: SupabaseAdapterOptions = {}) {
    this.client = client;
    this.tables = options.tables ?? [];
    this.updatedAtColumn = options.updatedAtColumn ?? 'updated_at';
    this.primaryKey = options.primaryKey ?? 'id';
    this.deletedColumn = options.deletedColumn ?? options.deletedAtColumn ?? 'deleted';
    this.deletedValue = options.deletedValue !== undefined ? options.deletedValue : true;
    this.pushRpcName = options.pushRpcName;
    this.schema = options.schema ?? 'public';
    this.channelName = options.channelName ?? 'local_first_sync';
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
          // Soft delete: sets deleted = true and stamps updated_at
          const patch: Record<string, any> = {
            [this.deletedColumn]: this.deletedValue,
          };

          if (this.updatedAtColumn) {
            patch[this.updatedAtColumn] = new Date(op.timestamp).toISOString();
          }

          const { error } = await this.client
            .from(op.tableName)
            .update(patch)
            .eq(this.primaryKey, op.rowId);

          if (error) {
            console.error(`Supabase delete error on ${op.tableName}:`, error);
            return false;
          }
        } else {
          // INSERT or UPDATE -> upsert into table with deleted: false
          const rowData = {
            ...(op.payload || {}),
            [this.primaryKey]: op.rowId,
            [this.deletedColumn]: false,
          };

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
   * Reads updated records and checks `deleted: true` to propagate soft deletes.
   */
  async fetchChanges(sinceTimestamp: number): Promise<DeltaChanges> {
    const changes: DeltaChange[] = [];
    const sinceIso = sinceTimestamp > 0 ? new Date(sinceTimestamp).toISOString() : null;
    let maxServerTimestamp = sinceTimestamp;

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
            const isSoftDeleted = Boolean(
              row[this.deletedColumn] === true ||
              row[this.deletedColumn] === 1 ||
              (row[this.deletedColumn] &&
                !['false', '0', 'null', 'undefined'].includes(String(row[this.deletedColumn]).toLowerCase()))
            );

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

          const isSoftDeleted =
            op !== 'DELETE' &&
            Boolean(
              record[this.deletedColumn] === true ||
              record[this.deletedColumn] === 1 ||
              (record[this.deletedColumn] &&
                !['false', '0', 'null', 'undefined'].includes(String(record[this.deletedColumn]).toLowerCase()))
            );

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
        // Successfully subscribed to Supabase realtime
      }
    });

    this.activeChannel = channel;
  }

  /**
   * Clean up active realtime channels.
   */
  destroy(): void {
    if (this.activeChannel) {
      this.client.removeChannel(this.activeChannel);
      this.activeChannel = undefined;
    }
  }
}
