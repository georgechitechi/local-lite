import type {
  DeltaChange,
  DeltaChanges,
  SyncOperation,
  SyncOp,
} from '../core/types.js';
import type { LocalDBAdapter } from '../adapters/local/index.js';
import type { ApiEndpoint, ApiRequestContext } from './index.js';

export interface ServerSyncRecord {
  rowId: string;
  tableName: string;
  payload: Record<string, any>;
  timestamp: number;
  operation: SyncOp;
  cursor: number;
}

export interface ServerSyncStorage {
  /**
   * Applies client mutations to the server store atomically using Last-Write-Wins.
   */
  applyOperations(
    operations: SyncOperation[],
    serverTime?: number,
  ): Promise<{
    applied: number;
    successfulIds: string[];
    serverTime: number;
    cursor: number;
  }>;

  /**
   * Fetches delta changes across tables since a given cursor or timestamp.
   */
  getDeltas(
    tables: string[],
    since: number,
    limit?: number,
  ): Promise<{
    changes: DeltaChanges;
    cursor: number;
    hasMore: boolean;
    serverTime: number;
  }>;
}

/**
 * In-memory server sync storage.
 * Ideal for development, testing, serverless functions, or lightweight microservices.
 */
export class MemoryServerSyncStorage implements ServerSyncStorage {
  private tables = new Map<string, Map<string, ServerSyncRecord>>();
  private changeLog: ServerSyncRecord[] = [];
  private monotonicCursor = 0;
  private maxChangeLogEntries: number;

  constructor(options: { maxChangeLogEntries?: number } = {}) {
    this.maxChangeLogEntries = options.maxChangeLogEntries ?? 10000;
  }

  async applyOperations(
    operations: SyncOperation[],
    overrideTime?: number,
  ): Promise<{
    applied: number;
    successfulIds: string[];
    serverTime: number;
    cursor: number;
  }> {
    const serverTime = overrideTime ?? Date.now();
    let applied = 0;
    const successfulIds: string[] = [];

    for (const op of operations) {
      if (!op.tableName || !op.rowId) continue;

      if (!this.tables.has(op.tableName)) {
        this.tables.set(op.tableName, new Map());
      }
      const tableMap = this.tables.get(op.tableName)!;
      const existing = tableMap.get(String(op.rowId));

      const opTime = op.timestamp ?? serverTime;
      // Last-Write-Wins: if existing record is newer than the operation, skip overwriting
      if (existing && existing.timestamp > opTime) {
        successfulIds.push(op.id);
        continue;
      }

      this.monotonicCursor += 1;
      const isDelete = op.operation === 'DELETE';
      const recordPayload = isDelete
        ? { id: op.rowId, deleted: true }
        : { ...(existing?.payload || {}), ...(op.payload || {}), id: op.rowId };

      const record: ServerSyncRecord = {
        rowId: String(op.rowId),
        tableName: op.tableName,
        payload: recordPayload,
        timestamp: Math.max(opTime, serverTime),
        operation: op.operation,
        cursor: this.monotonicCursor,
      };

      tableMap.set(record.rowId, record);
      this.changeLog.push(record);
      applied += 1;
      successfulIds.push(op.id);
    }

    if (
      Number.isFinite(this.maxChangeLogEntries) &&
      this.maxChangeLogEntries > 0 &&
      this.changeLog.length > this.maxChangeLogEntries
    ) {
      this.changeLog.splice(
        0,
        this.changeLog.length - this.maxChangeLogEntries,
      );
    }

    return { applied, successfulIds, serverTime, cursor: this.monotonicCursor };
  }

