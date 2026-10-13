import { defineSyncConfig, createSyncClient, LocalFirstClient } from 'outbox-sync';
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

  // Automatic SQL schema migrations executed on startup
  migrations: [
    `CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      completed INTEGER DEFAULT 0
    );`,
  ],

  // Supabase backend configuration (reads from env vars or strings)
  supabase: {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
  },

  // Fallback to in-memory demo mock if Supabase URL is empty
  demoFallback: true,

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
