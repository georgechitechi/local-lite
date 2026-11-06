import * as SQLite from 'expo-sqlite';
import { defineSyncConfig, createSyncClient, type LocalFirstClient } from 'local-lite/config';

let clientPromise: Promise<LocalFirstClient> | null = null;

export const syncConfig = defineSyncConfig({
  database: () => SQLite.openDatabaseAsync('local_auth_example.db'),
  localOnly: true,
  autoSchema: true,
  localAuth: {
    minPasswordLength: 6,
    maxFailedAttempts: 3,
    lockoutDurationMs: 30 * 1000, // 30s for fast interactive testing
  },
});

export function getClient(): Promise<LocalFirstClient> {
  if (!clientPromise) {
    clientPromise = createSyncClient(syncConfig);
  }
  return clientPromise;
}

