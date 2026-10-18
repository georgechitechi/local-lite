import type { User } from '@supabase/supabase-js';
import { useMemo } from 'react';
import { useBusiness } from '@/context/BusinessContext';
import { useAuth } from '@/providers/AuthProvider';
import { accessEngine } from '@/shared/access/policies';
import type { Action, Resource } from '@/shared/access/types';
import { useBusinessShares, useTenants } from '@/shared/hooks/useStore';
import { OFFLINE_USER_ID } from '@/shared/services/auth';
import {
  isActiveBusinessShare,
  isBusinessOwner,
  normalizeIdentity,
  parseShareRoles,
} from '@/shared/utils/businessAccess';

export type { Action, Resource };

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
  hasAllRoles: (requiredRoles: string[]) => boolean;
  hasOneRole: (role: string) => boolean;
  hasRole: (role: string | string[]) => boolean;
  can: (action: Action, resource: Resource) => boolean;
  cannot: (action: Action, resource: Resource) => boolean;
  canCreate: (resource: Resource) => boolean;
  canView: (resource: Resource) => boolean;
  canEdit: (resource: Resource) => boolean;
  canDelete: (resource: Resource) => boolean;
  user: User | null;
  tenantId: string | null;
}

export function useAccessControl(): UseAccessControlReturn {
  const { selectedBusiness } = useBusiness();
  const { user, loading: authLoading } = useAuth();
  const businessShares = useBusinessShares();
  const businessTenants = useTenants(selectedBusiness?.id);

  // 1. Get the shared roles for this business and user from local-lite business_shares
  const shareRoles = useMemo(() => {
    if (authLoading || !selectedBusiness || !user?.email) return [] as string[];
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

  // 2. Get the tenant ID for this user reactively from SQLite / local-lite
  const tenantId = useMemo(() => {
    if (authLoading || !selectedBusiness || !user?.email) return null;
    const userEmail = user.email.toLowerCase();
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

  const evaluator = useMemo(() => {
    return accessEngine.buildEvaluator(uniqueRoles, isOwner);
  }, [uniqueRoles, isOwner]);

  return useMemo(() => {
    const isAdmin = isOwner || evaluator.hasRole('admin');
    const isStaff = evaluator.hasRole('staff');
    const isTenant = evaluator.hasRole('tenant');
    const isAdminOrStaff = isAdmin || isStaff;
    const isTenantOnly = isTenant && !isAdmin && !isStaff;

    return {
      isOwner,
      isAdmin,
      isStaff,
      isTenant,
      isAdminOrStaff,
      isTenantOnly,
      userRoles: uniqueRoles,
      loading: authLoading,
      hasAccess: (roles: string | string[]) => evaluator.hasRole(roles as any),
      hasAllRoles: (roles: string[]) => evaluator.hasAllRoles(roles as any),
      hasOneRole: (role: string) =>
        uniqueRoles.length === 1 && uniqueRoles.includes(role),
      hasRole: (role: string | string[]) => evaluator.hasRole(role as any),
      can: (action: Action, resource: Resource) => evaluator.can(action, resource),
      cannot: (action: Action, resource: Resource) => evaluator.cannot(action, resource),
      canCreate: (resource: Resource) => evaluator.can('create', resource),
      canView: (resource: Resource) => evaluator.can('view', resource),
      canEdit: (resource: Resource) => evaluator.can('edit', resource),
      canDelete: (resource: Resource) => evaluator.can('delete', resource),
      user: user || null,
      tenantId,
    };
  }, [authLoading, isOwner, evaluator, uniqueRoles, user, tenantId]);
}
