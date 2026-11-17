import { LocalFirstClient } from '../core/client.js';
import { QueryOptions, SyncStatusEvent } from '../core/types.js';

export interface VueRef<T> {
  value: T;
}

export interface VueCompositionApi {
  ref<T>(initial: T): VueRef<T>;
  onUnmounted?: (fn: () => void) => void;
}

/**
 * Vue 3 composable for live local-lite queries.
 * Pass `{ ref, onUnmounted }` from `'vue'` to avoid bundling Vue inside `local-lite`.
 */
export function useLiveQuery<T = any>(
  client: LocalFirstClient,
  tableName: string,
  options: QueryOptions | undefined,
  vue: VueCompositionApi,
): {
  data: VueRef<T[]>;
  loading: VueRef<boolean>;
  error: VueRef<Error | null>;
  refresh: () => Promise<void>;
  dispose: () => void;
} {
  const data = vue.ref<T[]>([]);
  const loading = vue.ref<boolean>(true);
  const error = vue.ref<Error | null>(null);
  let active = true;

  const refresh = async () => {
    try {
      const rows = await client
        .from<T>(tableName)
        .applyOptions(options)
        .execute();
      if (!active) return;
      data.value = rows;
      loading.value = false;
      error.value = null;
    } catch (err: any) {
      if (!active) return;
      loading.value = false;
      error.value = err instanceof Error ? err : new Error(String(err));
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

  vue.onUnmounted?.(dispose);

  return { data, loading, error, refresh, dispose };
}

/**
 * Vue 3 composable for tracking `client.syncWorker` status.
 */
export function useSyncStatus(
  client: LocalFirstClient,
  vue: VueCompositionApi,
): { status: VueRef<SyncStatusEvent>; dispose: () => void } {
  const status = vue.ref<SyncStatusEvent>({
    isOnline: true,
    isPushing: false,
    isPulling: false,
    pendingCount: 0,
  });
  void client
    .getMetrics()
    .then((m) => {
      status.value = {
        isOnline: m.isOnline,
        isPushing: m.isPushing,
        isPulling: m.isPulling,
        pendingCount: m.outboxPendingCount,
      };
    })
    .catch(() => {});
  const unsub = client.events.on('sync:status', (next: SyncStatusEvent) => {
    status.value = next;
  });
  vue.onUnmounted?.(unsub);
  return { status, dispose: unsub };
}
