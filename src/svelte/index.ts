import { LocalFirstClient } from '../core/client.js';
import { QueryOptions, SyncStatusEvent } from '../core/types.js';
import {
  subscribeLiveQuery,
  subscribeSyncStatus,
  type LiveQueryState,
} from '../reactive/live-query.js';

export type { LiveQueryState };

export interface SvelteReadable<T> {
  subscribe(run: (value: T) => void): () => void;
}

/**
 * Creates a Svelte-compatible Readable store (`$store` reactive) backed by a live local-lite query.
 */
export function liveQuery<T = any>(
  client: LocalFirstClient,
  tableName: string,
  options?: QueryOptions,
): SvelteReadable<LiveQueryState<T>> {
  return {
    subscribe(run: (value: LiveQueryState<T>) => void): () => void {
      run({ data: [], loading: true, error: null });
      const { dispose } = subscribeLiveQuery<T>(client, tableName, options, run);
      return dispose;
    },
  };
}

/**
 * Creates a Svelte-compatible Readable store tracking `client.syncWorker` status.
 */
export function syncStatusStore(
  client: LocalFirstClient,
): SvelteReadable<SyncStatusEvent> {
  return {
    subscribe(run: (value: SyncStatusEvent) => void): () => void {
      return subscribeSyncStatus(client, run);
    },
  };
}
