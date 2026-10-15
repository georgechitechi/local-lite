import { useCallback, useEffect, useRef, useState } from 'react';
import { useProfiles } from '@/shared/hooks/useStore';
import { supabase } from '@/shared/services/supabase';
import type { AuditLog, AuditLogChange } from '@/shared/types/types';

const PAGE_SIZE = 10;

export interface UseAuditLogResult {
  logs: AuditLog[];
  loading: boolean;
  loadMore: () => void;
  hasMore: boolean;
  refresh: () => void;
}

export interface AuditLogTarget {
  entityType: string;
  entityId: string;
  label?: string;
}

/**
 * Fetches paginated audit log entries for given entities.
 * Only fetches when `enabled` is true (i.e. the modal is open).
 *
 * @param entityType - (Optional) Single entity type.
 * @param entityId   - (Optional) Single entity ID.
 * @param targets    - (Optional) Array of { entityType, entityId }.
 * @param enabled    - Set to true to trigger the initial fetch.
 */
export function useAuditLog(
  entityType: string | undefined,
  entityId: string | undefined,
  enabled: boolean,
  targets?: AuditLogTarget[],
): UseAuditLogResult {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const fetchingRef = useRef(false);
  const profiles = useProfiles();

  /**
   * Resolve an actor name from the profiles store.
   * Falls back to a truncated user_id if no profile is found.
   */
  const resolveActorName = useCallback(
    (userId: string | null): string => {
      if (!userId) return 'System';
      const profile = profiles.find(p => p.user_id === userId || p.id === userId);
      if (profile) return profile.name || profile.email || userId.substring(0, 8);
      return userId.substring(0, 8);
    },
    [profiles],
  );

  const fetchPage = useCallback(
    async (reset: boolean) => {
      const allTargets = targets ? [...targets] : [];
      if (entityType && entityId) {
        allTargets.push({ entityType, entityId });
      }

      if (allTargets.length === 0 || fetchingRef.current) return;

      fetchingRef.current = true;
      setLoading(true);

      try {
        const offset = reset ? 0 : offsetRef.current;

        // Construct PostgREST OR string: and(entity_type.eq.X,entity_id.eq.Y),and(entity_type.eq.A,entity_id.eq.B)
        const orConditions = allTargets
          .map(t => `and(entity_type.eq.${t.entityType},entity_id.eq.${t.entityId})`)
          .join(',');

        const { data, error } = await supabase
          .from('audit_logs')
          .select('*')
          .or(orConditions)
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;

        const enriched: AuditLog[] = (data ?? []).map(entry => ({
          ...entry,
          action: entry.action as AuditLog['action'],
          changes: entry.changes as Record<string, AuditLogChange> | null,
          actor_name: resolveActorName(entry.user_id),
        }));

        if (reset) {
          setLogs(enriched);
          offsetRef.current = enriched.length;
        } else {
          setLogs(prev => [...prev, ...enriched]);
          offsetRef.current = offset + enriched.length;
        }

        setHasMore((data ?? []).length === PAGE_SIZE);
      } catch (err) {
        console.warn('[useAuditLog] fetch error:', err);
      } finally {
        setLoading(false);
        fetchingRef.current = false;
      }
    },
    [entityId, entityType, targets, resolveActorName],
  );

  // Trigger initial fetch when enabled (modal opens)
  useEffect(() => {
    const hasTarget = (entityId && entityType) || (targets && targets.length > 0);
    if (!enabled || !hasTarget) return;
    offsetRef.current = 0;
    setLogs([]);
    setHasMore(true);
    fetchPage(true);
  }, [enabled, entityId, entityType, targets, fetchPage]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) fetchPage(false);
  }, [loading, hasMore, fetchPage]);

  const refresh = useCallback(() => {
    offsetRef.current = 0;
    fetchPage(true);
  }, [fetchPage]);

  return { logs, loading, loadMore, hasMore, refresh };
}
