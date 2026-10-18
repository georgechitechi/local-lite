import type { Action, AppRole, Permission, Resource } from './types';

/**
 * Declarative Capability Matrix
 * Maps each role directly to its granted permissions.
 */
export const ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  owner: ['*'],
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

/**
 * Evaluates whether a set of roles grants a specific action on a resource.
 */
export function evaluatePermission(
  roles: string[],
  action: Action,
  resource: Resource,
  isOwner = false,
): boolean {
  // Business owner always bypasses all restrictions
  if (isOwner) return true;

  // Normalize role list
  const normalizedRoles = roles.map(r => r.trim().toLowerCase());

  // Admin bypass
  if (normalizedRoles.includes('admin') || normalizedRoles.includes('owner')) {
    return true;
  }

  const directKey: Permission = `${resource}:${action}`;
  const wildcardKey: Permission = `${resource}:*`;

  return normalizedRoles.some(role => {
    const permissions = ROLE_PERMISSIONS[role as AppRole];
    if (!permissions) return false;

    return (
      permissions.includes('*') ||
      permissions.includes(wildcardKey) ||
      permissions.includes(directKey)
    );
  });
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
