import { createAccessControl } from 'native-access-control';
import type { Action, AppRole, Resource } from './types';

/**
 * Declarative Capability Matrix
 * Maps each role directly to its granted permissions.
 */
export const ROLE_PERMISSIONS = {
  admin: ['*'],
  staff: [
    'tenant:view',
    'property:view',
    'house:view',
    'contract:view',
    'receipt:view',
    'maintenance:create',
    'maintenance:view',
    'maintenance:edit',
    'expense:create',
    'expense:view',
    'expense:edit',
    'report:view',
    'report:edit',
    'booking:view',
    'transaction:view',
  ],
  tenant: [
    'tenant:view',
    'contract:view',
    'receipt:view',
    'maintenance:create',
    'maintenance:view',
    'transaction:view',
  ],
};

export const accessControl = createAccessControl<AppRole, Resource, Action>({
  policies: ROLE_PERMISSIONS,
  roleHierarchy: {
    admin: ['staff'],
  },
  superRoles: ['owner'],
});

export const {
  AccessProvider,
  useAccess,
  Can,
  Cannot,
  Protect,
  createRoleGuard,
  engine: accessEngine,
} = accessControl;

export const AdminOnly = createRoleGuard('admin');
export const StaffOrAdmin = createRoleGuard(['admin', 'staff']);
export const TenantOnly = createRoleGuard('tenant');

/**
 * Evaluates whether a set of roles grants a specific action on a resource.
 */
export function evaluatePermission(
  roles: string[],
  action: Action,
  resource: Resource,
  isOwner = false,
): boolean {
  return accessEngine.evaluate(roles, action, resource, undefined, isOwner);
}

/**
 * Determines primary role for display and badges.
 */
export function getPrimaryRole(roles: string[], isOwner = false): AppRole | 'guest' {
  if (isOwner) return 'owner';
  const normalized = roles.map(r => r.trim().toLowerCase());
  if (normalized.includes('admin')) return 'admin';
  if (normalized.includes('staff')) return 'staff';
  if (normalized.includes('tenant')) return 'tenant';
  return 'guest';
}
