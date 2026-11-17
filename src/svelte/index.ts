import { LocalFirstClient } from '../core/client.js';
import { QueryOptions, SyncStatusEvent } from '../core/types.js';

export interface SvelteReadable<T> {
  subscribe(run: (value: T) => void): () => void;
}

export interface LiveQueryState<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
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
      let active = true;
      let state: LiveQueryState<T> = { data: [], loading: true, error: null };
      run(state);

      const refresh = async () => {
        try {
          const rows = await client
            .from<T>(tableName)
            .applyOptions(options)
            .execute();
          if (!active) return;
          state = { data: rows, loading: false, error: null };
          run(state);
        } catch (err: any) {
          if (!active) return;
          state = {
            ...state,
            loading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          };
          run(state);
        }
      };

      void refresh();
      const unsubTable = client.events.on(tableName, () => {
        void refresh();
      });
      const unsubReset = client.events.on('reset', () => {
        void refresh();
      });

      return () => {
        active = false;
        unsubTable();
        unsubReset();
      };
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
      run({
        isOnline: true,
        isPushing: false,
        isPulling: false,
        pendingCount: 0,
      });
      void client
        .getMetrics()
        .then((m) =>
          run({
            isOnline: m.isOnline,
            isPushing: m.isPushing,
            isPulling: m.isPulling,
            pendingCount: m.outboxPendingCount,
          }),
        )
        .catch(() => {});
      return client.events.on('sync:status', (status: SyncStatusEvent) => {
        run(status);
      });
    },
  };
}
