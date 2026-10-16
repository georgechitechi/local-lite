import { DefaultNetworkStatusProvider, LocalFirstClient } from 'local-lite/core';
import { ExpoSQLiteAdapter } from 'local-lite/expo-sqlite';
import * as SQLite from 'expo-sqlite';
import { getConvexRemote, rentalTables } from './convex';

export const syncNetwork = new DefaultNetworkStatusProvider(true);
let clientPromise: Promise<LocalFirstClient> | null = null;

async function createRentalClient(): Promise<LocalFirstClient> {
  const remote = getConvexRemote();
  const database = await SQLite.openDatabaseAsync('rental_property_convex.db');
  const client = new LocalFirstClient({
    local: new ExpoSQLiteAdapter(database),
    remote,
    network: syncNetwork,
    tables: rentalTables,
    autoSchema: true,
    conflictResolver: 'last-write-wins',
    pushIntervalMs: 3000,
    pullIntervalMs: 6000,
  });
  await client.initialize();
  return client;
}

export async function getSyncClient(): Promise<LocalFirstClient> {
  if (!clientPromise) {
    clientPromise = createRentalClient().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}
