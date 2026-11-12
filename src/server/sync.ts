import type {
  DeltaChange,
  DeltaChanges,
  SyncOperation,
  SyncOp,
} from '../core/types.js';
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
      if (entry.timestamp > maxCursor) maxCursor = entry.timestamp;
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
