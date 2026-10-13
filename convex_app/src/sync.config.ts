import { defineSyncConfig, createSyncClient, LocalFirstClient } from 'local-lite/config';
import * as SQLite from 'expo-sqlite';
import { ConvexClient } from 'convex/browser';

export const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL || '';

export const syncConfig = defineSyncConfig({
  database: () => SQLite.openDatabaseAsync('convex_local_first.db'),
  tables: ['tasks', 'notes'],
  autoSchema: true,
  primaryKey: 'id',

  convex: {
    client: new ConvexClient(CONVEX_URL),
    pushMutation: 'sync:pushBatch',
    pullQuery: 'sync:pullDeltas',
  },
  inMemoryRemote: false,

  conflictResolver: 'last-write-wins',
  pushIntervalMs: 2500,
  pullIntervalMs: 5000,
  retry: {
    maxRetries: Infinity,
    initialDelayMs: 1000,
    backoffMultiplier: 1.5,
  },
  logLevel: 'info',
});

let clientPromise: Promise<LocalFirstClient> | null = null;

export function getSyncClient(): Promise<LocalFirstClient> {
  if (!clientPromise) {
    clientPromise = createSyncClient(syncConfig);
  }
  return clientPromise;
}
