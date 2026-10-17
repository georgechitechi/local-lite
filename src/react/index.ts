import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { LocalFirstClient, TransactionalClient } from '../core/client.js';
import { BatchMutation, MutateOptions, QueryOptions, SyncMetrics, SyncStatusEvent } from '../core/types.js';

export type LiveQueryFn<T> = (client: LocalFirstClient) => Promise<T[]> | T[];

/**
 * Returns a stable trigger that coalesces bursts of calls into a single run of `fn`.
 * - Calls in the same tick collapse into one run scheduled on the next macrotask.
 * - Calls while a run is in flight collapse into exactly one trailing run.
 * This keeps reactive hooks from re-querying SQLite once per emitted row event.
 */
function useCoalescedRunner(fn: () => Promise<void>): () => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const state = useRef({ scheduled: false, running: false, rerun: false });

  return useCallback(() => {
    const s = state.current;
    if (s.running) {
      s.rerun = true;
      return;
    }
    if (s.scheduled) return;
    s.scheduled = true;
    setTimeout(async () => {
      s.scheduled = false;
      s.running = true;
      try {
        do {
          s.rerun = false;
          await fnRef.current();
        } while (s.rerun);
      } finally {
        s.running = false;
      }
    }, 0);
  }, []);
}

// In-memory query result cache to eliminate initial render latency and flickering
const queryCache = new Map<string, any[]>();
const inFlightQueries = new Map<string, Promise<any[]>>();

/**
 * Clears the in-memory live query cache.
 */
export function clearLiveQueryCache(): void {
  queryCache.clear();
  inFlightQueries.clear();
}

/**
 * Hook to execute a live reactive table query that automatically re-runs
 * whenever the table is mutated locally or via incoming remote delta.
 *
 * Supports 3 flexible usage patterns:
 * 1. Zero-SQL (all rows):
 *    const { data: todos } = useLiveQuery<Todo>(client, 'todos');
 *
 * 2. Declarative options (filtering with rich operators & sorting without SQL):
 *    const { data: active } = useLiveQuery<Todo>(client, 'todos', {
 *      where: { completed: 0, priority: { $gte: 2 } },
 *      orderBy: 'created_at',
 *      order: 'desc'
 *    });
 *
 * 3. Custom query callback (advanced raw SQL / joins):
 *    const { data } = useLiveQuery(client, 'todos', (c) => c.db.execute('SELECT ...'));
 */
export function useLiveQuery<T = any>(
  client: LocalFirstClient | null | undefined,
  tableName: string,
  queryOrOptions?: LiveQueryFn<T> | QueryOptions
): { data: T[]; refetch: () => Promise<void>; loading: boolean } {
  const queryKey =
    typeof queryOrOptions === 'object' && queryOrOptions !== null
      ? JSON.stringify(queryOrOptions)
      : typeof queryOrOptions === 'function'
      ? 'custom'
      : 'all';
  const cacheKey = `${tableName}:${queryKey}`;

  // Read-through cache: return instant cached rows on mount (0ms latency, zero flicker)
  const [data, setData] = useState<T[]>(() => (queryCache.get(cacheKey) as T[]) || []);
  const [loading, setLoading] = useState(() => !queryCache.has(cacheKey));
  const queryParamRef = useRef(queryOrOptions);
  queryParamRef.current = queryOrOptions;

  const refetch = useCallback(async () => {
    if (!client || !client.db) return;
    try {
      // De-duplicate simultaneous identical in-flight queries
      let inFlight = inFlightQueries.get(cacheKey);
      if (!inFlight) {
        inFlight = (async () => {
          const param = queryParamRef.current;
          if (typeof param === 'function') {
            return (await param(client)) || [];
          } else if (typeof param === 'object' && param !== null) {
            return await client.findMany<T>(tableName, param);
          } else {
            return await client.findMany<T>(tableName);
          }
        })();
        inFlightQueries.set(cacheKey, inFlight);
        inFlight.finally(() => {
          inFlightQueries.delete(cacheKey);
        });
      }

      const res: T[] = await inFlight;
      queryCache.set(cacheKey, res || []);
      setData(res || []);
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (msg.includes('no such column') || msg.includes('no such table')) {
        // Table or columns have not been populated yet on fresh database; default to empty list
        setData([]);
      } else {
        console.error(`Error in useLiveQuery("${tableName}"):`, err);
      }
    } finally {
      setLoading(false);
    }
  }, [client, tableName, cacheKey]);

  const scheduleRefetch = useCoalescedRunner(refetch);

  useEffect(() => {
    if (!client || !client.db) return;

    refetch();

    const unsubscribe = client.events.on(tableName, () => {
      scheduleRefetch();
    });

    return () => {
      unsubscribe();
    };
  }, [client, tableName, queryKey, refetch, scheduleRefetch]);

  return { data, refetch, loading };
}

/**
 * Reactive hook to query a single record by primary key with 0ms cache read-through.
 * Automatically re-renders only when this specific row or table changes.
 */
