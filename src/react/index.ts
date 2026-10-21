import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { LocalFirstClient, TransactionalClient } from '../core/client.js';
import { BatchMutation, MutateOptions, QueryOptions } from '../core/types.js';
import { useCoalescedRunner } from './runner.js';

export type LiveQueryFn<T> = (client: LocalFirstClient) => Promise<T[]> | T[];

function areRowsEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;

  const aObj = a as Record<string, any>;
  const bObj = b as Record<string, any>;

  if (aObj.id !== undefined && bObj.id !== undefined && aObj.id !== bObj.id) {
    return false;
  }

  const aTs = aObj.updated_at ?? aObj.updatedAt;
  const bTs = bObj.updated_at ?? bObj.updatedAt;
  if (
    aObj.id !== undefined &&
    bObj.id !== undefined &&
    aObj.id === bObj.id &&
    aTs !== undefined &&
    bTs !== undefined
  ) {
    return aTs === bTs;
  }

  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;

  for (let i = 0; i < aKeys.length; i++) {
    const k = aKeys[i];
    const aVal = aObj[k];
    const bVal = bObj[k];
    if (aVal === bVal) continue;

    if (
      aVal &&
      bVal &&
      typeof aVal === 'object' &&
      typeof bVal === 'object'
    ) {
      if (Array.isArray(aVal) !== Array.isArray(bVal)) return false;
      if (JSON.stringify(aVal) !== JSON.stringify(bVal)) return false;
      continue;
    }

    return false;
  }

  return true;
}

function areRowArraysEqual<T>(a: T[] | undefined | null, b: T[] | undefined | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (!areRowsEqual(a[i], b[i])) {
      return false;
    }
  }

  return true;
}

const MAX_QUERY_CACHE_SIZE = 100;

class LRUQueryCache {
  private map = new Map<string, any[]>();

  get(key: string): any[] | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: string, val: any[]): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= MAX_QUERY_CACHE_SIZE) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, val);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

// In-memory query result cache capped with LRU eviction to prevent memory leaks
const queryCache = new LRUQueryCache();
const inFlightQueries = new Map<string, Promise<any>>();
const tableVersions = new Map<string, number>();

function getTableVersion(tableName: string): number {
  return tableVersions.get(tableName) || 0;
}

function advanceTableVersion(tableName: string): number {
  const nextVersion = getTableVersion(tableName) + 1;
  tableVersions.set(tableName, nextVersion);
  return nextVersion;
}

async function fetchDeduped<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let inFlight = inFlightQueries.get(key);
  if (!inFlight) {
    inFlight = fn().finally(() => inFlightQueries.delete(key));
    inFlightQueries.set(key, inFlight);
  }
  return inFlight;
}

/**
 * Clears the in-memory live query cache.
 */
export function clearLiveQueryCache(): void {
  queryCache.clear();
  inFlightQueries.clear();
  tableVersions.clear();
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
    const versionAtStart = getTableVersion(tableName);
    try {
      const res = await fetchDeduped(cacheKey + ':v' + versionAtStart, async () => {
        const param = queryParamRef.current;
        if (typeof param === 'function') return (await param(client)) || [];
        if (typeof param === 'object' && param !== null) return await client.findMany<T>(tableName, param);
        return await client.findMany<T>(tableName);
      });

      if (versionAtStart !== getTableVersion(tableName)) return;
      queryCache.set(cacheKey, res);
      setData((prev) => (areRowArraysEqual(prev, res) ? prev : res));
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (msg.includes('no such column') || msg.includes('no such table')) {
        // Table or columns have not been populated yet on fresh database; default to empty list
        setData((prev) => (prev.length === 0 ? prev : []));
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
      advanceTableVersion(tableName);
      scheduleRefetch();
    });

    return () => {
      unsubscribe();
    };
  }, [client, tableName, queryKey, refetch, scheduleRefetch]);

  return { data, refetch, loading };
}

export type MultiQuerySpec<T = any> =
  | string
  | (QueryOptions & { table?: string })
  | LiveQueryFn<T>;