  async getDeltas(
    tables: string[],
    since: number,
    limit: number = 1000,
  ): Promise<{
    changes: DeltaChanges;
    cursor: number;
    hasMore: boolean;
    serverTime: number;
  }> {
    const serverTime = Date.now();

    // Filter log entries that belong to requested tables and happened strictly after `since`
    const candidateEntries = this.changeLog.filter(
      (entry) =>
        (tables.length === 0 || tables.includes(entry.tableName)) &&
        (entry.cursor > since || entry.timestamp > since),
    );

    const hasMore = candidateEntries.length > limit;
    const paged = candidateEntries.slice(0, limit);

    // Deduplicate by (tableName, rowId) to return the most recent delta for each row
    const latestMap = new Map<string, ServerSyncRecord>();
    let maxCursor = since;

    for (const entry of paged) {
      const key = `${entry.tableName}:${entry.rowId}`;
      latestMap.set(key, entry);
      if (entry.cursor > maxCursor) maxCursor = entry.cursor;
      // Only fall back to wall-clock timestamp if the client's cursor is ahead of
      // this in-memory instance (e.g. after a server restart).
      if (since > this.monotonicCursor && entry.timestamp > maxCursor) {
        maxCursor = entry.timestamp;
      }
    }

    const deltaList: DeltaChange[] = Array.from(latestMap.values()).map(
      (entry) => ({
        tableName: entry.tableName,
        operation: entry.operation,
        rowId: entry.rowId,
        payload: entry.payload,
        timestamp: entry.timestamp,
      }),
    );

    return {
      changes: {
        timestamp: serverTime,
        changes: deltaList,
      },
      cursor: maxCursor,
      hasMore,
      serverTime,
    };
  }

  /**
   * Resets all in-memory tables and logs.
   */
  clear(): void {
    this.tables.clear();
    this.changeLog = [];
    this.monotonicCursor = 0;
  }
}

export interface SQLiteServerSyncStorageOptions {
  /**
   * Optional maximum changelog entries to retain. Older entries are compacted after writes.
   */
  maxChangeLogEntries?: number;
}

/**
 * Persistent SQLite-backed ServerSyncStorage for production self-hosted sync servers.
 * Works with any LocalDBAdapter (e.g. BetterSQLite3Adapter, NodeSQLiteAdapter, LibSQLAdapter).
 */
export class SQLiteServerSyncStorage implements ServerSyncStorage {
  private initPromise?: Promise<void>;
  private maxChangeLogEntries?: number;

  constructor(
    private db: LocalDBAdapter,
    options: SQLiteServerSyncStorageOptions = {},
  ) {
    this.maxChangeLogEntries = options.maxChangeLogEntries ?? 10000;
  }

