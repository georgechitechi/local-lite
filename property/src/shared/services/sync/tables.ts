/**
 * Global / user-level tables that are not scoped to a specific business.
 */
export const GLOBAL_TABLES = ['businesses', 'business_shares', 'profiles'] as const;

/**
 * Business-scoped tables that belong to a specific business partition.
 */
export const BUSINESS_COLLECTIONS = [
  'properties',
  'houses',
  'tenants',
  'contracts',
  'receipts',
  'expenses',
  'settings',
  'maintenance_requests',
  'payment_messages',
  'payment_message_receipts',
  'bookings',
  'promotions',
  'message_templates',
  'schedules',
  'reminder_logs',
  'receipt_refunds',
  'backup_logs',
  'api_keys',
  'gallery_images',
  'transactions',
] as const;

/**
 * Complete list of all synchronized tables across the application.
 */
export const CORE_TABLES = [...GLOBAL_TABLES, ...BUSINESS_COLLECTIONS] as const;
export type GlobalTableName = (typeof GLOBAL_TABLES)[number];
export type BusinessTableName = (typeof BUSINESS_COLLECTIONS)[number];
export type CoreTableName = (typeof CORE_TABLES)[number];