export type MultiQueryInput =
  | Array<string | (QueryOptions & { table: string })>
  | Record<string, MultiQuerySpec>;

export interface UseLiveQueriesResult<T extends Record<string, any[]>> {
  data: T;
  loading: boolean;
  refetch: () => Promise<void>;
}

interface NormalizedQueryItem {
  key: string;
  table: string;
  queryKey: string;
  cacheKey: string;
  options?: QueryOptions;
  fn?: LiveQueryFn<any>;
}

function normalizeMultiQueries(input: MultiQueryInput): NormalizedQueryItem[] {
  const items: NormalizedQueryItem[] = [];

  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') {
        items.push({
          key: item,
          table: item,
          queryKey: 'all',
          cacheKey: `${item}:all`,
        });
      } else if (typeof item === 'object' && item !== null && item.table) {
        const { table, ...options } = item;
        const qKey = JSON.stringify(options);
        items.push({
          key: table,
          table,
          queryKey: qKey,
          cacheKey: `${table}:${qKey}`,
          options,
        });
      }
    }
  } else if (typeof input === 'object' && input !== null) {
    for (const [key, spec] of Object.entries(input)) {
      if (typeof spec === 'string') {
        items.push({
          key,
          table: spec,
          queryKey: 'all',
          cacheKey: `${spec}:all`,
        });
      } else if (typeof spec === 'function') {
        items.push({
          key,
          table: key,
          queryKey: 'custom',
          cacheKey: `${key}:custom`,
          fn: spec,
        });
      } else if (typeof spec === 'object' && spec !== null) {
        const table = (spec as any).table || key;
        const options: QueryOptions = { ...(spec as any) };
        delete (options as any).table;
        const qKey = JSON.stringify(options);
        items.push({
          key,
          table,
          queryKey: qKey,
          cacheKey: `${table}:${qKey}`,
          options,
        });
      }
    }
  }

  return items;
}

/**
 * Reactive multi-table live query hook that loads data from multiple tables concurrently.
 *
 * Benefits:
 * - Parallel fetching: queries SQLite tables concurrently via Promise.all.
 * - Single atomic React commit: coalesces multiple table results into a single state update,
 *   preventing cascading re-renders and UI freezing.
 * - Multi-table event coordination: listens to mutations across all requested tables,
 *   coalescing updates so downstream calculations only run once.
 * - Zero-latency cache read-through: returns instant cached rows on mount.
 *
 * Usage with dictionary:
 * ```ts
 * const { data, loading } = useLiveQueries(client, {
 *   projects: 'projects',
 *   tasks: { where: { project_id: '123' }, orderBy: 'created_at' },
 *   tags: { table: 'labels' }
 * });
 * // data.projects, data.tasks, data.tags
 * ```
 *
 * Usage with array:
 * ```ts
 * const { data, loading } = useLiveQueries(client, ['projects', 'tasks', 'tags']);
 * // data.projects, data.tasks, data.tags
 * ```
 */
