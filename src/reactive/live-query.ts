import type { LocalFirstClient } from '../core/client.js';
import type { QueryOptions, SyncStatusEvent } from '../core/types.js';

export interface LiveQueryState<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
}

/**
 * Framework-agnostic live query subscription helper shared by Svelte, Vue, and Solid bindings.
 */
export function subscribeLiveQuery<T = Record<string, unknown>>(
  client: LocalFirstClient,
  tableName: string,
  options: QueryOptions | undefined,
  onUpdate: (state: LiveQueryState<T>) => void,
): { refresh: () => Promise<void>; dispose: () => void } {
  let active = true;
  let current: LiveQueryState<T> = { data: [], loading: true, error: null };

  const refresh = async () => {
    try {
      const rows = await client
        .from<T>(tableName)
        .applyOptions(options)
        .execute();
      if (!active) return;
      current = { data: rows, loading: false, error: null };
      onUpdate(current);
    } catch (err: unknown) {
      if (!active) return;
      current = {
        ...current,
        loading: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
      onUpdate(current);
    }
  };

  void refresh();
  const unsubTable = client.events.on(tableName, () => {
    void refresh();
  });
  const unsubReset = client.events.on('reset', () => {
    void refresh();
  });

  return {
    refresh,
    dispose() {
      active = false;
      unsubTable();
      unsubReset();
    },
  };
}

/**
 * Framework-agnostic sync status subscription helper shared by Svelte, Vue, and Solid bindings.
 */
export function subscribeSyncStatus(
  client: LocalFirstClient,
  onUpdate: (status: SyncStatusEvent) => void,
): () => void {
  onUpdate({
    isOnline: true,
    isPushing: false,
    isPulling: false,
    pendingCount: 0,
  });

  void client
    .getMetrics()
    .then((m) =>
      onUpdate({
        isOnline: m.isOnline,
        isPushing: m.isPushing,
        isPulling: m.isPulling,
        pendingCount: m.outboxPendingCount,
      }),
    )
    .catch(() => {});

  return client.events.on('sync:status', (next: SyncStatusEvent) => {
    onUpdate(next);
  });
}
