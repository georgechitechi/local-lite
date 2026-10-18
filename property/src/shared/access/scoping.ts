import { scopeRecords } from 'native-access-control';

/**
 * Scoping utility to ensure tenants only see their own records,
 * while admins, owners, and staff see all records.
 */
export interface ScopeOptions<T> {
  tenantId?: string | null;
  isTenantOnly: boolean;
  tenantKey?: keyof T;
}

export function scopeRecordsForTenant<T>(
  records: T[],
  { tenantId, isTenantOnly, tenantKey = 'tenant_id' as keyof T }: ScopeOptions<T>,
): T[] {
  return scopeRecords(records, {
    userId: tenantId,
    isRestrictedRole: isTenantOnly,
    userKey: tenantKey,
  });
}