export function useLiveQueries<T extends Record<string, any[]> = Record<string, any[]>>(
  client: LocalFirstClient | null | undefined,
  queries: MultiQueryInput
): UseLiveQueriesResult<T> {
  const signature = useMemo(() => {
    return JSON.stringify(queries, (_, val) => (typeof val === 'function' ? 'fn' : val));
  }, [queries]);

  const items = useMemo(() => normalizeMultiQueries(queries), [signature]);

  const [data, setData] = useState<T>(() => {
    const initial: Record<string, any[]> = {};
    for (const item of items) {
      const cached = queryCache.get(item.cacheKey);
      initial[item.key] = cached ? cached : [];
    }
    return initial as T;
  });

  const [loading, setLoading] = useState(() => {
    if (items.length === 0) return false;
    for (const item of items) {
      if (!queryCache.has(item.cacheKey)) return true;
    }
    return false;
  });

  const refetch = useCallback(async () => {
    if (!client || !client.db || items.length === 0) return;
    try {
      const results = await Promise.all(
        items.map(async (item) => {
          try {
            const versionAtStart = getTableVersion(item.table);
            const rows = await fetchDeduped(item.cacheKey + ':v' + versionAtStart, async () => {
              if (item.fn) return (await item.fn(client)) || [];
              if (item.options) return await client.findMany(item.table, item.options);
              return await client.findMany(item.table);
            });
            if (versionAtStart !== getTableVersion(item.table)) return null;
            queryCache.set(item.cacheKey, rows);
            return { key: item.key, rows };
          } catch (err: any) {
            const msg = String(err?.message || err || '');
            if (msg.includes('no such column') || msg.includes('no such table')) {
              return { key: item.key, rows: [] };
            }
            console.error(`Error in useLiveQueries("${item.table}"):`, err);
            return { key: item.key, rows: [] };
          }
        })
      );

      setData((prev) => {
        let changed = false;
        const next = { ...prev } as Record<string, any[]>;
        for (const res of results) {
          if (!res) continue;
          if (!areRowArraysEqual(prev[res.key], res.rows)) {
            next[res.key] = res.rows;
            changed = true;
          }
        }
        return changed ? (next as T) : prev;
      });
    } finally {
      setLoading(false);
    }
  }, [client, items]);

  const scheduleRefetch = useCoalescedRunner(refetch);

  useEffect(() => {
    if (!client || !client.db || items.length === 0) return;

    refetch();

    const tables = Array.from(new Set(items.map((i) => i.table).filter(Boolean)));
    const unsubs = tables.map((tbl) =>
      client.events.on(tbl, () => {
        advanceTableVersion(tbl);
        scheduleRefetch();
      })
    );

    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [client, signature, refetch, scheduleRefetch]);

  return { data, loading, refetch };
}

/**
 * Reactive hook to query a single record by primary key with 0ms cache read-through.
 * Automatically re-renders only when this specific row or table changes.
 */
export function useLiveRow<T = any>(
  client: LocalFirstClient | null | undefined,
  tableName: string,
  rowId: string | null | undefined,
  options?: { includeDeleted?: boolean }
): { data: T | null; refetch: () => Promise<void>; loading: boolean } {
  const cacheKey = `${tableName}:row:${rowId || 'null'}:${Boolean(options?.includeDeleted)}`;
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
      const versionAtStart = getTableVersion(tableName);
      const res = await fetchDeduped(cacheKey + ':v' + versionAtStart, async () => {
        const r = await client.findById<T>(tableName, rowId, options);
        return r ? [r] : [];
      });
      if (versionAtStart !== getTableVersion(tableName)) return;
      const row = res.length > 0 ? (res[0] as T) : null;
      if (row) {
        queryCache.set(cacheKey, [row]);
      } else {
        queryCache.delete(cacheKey);
      }
      setData((prev) => (areRowsEqual(prev, row) ? prev : row));
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
      advanceTableVersion(tableName);
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

    const versionAtStart = getTableVersion(tableName);
    try {
      const currentOpts = optionsRef.current;
      const fetchLimit = pages * pageSize + 1; // +1 to check for hasNextPage
      const rows = await client.findMany<T>(tableName, {
        ...currentOpts,
        limit: fetchLimit,
        offset: currentOpts.offset || 0,
      });

      if (versionAtStart !== getTableVersion(tableName)) return;
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
      advanceTableVersion(tableName);
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
  updateMany: <T extends Record<string, any> = Record<string, any>>(
    tableName: TTable | (string & {}),
    updates: Array<{ id: string; payload: Partial<T> }>,
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
      updateMany: (table, updates, opts) =>
        client ? client.updateMany(table, updates, opts) : Promise.resolve(),
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

export * from './runner.js';
export * from './status.js';
export * from './theme.js';
export * from './BenchmarkModal.js';
export { SyncInspector, SyncIndicator } from './SyncInspector.js';
export type { SyncInspectorProps, SyncIndicatorProps } from './SyncInspector.js';