  private async ensureSchema(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await this.db.execute(
          `CREATE TABLE IF NOT EXISTS _sync_server_records (
            table_name TEXT NOT NULL,
            row_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            operation TEXT NOT NULL,
            cursor INTEGER NOT NULL,
            PRIMARY KEY (table_name, row_id)
          );`,
        );
        await this.db.execute(
          `CREATE TABLE IF NOT EXISTS _sync_server_changelog (
            cursor INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            row_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            operation TEXT NOT NULL
          );`,
        );
        await this.db.execute(
          `CREATE INDEX IF NOT EXISTS idx_sync_srv_log_table_cursor ON _sync_server_changelog (table_name, cursor);`,
        );
      })().catch((err) => {
        this.initPromise = undefined;
        throw err;
      });
    }
    await this.initPromise;
  }

  async applyOperations(
    operations: SyncOperation[],
    overrideTime?: number,
  ): Promise<{
    applied: number;
    successfulIds: string[];
    serverTime: number;
    cursor: number;
  }> {
    await this.ensureSchema();
    const serverTime = overrideTime ?? Date.now();
    let applied = 0;
    const successfulIds: string[] = [];
    let latestCursor = 0;

    await this.db.transaction(async (tx) => {
      for (const op of operations) {
        if (!op.tableName || !op.rowId) continue;
        const rowId = String(op.rowId);

        const existingRows = await tx.execute(
          `SELECT payload, timestamp FROM _sync_server_records WHERE table_name = ? AND row_id = ? LIMIT 1`,
          [op.tableName, rowId],
        );
        const existing = existingRows?.[0];
        const opTime = op.timestamp ?? serverTime;

        if (existing && Number(existing.timestamp) > opTime) {
          successfulIds.push(op.id);
          continue;
        }

        let existingPayload: Record<string, any> = {};
        if (existing?.payload) {
          try {
            existingPayload =
              typeof existing.payload === 'string'
                ? JSON.parse(existing.payload)
                : existing.payload;
          } catch {
            existingPayload = {};
          }
        }

        const isDelete = op.operation === 'DELETE';
        const recordPayload = isDelete
          ? { id: op.rowId, deleted: true }
          : { ...existingPayload, ...(op.payload || {}), id: op.rowId };
        const serializedPayload = JSON.stringify(recordPayload);
        const recordTimestamp = Math.max(opTime, serverTime);

        const insertRes = await tx.execute(
          `INSERT INTO _sync_server_changelog (table_name, row_id, payload, timestamp, operation) VALUES (?, ?, ?, ?, ?)`,
          [
            op.tableName,
            rowId,
            serializedPayload,
            recordTimestamp,
            op.operation,
          ],
        );

        let cursor = Number(insertRes?.[0]?.lastInsertRowid ?? 0);
        if (!cursor) {
          const maxRows = await tx.execute(
            `SELECT MAX(cursor) AS cursor FROM _sync_server_changelog`,
          );
          cursor = Number(maxRows?.[0]?.cursor ?? 0);
        }

        await tx.execute(
          `INSERT INTO _sync_server_records (table_name, row_id, payload, timestamp, operation, cursor)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (table_name, row_id) DO UPDATE SET
             payload = excluded.payload,
             timestamp = excluded.timestamp,
             operation = excluded.operation,
             cursor = excluded.cursor`,
          [
            op.tableName,
            rowId,
            serializedPayload,
            recordTimestamp,
            op.operation,
            cursor,
          ],
        );

        latestCursor = Math.max(latestCursor, cursor);
        applied += 1;
        successfulIds.push(op.id);
      }

      if (
        this.maxChangeLogEntries !== undefined &&
        Number.isFinite(this.maxChangeLogEntries) &&
        this.maxChangeLogEntries > 0 &&
        latestCursor > this.maxChangeLogEntries
      ) {
        await tx.execute(
          `DELETE FROM _sync_server_changelog WHERE cursor <= ?`,
          [latestCursor - this.maxChangeLogEntries],
        );
      }
    });

    if (latestCursor === 0) {
      const maxRows = await this.db.execute(
        `SELECT MAX(cursor) AS cursor FROM _sync_server_changelog`,
      );
      latestCursor = Number(maxRows?.[0]?.cursor ?? 0);
    }

    return { applied, successfulIds, serverTime, cursor: latestCursor };
  }

  async getDeltas(
    tables: string[],
    since: number,
    limit: number = 1000,
  ): Promise<{
    changes: DeltaChanges;
    cursor: number;
    hasMore: boolean;
    serverTime: number;
  }> {
    await this.ensureSchema();
    const serverTime = Date.now();
    const safeLimit = Math.max(1, Math.floor(limit));

    const maxRows = await this.db.execute(
      `SELECT MAX(cursor) AS maxCursor FROM _sync_server_changelog`,
    );
    const currentMaxCursor = Number(maxRows?.[0]?.maxCursor ?? 0);
    const useCursorFilter = since <= currentMaxCursor;

    const params: any[] = [since];
    let whereClause = useCursorFilter ? `cursor > ?` : `timestamp > ?`;
    if (tables.length > 0) {
      const placeholders = tables.map(() => '?').join(', ');
      whereClause += ` AND table_name IN (${placeholders})`;
      params.push(...tables);
    }
    params.push(safeLimit + 1);

    const rows = await this.db.execute(
      `SELECT cursor, table_name, row_id, payload, timestamp, operation
       FROM _sync_server_changelog
       WHERE ${whereClause}
       ORDER BY cursor ASC
       LIMIT ?`,
      params,
    );

    const hasMore = rows.length > safeLimit;
    const paged = hasMore ? rows.slice(0, safeLimit) : rows;

    const latestMap = new Map<string, DeltaChange>();
    let maxCursor = since;

    for (const row of paged) {
      let parsedPayload: Record<string, any> = {};
      try {
        parsedPayload =
          typeof row.payload === 'string'
            ? JSON.parse(row.payload)
            : (row.payload ?? {});
      } catch {
        parsedPayload = {};
      }

      const key = `${row.table_name}:${row.row_id}`;
      const ts = Number(row.timestamp);
      const cur = Number(row.cursor);
      latestMap.set(key, {
        tableName: row.table_name,
        operation: row.operation as SyncOp,
        rowId: row.row_id,
        payload: parsedPayload,
        timestamp: ts,
      });
      if (useCursorFilter) {
        if (cur > maxCursor) maxCursor = cur;
      } else {
        if (ts > maxCursor) maxCursor = ts;
      }
    }

    const deltaList = Array.from(latestMap.values());
    return {
      changes: {
        timestamp: serverTime,
        changes: deltaList,
        hasMore,
      },
      cursor: maxCursor,
      hasMore,
      serverTime,
    };
  }

  /**
   * Compacts older changelog entries, retaining the most recent `retentionCount` rows.
   */
  async compactChangeLog(retentionCount: number = 10000): Promise<void> {
    await this.ensureSchema();
    if (!Number.isFinite(retentionCount) || retentionCount < 0) return;
    const maxRows = await this.db.execute(
      `SELECT MAX(cursor) AS cursor FROM _sync_server_changelog`,
    );
    const maxCursor = Number(maxRows?.[0]?.cursor ?? 0);
    if (maxCursor > retentionCount) {
      await this.db.execute(
        `DELETE FROM _sync_server_changelog WHERE cursor <= ?`,
        [maxCursor - retentionCount],
      );
    }
  }
}

