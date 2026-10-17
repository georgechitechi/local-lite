import type { Business, BusinessShare, Tenant } from '@/shared/types/types';

export const normalizeIdentity = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

export const isDeletedRecord = (row: { deleted?: unknown }): boolean =>
  row.deleted === true ||
  row.deleted === 1 ||
  normalizeIdentity(row.deleted) === 'true' ||
  row.deleted === '1';

export const isActiveBusinessShare = (share: BusinessShare): boolean =>
  !isDeletedRecord(share) && normalizeIdentity(share.status) === 'active';

/** SQLite stores array fields as JSON text. Never treat that text as a role list. */
export function parseShareRoles(value: unknown): string[] {
  try {
    const roles = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(roles)
      ? roles.filter((role): role is string => typeof role === 'string')
      : [];
  } catch {
    return [];
  }
}

export function accessibleBusinesses(
  businesses: Business[],
  shares: BusinessShare[],
  tenants: Tenant[],
  user: { id: string; email?: string } | null,
  offlineUserId: string,
): Business[] {
  if (!user) return [];
  const email = normalizeIdentity(user.email);
  const sharedIds = new Set(
    shares
      .filter(
        share =>
          email &&
          normalizeIdentity(share.shared_with) === email &&
          isActiveBusinessShare(share),
      )
      .map(share => normalizeIdentity(share.business_id)),
  );
  const tenantBusinessIds = new Set(
    tenants
      .filter(
        tenant =>
          email && !isDeletedRecord(tenant) && normalizeIdentity(tenant.email) === email,
      )
      .map(tenant => normalizeIdentity(tenant.business_id)),
  );

  return businesses.filter(
    business =>
      !isDeletedRecord(business) &&
      (business.user_id === user.id ||
        business.user_id === offlineUserId ||
        sharedIds.has(normalizeIdentity(business.id)) ||
        tenantBusinessIds.has(normalizeIdentity(business.id))),
  );
}
