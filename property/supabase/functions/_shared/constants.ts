/**
 * Common constants used across edge functions
 */

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
};

// Tables to exclude from backup/restore operations
export const EXCLUDED_TABLES = [
  'schema_migrations',
  'resumes',
  'backup_logs',
  'profiles',
];

// Columns to exclude from backup/restore operations
export const EXCLUDED_COLUMNS = ['created_at', 'updated_at'];

// Dependency-aware restore order for tables
export const TABLE_RESTORE_ORDER = [
  'businesses',
  'profiles',
  'business_shares',
  'settings',
  'properties',
  'tenants',
  'houses',
  'promotions',
  'expenses',
  'bookings',
  'contracts',
  'receipts',
  'receipt_refunds',
  'maintenance_requests',
  'payment_messages',
  'payment_message_receipts',
  'transactions',
  'tokens',
  'reminder_logs',
  'schedules',
  'backup_logs',
  'totp_secrets',
];