export interface ServerSyncEndpointOptions {
  /**
   * Optional secret token expected in `Authorization: Bearer <token>` or `x-sync-secret`.
   */
  secret?: string;

  /**
   * Storage backend for server sync data. Default: MemoryServerSyncStorage instance.
   */
  storage?: ServerSyncStorage;

  /**
   * CORS allowed origin. Default: '*'
   */
  corsOrigin?: string;

  /**
   * Hook called before applying mutations to authorize or mutate incoming operations.
   */
  onBeforePush?: (
    operations: SyncOperation[],
    request: Request,
    auth?: any,
  ) => Promise<SyncOperation[] | void> | SyncOperation[] | void;

  /**
   * Custom authentication / authorization validator (e.g. JWT, OAuth, RLS user).
   * If returns false, returns 401 Unauthorized. If returns user data, passes to hooks.
   */
  authHandler?: (request: Request) => Promise<any> | any;

  /**
   * Hook called before pulling deltas to filter or scope the query (e.g. for Row-Level Security).
   */
  onBeforePull?: (
    tables: string[],
    since: number,
    limit: number,
    request: Request,
    auth?: any,
  ) =>
    | Promise<{
        tables?: string[];
        since?: number;
        limit?: number;
        filter?: any;
      } | void>
    | { tables?: string[]; since?: number; limit?: number; filter?: any }
    | void;
}

/**
 * Creates turnkey push and pull API endpoints for self-hosted multi-device data synchronization.
 */
