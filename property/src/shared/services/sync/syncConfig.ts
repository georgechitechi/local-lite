import * as SQLite from 'expo-sqlite';
import { defineSyncConfig } from 'local-lite/config';
import { DynamicSupabaseAdapter } from './dynamicRemoteAdapter';
import { CORE_TABLES } from './tables';

export const syncConfig = defineSyncConfig({
  database: async () => {
    const db = await SQLite.openDatabaseAsync('property_admin.db');
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = NORMAL;
    `);
    return db;
  },
  tables: [...CORE_TABLES],
  autoSchema: true,
  autoInitialize: false,
  primaryKey: 'id',
  remote: new DynamicSupabaseAdapter([...CORE_TABLES]),
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
