import { defineSyncConfig, createSyncClient, LocalFirstClient } from 'local-lite/config';
import * as SQLite from 'expo-sqlite';
import { getConvexClient, rentalTables, syncApi } from './convex';

export function createRentalSyncConfig() {
  return defineSyncConfig({
    database: () => SQLite.openDatabaseAsync('rental_property_convex.db'),
    tables: rentalTables,
    autoSchema: true,
    convex: {
      client: getConvexClient(),
      pushMutation: syncApi.pushBatch,
      pullQuery: syncApi.pullDeltas,
    },
    conflictResolver: 'last-write-wins',
    pushIntervalMs: 3000,
    pullIntervalMs: 6000,
  });
}
let clientPromise: Promise<LocalFirstClient> | null = null;
export async function getSyncClient(): Promise<LocalFirstClient> {
  if (!clientPromise) {
    clientPromise = createSyncClient(createRentalSyncConfig()).catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}
