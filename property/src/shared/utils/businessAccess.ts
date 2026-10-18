import { OFFLINE_USER_ID } from '@/shared/services/auth';
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

export const isActiveBusinessShare = (share: BusinessShare): boolean => {
  const status = normalizeIdentity(share.status);
  return status === 'active' || status === 'accepted';
};

/**
 * Single source of truth for business ownership check across the app.
 */
export function isBusinessOwner(
  business: { user_id?: string | null; email?: string | null } | null | undefined,
  user: { id?: string | null; email?: string | null } | null | undefined,
  offlineUserId: string = OFFLINE_USER_ID,
): boolean {
  if (!business || !user) return false;
  const bizUserId = normalizeIdentity(business.user_id);
  const userId = normalizeIdentity(user.id);
  const offlineId = normalizeIdentity(offlineUserId);
  const userEmail = normalizeIdentity(user.email);
  const bizEmail = normalizeIdentity(business.email);

  return (
    userId === offlineId ||
    (bizUserId !== '' && bizUserId === userId) ||
    (bizUserId !== '' && bizUserId === offlineId) ||
    Boolean(userEmail && bizEmail && bizEmail === userEmail)
  );
}

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
  offlineUserId: string = OFFLINE_USER_ID,
): Business[] {
  if (!user) return [];
  const email = normalizeIdentity(user.email);
  const normalizedUserId = normalizeIdentity(user.id);
  const normalizedOfflineId = normalizeIdentity(offlineUserId);

  const sharedIds = new Set(
    shares
      .filter(
        share =>
          ((email && normalizeIdentity(share.shared_with) === email) ||
            (normalizedUserId &&
              normalizeIdentity(share.user_id) === normalizedUserId)) &&
          isActiveBusinessShare(share),
      )
      .map(share => normalizeIdentity(share.business_id)),
  );

  const tenantBusinessIds = new Set(
    tenants
      .filter(tenant => email && normalizeIdentity(tenant.email) === email)
      .map(tenant => normalizeIdentity(tenant.business_id)),
  );

  return businesses.filter(business => {
    const bizId = normalizeIdentity(business.id);
    return (
      isBusinessOwner(business, user, offlineUserId) ||
      sharedIds.has(bizId) ||
      tenantBusinessIds.has(bizId)
    );
  });
}
