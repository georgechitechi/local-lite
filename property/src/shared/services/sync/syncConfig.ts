import * as SQLite from 'expo-sqlite';
import { defineSyncConfig } from 'local-lite/config';
import { supabase } from '@/shared/services/supabase';
import { BUSINESS_COLLECTIONS, CORE_TABLES, type CoreTableName } from './tables';

/**
 * Opens SQLite with performance-tuned PRAGMAs for mobile local-first persistence.
 */
async function openPropertyDatabase() {
  const db = await SQLite.openDatabaseAsync('property_admin.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
    PRAGMA cache_size = -64000;
    PRAGMA temp_store = MEMORY;
    PRAGMA mmap_size = 268435456;
  `);
  return db;
}

/**
 * Additional non-metadata JSON columns per table.
 */
const EXTRA_JSON_COLUMNS: Partial<Record<CoreTableName, string[]>> = {
  api_keys: ['scopes'],
  backup_logs: ['error_details'],
  bookings: ['documents', 'next_of_kin', 'payment_details'],
  houses: ['amenities'],
  receipts: ['payment_period'],
  schedules: ['emails', 'schedule'],
  settings: ['setting_value'],
  tenants: ['next_of_kin'],
  transactions: ['raw_payload'],
};

/**
 * Tables that do not contain a 'metadata' JSON column in Supabase schema.
 */
const TABLES_WITHOUT_METADATA = new Set<CoreTableName>([
  'payment_message_receipts',
  'backup_logs',
  'gallery_images',
  'transactions',
]);

/**
 * Automatically builds the JSON columns map:
 * - Every table that has a `metadata` column automatically includes 'metadata'.
 * - Any table with extra JSON columns merges them in.
 */
const JSON_COLUMNS: Partial<Record<CoreTableName, string[]>> = Object.fromEntries(
  CORE_TABLES.map(table => {
    const cols: string[] = [];
    if (!TABLES_WITHOUT_METADATA.has(table)) {
      cols.push('metadata');
    }
    const extra = EXTRA_JSON_COLUMNS[table];
    if (extra) {
      cols.push(...extra);
    }
    return [table, cols];
  }).filter(([, cols]) => cols.length > 0),
);

export const syncConfig = defineSyncConfig({
  database: openPropertyDatabase,
  tables: [...CORE_TABLES],
  autoSchema: true,
  autoInitialize: false,
  autoStart: false,
  autoHydrateJSON: true,
  jsonColumns: JSON_COLUMNS,
  supabase: {
    client: () => supabase,
    scopedTables: [...BUSINESS_COLLECTIONS],
  },
  conflictResolver: 'last-write-wins',
  pushIntervalMs: 10000,
  pullIntervalMs: 60000,
  retry: {
    maxRetries: 5,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 1.5,
    jitter: true,
  },
});
