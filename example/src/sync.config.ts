import { defineSyncConfig, createSyncClient, LocalFirstClient } from 'local-lite/config';
import * as SQLite from 'expo-sqlite';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Rental Property Management local-lite Configuration
 *
 * Connected directly to Supabase cloud with Realtime replication enabled.
 */
export const syncConfig = defineSyncConfig({
  // Open local SQLite database
  database: () => SQLite.openDatabaseAsync('rental_property_manager.db'),

  // Tables synchronized bidirectionally between SQLite and Supabase
  tables: ['properties', 'tenants', 'maintenance_requests', 'payments'],

  // Dynamic schema management: tables and columns are created on the fly in SQLite
  autoSchema: true,

  // Supabase backend configuration
  supabase: {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    updatedAtColumn: 'updated_at',
    deletedColumn: 'deleted',
    deletedValue: true,
    channelName: 'rental_property_sync',
  },

  // Disable in-memory mock remote: syncs with live Supabase cloud
  inMemoryRemote: false,

  // Conflict resolution strategy: latest write wins
  conflictResolver: 'last-write-wins',

  // Sync intervals
  pushIntervalMs: 3000,
  pullIntervalMs: 6000,
});

let clientPromise: Promise<LocalFirstClient> | null = null;

export function getSyncClient(): Promise<LocalFirstClient> {
  if (!clientPromise) {
    console.log(`Initializing client with Supabase...`);
    clientPromise = createSyncClient(syncConfig);
  }
  return clientPromise;
}
