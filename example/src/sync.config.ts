import { defineSyncConfig, createSyncClient, LocalFirstClient } from 'outbox-sync/config';
import * as SQLite from 'expo-sqlite';

/**
 * Basic Outbox-Sync Configuration
 *
 * All settings (local SQLite database, migrations, synced tables, and Supabase credentials)
 * are declared here in one place.
 */
export const syncConfig = defineSyncConfig({
  // Open or resolve the local SQLite database
  database: () => SQLite.openDatabaseAsync('local_first_example.db'),

  // Tables to synchronize
  tables: ['todos'],

  // Automatic schema management: tables and columns are created on the fly with zero migrations!
  autoSchema: true,

  // Supabase backend configuration (reads from env vars or strings)
  supabase: {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
    deletedColumn: 'deleted', // Uses deleted: true soft deletes
  },

  // Use in-memory simulated remote if Supabase URL is empty
  inMemoryRemote: true,

  // Conflict resolution strategy
  conflictResolver: 'last-write-wins',

  // Sync heartbeat intervals
  pushIntervalMs: 4000,
  pullIntervalMs: 8000,
});

let clientPromise: Promise<LocalFirstClient> | null = null;

export function getSyncClient(): Promise<LocalFirstClient> {
  if (!clientPromise) {
    clientPromise = createSyncClient(syncConfig);
  }
  return clientPromise;
}
