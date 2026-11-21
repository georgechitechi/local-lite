import { LocalFirstClient } from '../core/client.js';
import { QueryOptions, SyncStatusEvent } from '../core/types.js';
import {
  subscribeLiveQuery,
  subscribeSyncStatus,
} from '../reactive/live-query.js';

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
export function useLiveQuery<T = Record<string, unknown>>(
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

  const { refresh, dispose } = subscribeLiveQuery<T>(
    client,
    tableName,
    options,
    (state) => {
      data.value = state.data;
      loading.value = state.loading;
      error.value = state.error;
    },
  );

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
  const dispose = subscribeSyncStatus(client, (next) => {
    status.value = next;
  });
  vue.onUnmounted?.(dispose);
  return { status, dispose };
}
