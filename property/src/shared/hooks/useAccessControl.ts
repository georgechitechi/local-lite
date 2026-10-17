import type { User } from '@supabase/supabase-js';
import { useCallback, useMemo } from 'react';
import { useBusiness } from '@/context/BusinessContext';
import { useAuth } from '@/providers/AuthProvider';
import { useBusinessShares, useTenants } from '@/shared/hooks/useStore';
import { OFFLINE_USER_ID } from '@/shared/services/auth';
import {
  isActiveBusinessShare,
  normalizeIdentity,
  parseShareRoles,
} from '@/shared/utils/businessAccess';
import { ac, mapActionToCrud } from '@/shared/utils/permissions';

export type Resource =
  | 'tenant'
  | 'property'
  | 'house'
  | 'contract'
  | 'receipt'
  | 'maintenance'
  | 'expense'
  | 'report'
  | 'booking'
  | 'transaction';
export type Action = 'create' | 'view' | 'edit' | 'delete';

interface UseAccessControlReturn {
  isOwner: boolean;
  userRoles: string[];
  loading: boolean;
  hasAccess: (requiredRoles: string | string[]) => boolean;
  hasAllRoles: (requiredRoles: string | string[]) => boolean;
  hasOneRole: (role: string) => boolean;
  can: (action: Action, resource: Resource) => boolean;
  cannot: (action: Action, resource: Resource) => boolean;
  user: User | null;
  tenantId: string | null;
}

/** Stable fallback returned when auth is loading or there's no active business. */
const NO_ACCESS = {
  isOwner: false,
  userRoles: [] as string[],
  loading: false,
  hasAccess: () => false,
  hasAllRoles: () => false,
  hasOneRole: () => false,
  can: () => false,
  cannot: () => true,
  user: null,
  tenantId: null,
};

export function useAccessControl(): UseAccessControlReturn {
  const { selectedBusiness } = useBusiness();
  const { user, loading: authLoading } = useAuth();
  const businessShares = useBusinessShares();

  // 1. Get the shared roles for this business and user from local-lite business_shares
  const shareRoles = useMemo(() => {
    if (authLoading || !selectedBusiness || !user) return [] as string[];
    const userEmail = normalizeIdentity(user.email);
    if (!userEmail) return [] as string[];
    const shares = businessShares.filter(
      (s: any) =>
        normalizeIdentity(s.business_id) === normalizeIdentity(selectedBusiness.id) &&
        normalizeIdentity(s.shared_with) === userEmail &&
        isActiveBusinessShare(s),
    );
    return shares.flatMap(share => parseShareRoles(share.roles));
  }, [authLoading, selectedBusiness, user, businessShares]);

  const businessTenants = useTenants(selectedBusiness?.id);

  // 2. Get the tenant ID for this user reactively from SQLite / local-lite
  const tenantId = useMemo(() => {
    if (authLoading || !selectedBusiness || !user) return null;
    const userEmail = user.email?.toLowerCase();
    if (!userEmail) return null;
    const tenant = businessTenants.find(
      (t: any) => t.email?.toLowerCase() === userEmail && !t.deleted,
    );
    return tenant ? tenant.id : null;
  }, [authLoading, selectedBusiness, user, businessTenants]);

  const isOwner = useMemo(() => {
    if (authLoading || !selectedBusiness || !user) return false;
    return (
      user.id === OFFLINE_USER_ID ||
      selectedBusiness.user_id === user.id ||
      selectedBusiness.user_id === OFFLINE_USER_ID
    );
  }, [authLoading, selectedBusiness, user]);

  const uniqueRoles = useMemo(() => {
    if (authLoading || !selectedBusiness || !user) return [] as string[];

    let roles: string[] = [];
    if (isOwner) {
      roles = ['admin'];
    } else {
      roles = [...shareRoles];
      if (tenantId) {
        roles.push('tenant');
      }
    }
    return Array.from(new Set(roles));
  }, [authLoading, selectedBusiness, user, isOwner, shareRoles, tenantId]);

  const hasAccess = useCallback(
    (requiredRoles: string | string[]): boolean => {
      if (isOwner) return true;
      const rolesArray = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
      return rolesArray.some(role => uniqueRoles.includes(role));
    },
    [isOwner, uniqueRoles],
  );

  const hasOneRole = useCallback(
    (role: string): boolean => {
      return uniqueRoles.length === 1 && uniqueRoles.includes(role);
    },
    [uniqueRoles],
  );

  const hasAllRoles = useCallback(
    (requiredRoles: string | string[]): boolean => {
      if (isOwner) return true;
      const rolesArray = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
      return rolesArray.every(role => uniqueRoles.includes(role));
    },
    [isOwner, uniqueRoles],
  );

  const can = useCallback(
    (action: Action, resource: Resource): boolean => {
      if (isOwner) return true;

      // Admin bypass if it happens to be explicitly in uniqueRoles but not isOwner
      if (uniqueRoles.includes('admin')) return true;

      const crudAction = mapActionToCrud(action);

      return uniqueRoles.some(role => {
        try {
          const permission = ac.can(role);

          // Check both 'Any' and 'Own' variations of the action
          const anyMethod = `${crudAction}Any` as keyof typeof permission;
          const ownMethod = `${crudAction}Own` as keyof typeof permission;

          const hasAny = (permission[anyMethod] as any)(resource).granted;
          const hasOwn = (permission[ownMethod] as any)(resource).granted;

          return hasAny || hasOwn;
        } catch (_error) {
          return false;
        }
      });
    },
    [isOwner, uniqueRoles],
  );

  const cannot = useCallback(
    (action: Action, resource: Resource): boolean => {
      return !can(action, resource);
    },
    [can],
  );

  return useMemo(() => {
    if (authLoading) return { ...NO_ACCESS, loading: true };
    if (!selectedBusiness || !user) return { ...NO_ACCESS, user: user || null };

    return {
      isOwner,
      userRoles: uniqueRoles,
      loading: false,
      hasAccess,
      hasAllRoles,
      hasOneRole,
      can,
      cannot,
      user,
      tenantId,
    };
  }, [
    authLoading,
    selectedBusiness,
    user,
    isOwner,
    uniqueRoles,
    hasAccess,
    hasAllRoles,
    hasOneRole,
    can,
    cannot,
    tenantId,
  ]);
}