export function useLiveRow<T = any>(
  client: LocalFirstClient | null | undefined,
  tableName: string,
  rowId: string | null | undefined
): { data: T | null; refetch: () => Promise<void>; loading: boolean } {
  const cacheKey = `${tableName}:row:${rowId || 'null'}`;
  const [data, setData] = useState<T | null>(() => {
    if (!rowId) return null;
    const cached = queryCache.get(cacheKey);
    return cached && cached.length > 0 ? (cached[0] as T) : null;
  });
  const [loading, setLoading] = useState(() => Boolean(rowId && !queryCache.has(cacheKey)));

  const refetch = useCallback(async () => {
    if (!client || !client.db || !rowId) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      let inFlight = inFlightQueries.get(cacheKey);
      if (!inFlight) {
        inFlight = client.findById<T>(tableName, rowId).then((r) => (r ? [r] : []));
        inFlightQueries.set(cacheKey, inFlight);
        inFlight.finally(() => inFlightQueries.delete(cacheKey));
      }
      const res = await inFlight;
      const row = res.length > 0 ? (res[0] as T) : null;
      if (row) {
        queryCache.set(cacheKey, [row]);
      } else {
        queryCache.delete(cacheKey);
      }
      setData(row);
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (msg.includes('no such column') || msg.includes('no such table')) {
        setData(null);
      } else {
        console.error(`Error in useLiveRow("${tableName}", "${rowId}"):`, err);
      }
    } finally {
      setLoading(false);
    }
  }, [client, tableName, rowId, cacheKey]);

  const scheduleRefetch = useCoalescedRunner(refetch);

  useEffect(() => {
    if (!client || !client.db || !rowId) return;

    refetch();

    const unsubscribe = client.events.on(tableName, (event: any) => {
      // Precise row-level invalidation: only refetch if event affects this rowId or is a bulk event
      if (!event || !event.rowId || event.rowId === rowId || event.rowId === 'batch') {
        scheduleRefetch();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [client, tableName, rowId, refetch, scheduleRefetch]);

  return { data, refetch, loading };
}

export interface InfiniteQueryOptions extends QueryOptions {
  pageSize?: number;
}

export interface UseLiveInfiniteQueryResult<T> {
  data: T[];
  loading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * Reactive infinite query hook that progressively loads pages of records
 * with live updates when underlying table rows are inserted, updated, or synced.
 */
export function useLiveInfiniteQuery<T = any>(
  client: LocalFirstClient | null | undefined,
  tableName: string,
  options: InfiniteQueryOptions = {}
): UseLiveInfiniteQueryResult<T> {
  const pageSize = options.pageSize || options.limit || 25;
  const [pageCount, setPageCount] = useState(1);
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(true);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;

  const loadData = useCallback(async (pages: number, isNextPage: boolean = false) => {
    if (!client || !client.db) return;
    if (isNextPage) setIsFetchingNextPage(true);

    try {
      const currentOpts = optionsRef.current;
      const fetchLimit = pages * pageSize + 1; // +1 to check for hasNextPage
      const rows = await client.findMany<T>(tableName, {
        ...currentOpts,
        limit: fetchLimit,
        offset: currentOpts.offset || 0,
      });

      if (rows.length > pages * pageSize) {
        setHasNextPage(true);
        setData(rows.slice(0, pages * pageSize));
      } else {
        setHasNextPage(false);
        setData(rows);
      }
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (msg.includes('no such column') || msg.includes('no such table')) {
        setData([]);
        setHasNextPage(false);
      } else {
        console.error(`Error in useLiveInfiniteQuery("${tableName}"):`, err);
      }
    } finally {
      setLoading(false);
      if (isNextPage) setIsFetchingNextPage(false);
    }
  }, [client, tableName, pageSize]);

  const refetch = useCallback(async () => {
    await loadData(pageCountRef.current, false);
  }, [loadData]);

  const scheduleRefetch = useCoalescedRunner(refetch);

  const fetchNextPage = useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage) return;
    const nextPages = pageCountRef.current + 1;
    setPageCount(nextPages);
    await loadData(nextPages, true);
  }, [hasNextPage, isFetchingNextPage, loadData]);

  useEffect(() => {
    if (!client || !client.db) return;

    loadData(1, false);

    const unsubscribe = client.events.on(tableName, () => {
      scheduleRefetch();
    });

    return () => {
      unsubscribe();
    };
  }, [client, tableName, loadData, scheduleRefetch]);

  return {
    data,
    loading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  };
}

export interface UseMutationsResult<TTable extends string = string> {
  client: LocalFirstClient | null | undefined;
  insert: <T extends Record<string, any> = Record<string, any>>(
    tableName: TTable | (string & {}),
    payload: T,
    options?: MutateOptions
  ) => Promise<string | undefined>;
  insertMany: <T extends Record<string, any> = Record<string, any>>(
    tableName: TTable | (string & {}),
    records: T[],
    options?: MutateOptions
  ) => Promise<string[] | undefined>;
  update: <T extends Record<string, any> = Record<string, any>>(
    tableName: TTable | (string & {}),
    rowId: string,
    payload: Partial<T>,
    options?: MutateOptions
  ) => Promise<void>;
  delete: (
    tableName: TTable | (string & {}),
    rowId: string,
    options?: MutateOptions
  ) => Promise<void>;
  batch: (mutations: BatchMutation[]) => Promise<string[] | undefined>;
  transaction: <T>(action: (txClient: TransactionalClient) => Promise<T>) => Promise<T | undefined>;
}

/**
 * Universal mutations hook providing memoized, null-safe helpers for database operations.
 */
export function useMutations<TTable extends string = string>(
  client: LocalFirstClient | null | undefined
): UseMutationsResult<TTable> {
  return useMemo(
    () => ({
      client,
      insert: (table, payload, opts) =>
        client ? client.insert(table, payload, opts) : Promise.resolve(undefined),
      insertMany: (table, records, opts) =>
        client ? client.insertMany(table, records, opts) : Promise.resolve(undefined),
      update: (table, id, payload, opts) =>
        client ? client.update(table, id, payload, opts) : Promise.resolve(),
      delete: (table, id, opts) =>
        client ? client.delete(table, id, opts) : Promise.resolve(),
      batch: (mutations) =>
        client ? client.batch(mutations) : Promise.resolve(undefined),
      transaction: (action) =>
        client ? client.transaction(action) : Promise.resolve(undefined),
    }),
    [client]
  );
}

export interface UseSyncStatusResult {
  isOnline: boolean;
  isPushing: boolean;
  isPulling: boolean;
  isSyncing: boolean;
  pendingCount: number;
  pendingRecords: any[];
  lastSyncedAt: number | null;
  refresh: () => Promise<void>;
}

/**
 * Consolidated hook that tracks real-time sync connectivity, sync worker activity
 * (pushing/pulling/syncing), and pending items in the local SQLite outbox queue.
 */
export function useSyncStatus(client: LocalFirstClient | null | undefined): UseSyncStatusResult {
  const [isOnline, setIsOnline] = useState(true);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingRecords, setPendingRecords] = useState<any[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !client.db) return;
    try {
      const [metrics, records, lastSynced] = await Promise.all([
        client.getMetrics().catch(() => null),
        client.getOutboxRecords({ limit: 50 }).catch(() => []),
        client.getLastSyncedAt().catch(() => null),
      ]);

      if (metrics) {
        setIsOnline(metrics.isOnline);
        setIsPushing(metrics.isPushing);
        setIsPulling(metrics.isPulling);
      }
      if (records) {
        setPendingRecords(records);
        setPendingCount(records.filter((r) => r.status === 'PENDING').length);
      }
      if (lastSynced !== null && lastSynced !== undefined) {
        setLastSyncedAt(lastSynced > 0 ? lastSynced : null);
      }
    } catch {
      // Ignored if client is stopping or tables initializing
    }
  }, [client]);

  const scheduleRefresh = useCoalescedRunner(refresh);

  useEffect(() => {
    if (!client || !client.db) return;

    refresh();

    const unsubStatus = client.events.on('sync:status', (e: SyncStatusEvent) => {
      setIsOnline(e.isOnline);
      setIsPushing(e.isPushing);
      setIsPulling(e.isPulling);
      setPendingCount(e.pendingCount);
    });

    const unsubOutbox = client.events.on('sync_outbox', () => {
      scheduleRefresh();
    });

    const unsubPush = client.events.on('sync:push', () => {
      scheduleRefresh();
    });

    const unsubPull = client.events.on('sync:pull', () => {
      scheduleRefresh();
    });

    return () => {
      unsubStatus();
      unsubOutbox();
      unsubPush();
      unsubPull();
    };
  }, [client, refresh, scheduleRefresh]);

  return {
    isOnline,
    isPushing,
    isPulling,
    isSyncing: isPushing || isPulling,
    pendingCount,
    pendingRecords,
    lastSyncedAt,
    refresh,
  };
}

