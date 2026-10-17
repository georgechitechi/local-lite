import * as SQLite from 'expo-sqlite';
import { defineSyncConfig } from 'local-lite/config';
import { supabase } from '@/shared/services/supabase';
import { CORE_TABLES, BUSINESS_COLLECTIONS, type CoreTableName } from './tables';

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
 * Columns automatically serialized to JSON strings on disk and parsed into objects in memory.
 */
const JSON_COLUMNS: Partial<Record<CoreTableName, string[]>> = {
  tenants: ['next_of_kin'],
  contracts: ['period', 'terms'],
  receipts: ['meta', 'period'],
  settings: ['setting_value'],
  bookings: ['next_of_kin', 'documents', 'metadata'],
  business_shares: ['roles'],
  payment_messages: ['metadata'],
  houses: ['metadata'],
  properties: ['metadata'],
  api_keys: ['metadata', 'scopes'],
};

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
