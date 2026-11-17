import { LocalFirstClient } from '../core/client.js';
import { QueryOptions, SyncStatusEvent } from '../core/types.js';

export interface SolidApi {
  createSignal<T>(value: T): [() => T, (next: T) => void];
  onCleanup?: (fn: () => void) => void;
}

/**
 * SolidJS primitive for live local-lite queries.
 * Pass `{ createSignal, onCleanup }` from `'solid-js'`.
 */
export function createLiveQuery<T = any>(
  client: LocalFirstClient,
  tableName: string,
  options: QueryOptions | undefined,
  solid: SolidApi,
): {
  data: () => T[];
  loading: () => boolean;
  error: () => Error | null;
  refresh: () => Promise<void>;
  dispose: () => void;
} {
  const [data, setData] = solid.createSignal<T[]>([]);
  const [loading, setLoading] = solid.createSignal<boolean>(true);
  const [error, setError] = solid.createSignal<Error | null>(null);
  let active = true;

  const refresh = async () => {
    try {
      const rows = await client
        .from<T>(tableName)
        .applyOptions(options)
        .execute();
      if (!active) return;
      setData(rows);
      setLoading(false);
      setError(null);
    } catch (err: any) {
      if (!active) return;
      setLoading(false);
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  void refresh();
  const unsubTable = client.events.on(tableName, () => {
    void refresh();
  });
  const unsubReset = client.events.on('reset', () => {
    void refresh();
  });

  const dispose = () => {
    active = false;
    unsubTable();
    unsubReset();
  };

  solid.onCleanup?.(dispose);

  return { data, loading, error, refresh, dispose };
}

/**
 * SolidJS signal for tracking `client.syncWorker` status.
 */
export function createSyncStatus(
  client: LocalFirstClient,
  solid: SolidApi,
): { status: () => SyncStatusEvent; dispose: () => void } {
  const [status, setStatus] = solid.createSignal<SyncStatusEvent>({
    isOnline: true,
    isPushing: false,
    isPulling: false,
    pendingCount: 0,
  });
  void client
    .getMetrics()
    .then((m) =>
      setStatus({
        isOnline: m.isOnline,
        isPushing: m.isPushing,
        isPulling: m.isPulling,
        pendingCount: m.outboxPendingCount,
      }),
    )
    .catch(() => {});
  const unsub = client.events.on('sync:status', (next: SyncStatusEvent) => {
    setStatus(next);
  });
  solid.onCleanup?.(unsub);
  return { status, dispose: unsub };
}
