export const CORE_TABLES = [
  'businesses',
  'business_shares',
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
  'profiles',
] as const;

export type CoreTableName = (typeof CORE_TABLES)[number];

export const SYNC_TABLES = [
  // Core business entity collections
  'properties',
  'houses',
  'tenants',
  'contracts',
  'receipts',
  'expenses',

  // Global / User-level collections
  'businesses',
  'business_shares',
  'profiles',

  // Secondary collections
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

export type SyncTableName = (typeof SYNC_TABLES)[number];

export const BUSINESS_COLLECTIONS = [
  'properties',
  'houses',
  'tenants',
  'contracts',
  'receipts',
  'payment_messages',
  'payment_message_receipts',
  'expenses',
  'bookings',
  'settings',
  'reminder_logs',
  'receipt_refunds',
  'schedules',
  'backup_logs',
  'maintenance_requests',
  'promotions',
  'message_templates',
  'api_keys',
  'gallery_images',
  'transactions',
] as const;
