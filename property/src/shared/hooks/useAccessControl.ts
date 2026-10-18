import type { User } from '@supabase/supabase-js';
import { useCallback, useMemo } from 'react';
import { useBusiness } from '@/context/BusinessContext';
import { useAuth } from '@/providers/AuthProvider';
import { useBusinessShares, useTenants } from '@/shared/hooks/useStore';
import { OFFLINE_USER_ID } from '@/shared/services/auth';
import {
  isActiveBusinessShare,
  isBusinessOwner,
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

export interface UseAccessControlReturn {
  isOwner: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  isTenant: boolean;
  isAdminOrStaff: boolean;
  isTenantOnly: boolean;
  userRoles: string[];
  loading: boolean;
  hasAccess: (requiredRoles: string | string[]) => boolean;
  hasAllRoles: (requiredRoles: string | string[]) => boolean;
  hasOneRole: (role: string) => boolean;
  hasRole: (role: string) => boolean;
  can: (action: Action, resource: Resource) => boolean;
  cannot: (action: Action, resource: Resource) => boolean;
  canCreate: (resource: Resource) => boolean;
  canView: (resource: Resource) => boolean;
  canEdit: (resource: Resource) => boolean;
  canDelete: (resource: Resource) => boolean;
  user: User | null;
  tenantId: string | null;
}

/** Stable fallback returned when auth is loading or there's no active business. */
const NO_ACCESS: UseAccessControlReturn = {
  isOwner: false,
  isAdmin: false,
  isStaff: false,
  isTenant: false,
  isAdminOrStaff: false,
  isTenantOnly: false,
  userRoles: [] as string[],
  loading: false,
  hasAccess: () => false,
  hasAllRoles: () => false,
  hasOneRole: () => false,
  hasRole: () => false,
  can: () => false,
  cannot: () => true,
  canCreate: () => false,
  canView: () => false,
  canEdit: () => false,
  canDelete: () => false,
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
    const tenant = businessTenants.find((t: any) => t.email?.toLowerCase() === userEmail);
    return tenant ? tenant.id : null;
  }, [authLoading, selectedBusiness, user, businessTenants]);

  const isOwner = useMemo(() => {
    if (authLoading || !selectedBusiness || !user) return false;
    return isBusinessOwner(selectedBusiness, user, OFFLINE_USER_ID);
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

  const isAdmin = useMemo(
    () => isOwner || uniqueRoles.includes('admin'),
    [isOwner, uniqueRoles],
  );
  const isStaff = useMemo(() => uniqueRoles.includes('staff'), [uniqueRoles]);
  const isTenant = useMemo(() => uniqueRoles.includes('tenant'), [uniqueRoles]);
  const isAdminOrStaff = useMemo(() => isAdmin || isStaff, [isAdmin, isStaff]);
  const isTenantOnly = useMemo(
    () => isTenant && !isAdmin && !isStaff,
    [isTenant, isAdmin, isStaff],
  );

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

  const hasRole = useCallback(
    (role: string): boolean => {
      return uniqueRoles.includes(role);
    },
    [uniqueRoles],
  );

  const canCreate = useCallback(
    (resource: Resource): boolean => can('create', resource),
    [can],
  );

  const canView = useCallback(
    (resource: Resource): boolean => can('view', resource),
    [can],
  );

  const canEdit = useCallback(
    (resource: Resource): boolean => can('edit', resource),
    [can],
  );

  const canDelete = useCallback(
    (resource: Resource): boolean => can('delete', resource),
    [can],
  );

  return useMemo(() => {
    if (authLoading) return { ...NO_ACCESS, loading: true };
    if (!selectedBusiness || !user) return { ...NO_ACCESS, user: user || null };

    return {
      isOwner,
      isAdmin,
      isStaff,
      isTenant,
      isAdminOrStaff,
      isTenantOnly,
      userRoles: uniqueRoles,
      loading: false,
      hasAccess,
      hasAllRoles,
      hasOneRole,
      hasRole,
      can,
      cannot,
      canCreate,
      canView,
      canEdit,
      canDelete,
      user,
      tenantId,
    };
  }, [
    authLoading,
    selectedBusiness,
    user,
    isOwner,
    isAdmin,
    isStaff,
    isTenant,
    isAdminOrStaff,
    isTenantOnly,
    uniqueRoles,
    hasAccess,
    hasAllRoles,
    hasOneRole,
    hasRole,
    can,
    cannot,
    canCreate,
    canView,
    canEdit,
    canDelete,
    tenantId,
  ]);
}
