import { AccessControl } from 'accesscontrol';
import type { Action } from '@/shared/hooks/useAccessControl';

export const ac = new AccessControl();

// Admin has all permissions on everything by default (we can also handle admin bypass in the hook)
ac.grant('admin')
  .createAny('tenant')
  .readAny('tenant')
  .updateAny('tenant')
  .deleteAny('tenant')
  .createAny('property')
  .readAny('property')
  .updateAny('property')
  .deleteAny('property')
  .createAny('house')
  .readAny('house')
  .updateAny('house')
  .deleteAny('house')
  .createAny('contract')
  .readAny('contract')
  .updateAny('contract')
  .deleteAny('contract')
  .createAny('receipt')
  .readAny('receipt')
  .updateAny('receipt')
  .deleteAny('receipt')
  .createAny('maintenance')
  .readAny('maintenance')
  .updateAny('maintenance')
  .deleteAny('maintenance')
  .createAny('expense')
  .readAny('expense')
  .updateAny('expense')
  .deleteAny('expense')
  .createAny('report')
  .readAny('report')
  .updateAny('report')
  .deleteAny('report')
  .createAny('booking')
  .readAny('booking')
  .updateAny('booking')
  .deleteAny('booking')
  .createAny('transaction')
  .readAny('transaction')
  .updateAny('transaction')
  .deleteAny('transaction');

// Staff permissions
ac.grant('staff')
  .readAny('tenant')
  .readAny('property')
  .readAny('house')
  .readAny('contract')
  .readAny('receipt')
  .createAny('maintenance')
  .readAny('maintenance')
  .updateAny('maintenance')
  .createAny('expense')
  .readAny('expense')
  .updateAny('expense')
  .readAny('report')
  .updateAny('report')
  .readAny('booking')
  .readAny('transaction');

// Tenant permissions
ac.grant('tenant')
  .readOwn('tenant')
  .readOwn('contract')
  .readOwn('receipt')
  .createOwn('maintenance')
  .readOwn('maintenance')
  .readOwn('transaction');

/**
 * Helper to map custom actions ('view', 'edit') to standard CRUD operations.
 */
export function mapActionToCrud(action: Action): 'create' | 'read' | 'update' | 'delete' {
  switch (action) {
    case 'view':
      return 'read';
    case 'edit':
      return 'update';
    case 'create':
      return 'create';
    case 'delete':
      return 'delete';
    default:
      return 'read';
  }
}
