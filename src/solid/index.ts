import { LocalFirstClient } from '../core/client.js';
import { QueryOptions, SyncStatusEvent } from '../core/types.js';
import {
  subscribeLiveQuery,
  subscribeSyncStatus,
} from '../reactive/live-query.js';

export interface SolidApi {
  createSignal<T>(value: T): [() => T, (next: T) => void];
  onCleanup?: (fn: () => void) => void;
}

/**
 * SolidJS primitive for live local-lite queries.
 * Pass `{ createSignal, onCleanup }` from `'solid-js'`.
 */
export function createLiveQuery<T = Record<string, unknown>>(
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

  const { refresh, dispose } = subscribeLiveQuery<T>(
    client,
    tableName,
    options,
    (state) => {
      setData(state.data);
      setLoading(state.loading);
      setError(state.error);
    },
  );

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
  const dispose = subscribeSyncStatus(client, setStatus);
  solid.onCleanup?.(dispose);
  return { status, dispose };
}
