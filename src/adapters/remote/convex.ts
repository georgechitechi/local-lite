import {
  RemoteAutomationJob,
  RemoteBackupArchive,
  RemoteDBAdapter,
} from './index.js';
import {
  DeltaChange,
  DeltaChanges,
  SyncOp,
  SyncOperation,
  PushResult,
} from '../../core/types.js';
import {
  SyncLogger,
  CustomLogger,
  LogLevel,
  createSyncLogger,
  formatConvexError,
} from '../../utils/logger.js';
import {
  createConvexStorageUploader,
  ConvexStorageUploaderOptions,
  ConvexStorageUploaderInstance,
} from '../../storage/convex.js';

function getRowTimestamp(value: unknown, fallback?: unknown): number {
  const timestamp = value ?? fallback;
  if (typeof timestamp === 'number' && Number.isFinite(timestamp))
    return timestamp;
  if (typeof timestamp === 'string') {
    const numeric = Number(timestamp);
    if (timestamp.trim() !== '' && Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error('Convex change is missing a valid updatedAt timestamp.');
}

function getRowId(row: any, primaryKey: string): string {
  const id = row?.[primaryKey] ?? row?._id ?? row?.id;
  if (id === undefined || id === null || String(id).length === 0) {
    throw new Error('Convex change is missing its document ID.');
  }
  return String(id);
}

export interface ConvexRemoteAdapterOptions {
  /**
   * Tables synchronized with Convex.
   */
  tables?: string[];

  /**
   * Primary key field name. Default: 'id' (or falls back to '_id').
   */
  primaryKey?: string;

  /**
   * Name or function reference for Convex push mutation.
   * Default: 'sync:pushBatch'
   */
  pushMutation?: any;

  /**
   * Name or function reference for Convex delta pull query.
   * Default: 'sync:pullDeltas'
   */
  pullQuery?: any;

  /**
   * Column used for soft deletes. Default: 'deleted'
   */
  deletedColumn?: string;

  /**
   * Column used for updated timestamps. Default: 'updatedAt'
   */
  updatedAtColumn?: string;

  /**
   * Custom logger or false to silence logs in production.
   */
  logger?: SyncLogger | CustomLogger | boolean;

  /**
   * Minimum log level. Default: 'info'
   */
  logLevel?: LogLevel;
}

export class ConvexRemoteAdapter implements RemoteDBAdapter {
  private client: any;
  private tables: string[];
  private primaryKey: string;
  private pushMutation: any;
  private pullQuery: any;
  private deletedColumn: string;
  private updatedAtColumn: string;
  private unsubscribeLive?: () => void;
  private liveCallback?: (changes: DeltaChanges) => void;
  private liveScope?:
    | Record<string, any>
    | (() => Record<string, any> | Promise<Record<string, any>>);
  private liveGeneration = 0;
  public logger: SyncLogger;

  constructor(client: any, options: ConvexRemoteAdapterOptions = {}) {
    if (!client) {
      throw new Error('ConvexRemoteAdapter requires a ConvexClient instance.');
    }
    this.client = client;
    this.tables = options.tables ?? [];
    this.primaryKey = options.primaryKey ?? 'id';
    this.pushMutation = options.pushMutation ?? 'sync:pushBatch';
    this.pullQuery = options.pullQuery ?? 'sync:pullDeltas';
    this.deletedColumn = options.deletedColumn ?? 'deleted';
    this.updatedAtColumn = options.updatedAtColumn ?? 'updatedAt';

    this.logger = createSyncLogger(options.logger, options.logLevel);
  }

  /**
   * Dynamically update tracked tables.
   */
  setTables(tables: string[]): void {
    this.tables = tables;
  }

  /**
   * Pushes outbox operations as a batch mutation to Convex.
   */
  async pushChanges(
    operations: SyncOperation[],
  ): Promise<boolean | PushResult> {
    if (!operations || operations.length === 0) {
      return true;
    }

    try {
      const payload = operations.map((op) => ({
        id: op.id,
        tableName: op.tableName,
        rowId: op.rowId,
        operation: op.operation,
        payload: op.payload,
        timestamp: op.timestamp,
      }));

      const res = await this.client.mutation(this.pushMutation, {
        operations: payload,
      });

      if (res && typeof res === 'object' && Array.isArray(res.failedIds)) {
        return {
          success: res.failedIds.length === 0,
          failedIds: res.failedIds,
          errors: res.errors,
        };
      }

      return res !== false;
    } catch (error) {
      this.logger.error(formatConvexError(error, { operation: 'pushChanges' }));
      return false;
    }
  }

  /**
   * Fetches delta changes from Convex since a given timestamp.
   */
  async fetchChanges(
    sinceTimestamp: number,
    scope?: Record<string, any>,
  ): Promise<DeltaChanges> {
    try {
      const res = await this.client.query(this.pullQuery, {
        sinceTimestamp,
        tables: this.tables,
        ...(scope ? { scope } : {}),
      });

      if (!res) {
        return { timestamp: sinceTimestamp, changes: [] };
      }

      // 1. If backend returns structured DeltaChanges { timestamp, changes }
      if (res.changes && Array.isArray(res.changes)) {
        return {
          timestamp: Number(res.timestamp || sinceTimestamp),
          changes: res.changes,
        };
      }

      // 2. If backend returns an array of updated documents
      if (Array.isArray(res)) {
        let maxServerTimestamp = sinceTimestamp;
        const changes: DeltaChange[] = [];

        for (const row of res) {
          const isSoftDeleted = Boolean(
            row[this.deletedColumn] === true ||
            row[this.deletedColumn] === 1 ||
            (row[this.deletedColumn] &&
              !['false', '0', 'null', 'undefined'].includes(
                String(row[this.deletedColumn]).toLowerCase(),
              )),
          );

          const operation: SyncOp = isSoftDeleted ? 'DELETE' : 'UPDATE';
          const rowTime = getRowTimestamp(
            row[this.updatedAtColumn],
            row._creationTime,
          );

          if (rowTime > maxServerTimestamp) {
            maxServerTimestamp = rowTime;
          }

          const rowId = getRowId(row, this.primaryKey);
          const tableName =
            row.tableName ||
            row._table ||
            (this.tables.length === 1 ? this.tables[0] : 'default');

          changes.push({
            tableName,
            operation,
            rowId,
            payload: isSoftDeleted ? null : row,
            timestamp: rowTime,
          });
        }

        return {
          timestamp: changes.length > 0 ? maxServerTimestamp : sinceTimestamp,
          changes,
        };
      }

      return { timestamp: sinceTimestamp, changes: [] };
    } catch (error) {
      this.logger.error(
        formatConvexError(error, { operation: 'fetchChanges' }),
      );
      throw error;
    }
  }

  /**
   * Subscribes to live reactive query updates from Convex.
   */
  subscribeToLiveChanges(
    callback: (changes: DeltaChanges) => void,
    scope?:
      | Record<string, any>
      | (() => Record<string, any> | Promise<Record<string, any>>),
  ): () => void {
    this.liveCallback = callback;
    this.liveScope = scope;
    this.refreshLiveSubscription();
    return () => {
      if (this.liveCallback !== callback) return;
      this.liveCallback = undefined;
      this.destroy();
    };
  }

  setSyncScope(
    scope?:
      | Record<string, any>
      | (() => Record<string, any> | Promise<Record<string, any>>),
  ): void {
    this.liveScope = scope;
    if (this.liveCallback) this.refreshLiveSubscription();
  }

  private refreshLiveSubscription(): void {
    this.unsubscribeLive?.();
    this.unsubscribeLive = undefined;
    const generation = ++this.liveGeneration;
    const callback = this.liveCallback;
    if (!callback || typeof this.client.onUpdate !== 'function') return;

    const subscribe = (scope?: Record<string, any>) => {
      if (generation !== this.liveGeneration || this.liveCallback !== callback)
        return;
      try {
        const unsubscribe = this.client.onUpdate(
          this.pullQuery,
          {
            sinceTimestamp: Date.now() - 2000,
            tables: this.tables,
            ...(scope ? { scope } : {}),
          },
          (data: any) => {
            if (generation !== this.liveGeneration || !data) return;
            if (data.changes && Array.isArray(data.changes)) {
              callback({
                timestamp: Number(data.timestamp || Date.now()),
                changes: data.changes,
              });
              return;
            }
            if (Array.isArray(data) && data.length > 0) {
              const changes: DeltaChange[] = data.map((row: any) => {
                const isSoftDeleted = Boolean(row[this.deletedColumn] === true);
                const op: SyncOp = isSoftDeleted ? 'DELETE' : 'UPDATE';
                const rowTime = getRowTimestamp(
                  row[this.updatedAtColumn],
                  row._creationTime,
                );
                const rowId = getRowId(row, this.primaryKey);
                const tableName =
                  row.tableName || row._table || (this.tables[0] ?? 'default');
                return {
                  tableName,
                  operation: op,
                  rowId,
                  payload: isSoftDeleted ? null : row,
                  timestamp: rowTime,
                };
              });
              const maxTime = Math.max(
                ...changes.map((change) => change.timestamp || 0),
              );
              callback({
                timestamp: maxTime > 0 ? maxTime : Date.now(),
                changes,
              });
            }
          },
        );
        if (generation !== this.liveGeneration) {
          if (typeof unsubscribe === 'function') unsubscribe();
          return;
        }
        this.unsubscribeLive =
          typeof unsubscribe === 'function' ? unsubscribe : undefined;
      } catch (err) {
        console.warn(
          'ConvexRemoteAdapter live subscription failed to initialize:',
          err,
        );
      }
    };

    try {
      const scopeResult =
        typeof this.liveScope === 'function'
          ? this.liveScope()
          : this.liveScope;
      if (scopeResult && typeof scopeResult.then === 'function') {
        void Promise.resolve(scopeResult)
          .then(subscribe)
          .catch((err) => {
            console.warn(
              'ConvexRemoteAdapter live scope failed to resolve:',
              err,
            );
          });
      } else {
        subscribe(scopeResult);
      }
    } catch (err) {
      console.warn('ConvexRemoteAdapter live scope failed to resolve:', err);
    }
  }

  /**
   * Cleans up live subscriptions.
   */
  destroy(): void {
    this.liveGeneration++;
    this.liveCallback = undefined;
    if (this.unsubscribeLive) {
      this.unsubscribeLive();
      this.unsubscribeLive = undefined;
    }
  }

  /**
   * Helper to create a remote storage uploader targeting Convex File Storage.
   * Connects local-lite offline blob/file storage directly to Convex File Storage.
   */
  createStorageUploader(
    options: ConvexStorageUploaderOptions = {},
  ): ConvexStorageUploaderInstance {
    return createConvexStorageUploader(this.client, options);
  }

  /**
   * Invokes a remote Convex action or mutation.
   */
  async call<T = any>(functionName: string, args: any = {}): Promise<T> {
    if (typeof this.client?.action === 'function') {
      try {
        return await this.client.action(functionName as any, args);
      } catch (err: any) {
        if (
          typeof this.client?.mutation === 'function' &&
          err?.message?.includes?.('not an action')
        ) {
          return await this.client.mutation(functionName as any, args);
        }
        throw err;
      }
    }
    if (typeof this.client?.mutation === 'function') {
      return await this.client.mutation(functionName as any, args);
    }
    throw new Error(
      'Convex client does not support action or mutation execution.',
    );
  }

  /**
   * Queries a remote Convex query function.
   */
  async queryRemote<T = any>(queryName: string, args: any = {}): Promise<T> {
    if (typeof this.client?.query === 'function') {
      return await this.client.query(queryName as any, args);
    }
    throw new Error('Convex client does not support query execution.');
  }

  /**
   * Lists automated cron jobs configured on Convex.
   */
  async listAutomations(): Promise<RemoteAutomationJob[]> {
    return this.queryRemote<RemoteAutomationJob[]>(
      'functions/automations:listMine',
      {},
    );
  }

  /**
   * Enables or disables an automated cron job on Convex.
   */
  async setAutomationEnabled(jobId: string, enabled: boolean): Promise<void> {
    return this.call<void>('functions/automations:setEnabled', {
      jobId,
      enabled,
    });
  }

  /**
   * Lists cloud backup archives stored on Convex.
   */
  async listBackups(): Promise<RemoteBackupArchive[]> {
    return this.queryRemote<RemoteBackupArchive[]>(
      'functions/convexBackups:listMyBackups',
      {},
    );
  }

  /**
   * Gets a direct download URL for a file stored on Convex.
   */
  async getDownloadUrl(fileIdOrKey: string): Promise<string | null> {
    if (typeof this.client?.query === 'function') {
      try {
        return await this.client.query(
          'functions/convexBackups:getDownloadUrl' as any,
          { storageId: fileIdOrKey },
        );
      } catch {}
    }
    return null;
  }
}

export {
  createConvexStorageUploader,
  type ConvexStorageUploaderOptions,
  type ConvexStorageUploaderInstance,
};
