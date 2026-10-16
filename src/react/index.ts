import { useEffect, useState, useCallback, useRef } from 'react';
import { LocalFirstClient } from '../core/client.js';
import { QueryOptions, SyncMetrics, SyncStatusEvent } from '../core/types.js';

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
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const queryParamRef = useRef(queryOrOptions);
  queryParamRef.current = queryOrOptions;

  const refetch = useCallback(async () => {
    if (!client || !client.db) return;
    try {
      const param = queryParamRef.current;
      let res: T[];

      if (typeof param === 'function') {
        res = (await param(client)) || [];
      } else if (typeof param === 'object' && param !== null) {
        res = await client.findMany<T>(tableName, param);
      } else {
        res = await client.findMany<T>(tableName);
      }

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
  }, [client, tableName]);

  const scheduleRefetch = useCoalescedRunner(refetch);

  const queryKey =
    typeof queryOrOptions === 'object' && queryOrOptions !== null
      ? JSON.stringify(queryOrOptions)
      : typeof queryOrOptions === 'function'
      ? queryOrOptions
      : undefined;

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
        client.getOutboxRecords().catch(() => []),
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