/**
 * Hook that provides real-time sync telemetry and engine performance metrics.
 */
export function useSyncMetrics(
  client: LocalFirstClient | null | undefined,
  pollIntervalMs: number = 3000
): {
  metrics: SyncMetrics | null;
  refresh: () => Promise<void>;
} {
  const [metrics, setMetrics] = useState<SyncMetrics | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const data = await client.getMetrics();
      setMetrics(data);
    } catch {
      // Ignored
    }
  }, [client]);

  const scheduleRefresh = useCoalescedRunner(refresh);

  useEffect(() => {
    if (!client) return;

    refresh();

    // Listen to sync events for immediate (coalesced) refresh
    const unsubs = [
      client.events.on('sync:push', () => scheduleRefresh()),
      client.events.on('sync:pull', () => scheduleRefresh()),
      client.events.on('sync:status', () => scheduleRefresh()),
    ];

    let timer: any;
    if (pollIntervalMs > 0) {
      timer = setInterval(scheduleRefresh, pollIntervalMs);
    }

    return () => {
      unsubs.forEach((u) => u());
      if (timer) clearInterval(timer);
    };
  }, [client, refresh, scheduleRefresh, pollIntervalMs]);

  return { metrics, refresh };
}

export { SyncInspector } from './SyncInspector.js';
export type { SyncInspectorProps } from './SyncInspector.js';
