import { useEffect, useState, useCallback, useRef } from 'react';
import { LocalFirstClient } from '../core/client.js';
import { QueryOptions } from '../core/types.js';

export type LiveQueryFn<T> = (client: LocalFirstClient) => Promise<T[]> | T[];

/**
 * Hook to execute a live reactive table query that automatically re-runs
 * whenever the table is mutated locally or via incoming remote delta.
 *
 * Supports 3 flexible usage patterns:
 * 1. Zero-SQL (all rows):
 *    const { data: todos } = useLiveQuery<Todo>(client, 'todos');
 *
 * 2. Declarative options (filtering & sorting without SQL):
 *    const { data: active } = useLiveQuery<Todo>(client, 'todos', {
 *      where: { completed: 0 },
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

  useEffect(() => {
    if (!client || !client.db) return;

    refetch();

    const unsubscribe = client.events.on(tableName, () => {
      refetch();
    });

    return () => {
      unsubscribe();
    };
  }, [client, tableName, refetch]);

  return { data, refetch, loading };
}

/**
 * Hook that tracks the status and pending items in sync_outbox in real time.
 */
export function useOutboxStatus(client: LocalFirstClient | null | undefined): {
  pendingCount: number;
  pendingRecords: any[];
  refresh: () => Promise<void>;
} {
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingRecords, setPendingRecords] = useState<any[]>([]);

  const refresh = useCallback(async () => {
    if (!client || !client.db) return;
    try {
      const records = await client.db.execute(
        'SELECT * FROM sync_outbox ORDER BY timestamp DESC'
      );
      setPendingRecords(records || []);
      setPendingCount((records || []).length);
    } catch {
      // Ignored if table doesn't exist yet
    }
  }, [client]);

  useEffect(() => {
    if (!client || !client.db) return;

    refresh();

    const unsubscribe = client.events.on('sync_outbox', () => {
      refresh();
    });

    return () => {
      unsubscribe();
    };
  }, [client, refresh]);

  return { pendingCount, pendingRecords, refresh };
}
