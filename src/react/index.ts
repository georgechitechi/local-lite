import { useEffect, useState, useCallback } from 'react';
import { LocalFirstClient } from '../core/client.js';

/**
 * Hook to execute a query and automatically re-run it whenever the table is mutated
 * (either locally or via incoming remote delta).
 * 
 * Safely passes the non-null `client` instance to `queryFn(client)`.
 */
export function useLiveQuery<T>(
  client: LocalFirstClient | null | undefined,
  tableName: string,
  queryFn: (client: LocalFirstClient) => Promise<T[]> | T[]
): { data: T[]; refetch: () => Promise<void>; loading: boolean } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!client || !client.db) return;
    try {
      const res = await queryFn(client);
      setData(res || []);
    } catch (err) {
      console.error(`Error in useLiveQuery("${tableName}"):`, err);
    } finally {
      setLoading(false);
    }
  }, [client, tableName, queryFn]);

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