export function createSyncEndpoint(
  options: ServerSyncEndpointOptions = {},
): ApiEndpoint {
  const storage = options.storage || new MemoryServerSyncStorage();
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': options.corsOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  const verifyAuth = async (request: Request): Promise<any> => {
    if (options.authHandler) {
      const authUser = await options.authHandler(request);
      if (!authUser) return false;
      return authUser;
    }
    if (!options.secret) return true;
    const authHeader = request.headers.get('authorization');
    const match = authHeader === `Bearer ${options.secret}`;
    return match ? { type: 'admin', isAdmin: true } : false;
  };

  // POST: Push batch of mutations (or combined push+pull batch)
  const handlePost = async ({
    request,
  }: ApiRequestContext<unknown>): Promise<Response> => {
    const auth = await verifyAuth(request);
    if (!auth) {
      return Response.json(
        { error: 'Unauthorized: Invalid sync authentication' },
        { status: 401, headers: corsHeaders },
      );
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: 'Bad Request: Invalid JSON body' },
        { status: 400, headers: corsHeaders },
      );
    }

    let operations: SyncOperation[] = Array.isArray(body?.operations)
      ? body.operations
      : [];

    if (options.onBeforePush) {
      const modified = await options.onBeforePush(operations, request, auth);
      if (Array.isArray(modified)) operations = modified;
    }

    const pushResult = await storage.applyOperations(operations);

    // If client requested a combined batch sync (push + pull in single roundtrip):
    if (Array.isArray(body?.tables)) {
      let tables = body.tables;
      let since = Number(body.since ?? 0);
      let limit = body.limit ? Number(body.limit) : 500;
      if (options.onBeforePull) {
        const pullMod = await options.onBeforePull(
          tables,
          since,
          limit,
          request,
          auth,
        );
        if (pullMod?.tables) tables = pullMod.tables;
        if (pullMod?.since !== undefined) since = pullMod.since;
        if (pullMod?.limit !== undefined) limit = pullMod.limit;
      }
      const pullResult = await storage.getDeltas(tables, since, limit);
      return Response.json(
        {
          success: true,
          push: pushResult,
          pull: pullResult,
        },
        { status: 200, headers: corsHeaders },
      );
    }

    return Response.json(
      {
        success: true,
        successfulIds: pushResult.successfulIds,
        processed: pushResult.applied,
        serverTime: pushResult.serverTime,
        cursor: pushResult.cursor,
      },
      { status: 200, headers: corsHeaders },
    );
  };

  // GET: Pull deltas since cursor/timestamp
  const handleGet = async ({
    request,
  }: ApiRequestContext<unknown>): Promise<Response> => {
    const auth = await verifyAuth(request);
    if (!auth) {
      return Response.json(
        { error: 'Unauthorized: Invalid sync authentication' },
        { status: 401, headers: corsHeaders },
      );
    }

    const url = new URL(request.url);
    const tablesParam = url.searchParams.get('tables');
    const sinceParam = url.searchParams.get('since');
    const limitParam = url.searchParams.get('limit');

    let tables = tablesParam
      ? tablesParam
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    let since = sinceParam ? Number(sinceParam) : 0;
    let limit = limitParam ? Number(limitParam) : 500;

    if (options.onBeforePull) {
      const pullMod = await options.onBeforePull(
        tables,
        since,
        limit,
        request,
        auth,
      );
      if (pullMod?.tables) tables = pullMod.tables;
      if (pullMod?.since !== undefined) since = pullMod.since;
      if (pullMod?.limit !== undefined) limit = pullMod.limit;
    }

    const result = await storage.getDeltas(tables, since, limit);

    return Response.json(
      {
        success: true,
        changes: result.changes,
        cursor: result.cursor,
        hasMore: result.hasMore,
        serverTime: result.serverTime,
      },
      { status: 200, headers: corsHeaders },
    );
  };

  const handleOptions = async (): Promise<Response> => {
    return new Response(null, { status: 204, headers: corsHeaders });
  };

  return {
    POST: handlePost,
    GET: handleGet,
    OPTIONS: handleOptions,
  };
}
