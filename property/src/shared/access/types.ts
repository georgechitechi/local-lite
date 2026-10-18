export type AppRole = 'owner' | 'admin' | 'staff' | 'tenant';

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
  | 'transaction'
  | 'settings'
  | 'business';

export type Action = 'create' | 'view' | 'edit' | 'delete' | 'refund' | 'manage';

export type AppPermission = `${Resource}:${Action}` | `${Resource}:*` | '*';
export type { Permission } from 'native-access-control';

export interface AccessControlState {
  isOwner: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  isTenant: boolean;
  isAdminOrStaff: boolean;
  isTenantOnly: boolean;
  userRoles: string[];
  tenantId: string | null;
  loading: boolean;
}
