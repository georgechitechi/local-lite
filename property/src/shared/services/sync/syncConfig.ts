import * as SQLite from 'expo-sqlite';
import { SupabaseRemoteAdapter } from 'local-lite';
import { defineSyncConfig } from 'local-lite/config';
import { supabase } from '@/shared/services/supabase';
import { CORE_TABLES } from './tables';

export const syncConfig = defineSyncConfig({
  database: async () => {
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
  },
  tables: [...CORE_TABLES],
  autoSchema: true,
  autoInitialize: false,
  autoStart: false,
  primaryKey: 'id',
  autoHydrateJSON: true,
  jsonColumns: {
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
  },
  remote: new SupabaseRemoteAdapter(() => supabase, {
    tables: [...CORE_TABLES],
    updatedAtColumn: 'updated_at',
    deletedColumn: 'deleted',
    deletedValue: true,
    primaryKey: 'id',
  }),
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
