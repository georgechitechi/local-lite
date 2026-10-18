import { useEffect, useState, useCallback } from 'react';
import { LocalFirstClient } from '../core/client.js';
import { SyncMetrics, SyncStatusEvent } from '../core/types.js';
import { useCoalescedRunner } from './runner.js';

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
        client.getOutboxRecords({ limit: 50 }).catch(() => []),
        client.getLastSyncedAt().catch(() => null),
      ]);

      if (metrics) {
        setIsOnline(metrics.isOnline);
        setIsPushing(metrics.isPushing);
        setIsPulling(metrics.isPulling);
      }
      if (records) {
        setPendingRecords(records);
        const activeCount = metrics
          ? metrics.outboxPendingCount + metrics.outboxProcessingCount + metrics.outboxFailedCount
          : records.length;
        setPendingCount(activeCount);
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
