import { LocalFirstClient } from '../core/client.js';
import { LocalDBAdapter } from '../adapters/local/index.js';
import { ExpoSQLiteAdapter } from '../adapters/local/expo-sqlite.js';
import { RemoteDBAdapter } from '../adapters/remote/index.js';
import { SupabaseRemoteAdapter } from '../adapters/remote/supabase.js';
import { MemoryDemoRemoteAdapter } from '../adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../adapters/network/index.js';
import { ConflictResolver, ConflictStrategy, NetworkStatusProvider } from '../core/types.js';
import { createClient } from '@supabase/supabase-js';

export interface SupabaseConfigOptions {
  url?: string;
  anonKey?: string;
  client?: any;
  schema?: string;
  updatedAtColumn?: string;
  deletedAtColumn?: string;
  pushRpcName?: string;
  channelName?: string;
}

export interface OutboxSyncConfig {
  /**
   * Local SQLite Database instance, name, factory function, or LocalDBAdapter.
   * - Pass an Expo database instance (e.g. from SQLite.openDatabaseAsync('app.db'))
   * - Pass a factory: () => SQLite.openDatabaseAsync('app.db')
   * - Pass a database file name: 'app.db'
   * - Or a custom LocalDBAdapter
   */
  database?: any | string | (() => Promise<any> | any) | LocalDBAdapter;

  /**
   * Database name if database is not provided. Default: 'outbox_sync.db'
   */
  databaseName?: string;

  /**
   * List of tables to sync.
   * e.g. ['todos', 'notes']
   */
  tables?: string[];

  /**
   * Initial SQL table schema migration queries to execute on startup.
   * e.g. ["CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, title TEXT);"]
   */
  migrations?: string[];

  /**
   * Primary key column. Default: 'id'
   */
  primaryKey?: string;

  /**
   * Supabase backend connection options.
   */
  supabase?: SupabaseConfigOptions;

  /**
   * Custom remote adapter (overrides Supabase).
   */
  remote?: RemoteDBAdapter;

  /**
   * Whether to fallback to MemoryDemoRemoteAdapter if Supabase credentials are not provided.
   * Default: true
   */
  demoFallback?: boolean;

  /**
   * Conflict resolution strategy. Default: 'last-write-wins'
   */
  conflictResolver?: ConflictStrategy | ConflictResolver;

  /**
   * Periodic outbox push interval in ms. Default: 5000
   */
  pushIntervalMs?: number;

  /**
   * Periodic remote pull interval in ms. Default: 10000
   */
  pullIntervalMs?: number;

  /**
   * Maximum retry attempts for failed push items. Default: 5
   */
  maxRetries?: number;

  /**
   * Network status provider. Default: DefaultNetworkStatusProvider
   */
  network?: NetworkStatusProvider;

  /**
   * Automatically call client.initialize() and create tables.
   * Default: true
   */
  autoInitialize?: boolean;
}

/**
 * Type-safe configuration helper function (similar to defineConfig in Vite/Tailwind).
 */
export function defineSyncConfig(config: OutboxSyncConfig): OutboxSyncConfig {
  return config;
}

/**
 * Factory that instantiates and initializes a LocalFirstClient from an OutboxSyncConfig.
 */
export async function createSyncClient(config: OutboxSyncConfig): Promise<LocalFirstClient> {
  // 1. Resolve Local Database Adapter
  let localAdapter: LocalDBAdapter;

  let rawDb = config.database;
  if (typeof rawDb === 'function') {
    rawDb = await rawDb();
  }

  if (rawDb && typeof rawDb.execute === 'function' && typeof rawDb.transaction === 'function') {
    // Already implements LocalDBAdapter
    localAdapter = rawDb;
  } else if (rawDb && typeof rawDb.getAllAsync === 'function') {
    // Expo SQLite database instance
    localAdapter = new ExpoSQLiteAdapter(rawDb);
  } else if (typeof rawDb === 'string' || config.databaseName) {
    const dbName = typeof rawDb === 'string' ? rawDb : (config.databaseName ?? 'outbox_sync.db');
    try {
      const expoSqlite: any = await import('expo-sqlite');
      if (expoSqlite && typeof expoSqlite.openDatabaseAsync === 'function') {
        const expoDb = await expoSqlite.openDatabaseAsync(dbName);
        localAdapter = new ExpoSQLiteAdapter(expoDb);
      } else {
        throw new Error('expo-sqlite openDatabaseAsync not found');
      }
    } catch (err) {
      throw new Error(
        `Failed to auto-open SQLite database "${dbName}". ` +
        `Please pass the database instance to config.database: ${err}`
      );
    }
  } else {
    throw new Error(
      'No database provided in sync config. Please specify config.database or config.databaseName.'
    );
  }

  // 2. Resolve Remote Adapter
  let remoteAdapter: RemoteDBAdapter;

  if (config.remote) {
    remoteAdapter = config.remote;
  } else if (config.supabase?.client) {
    remoteAdapter = new SupabaseRemoteAdapter(config.supabase.client, {
      tables: config.tables,
      primaryKey: config.primaryKey,
      schema: config.supabase.schema,
      updatedAtColumn: config.supabase.updatedAtColumn,
      deletedAtColumn: config.supabase.deletedAtColumn,
      pushRpcName: config.supabase.pushRpcName,
      channelName: config.supabase.channelName,
    });
  } else if (config.supabase?.url && config.supabase?.anonKey) {
    const supabaseClient = createClient(config.supabase.url, config.supabase.anonKey);
    remoteAdapter = new SupabaseRemoteAdapter(supabaseClient, {
      tables: config.tables,
      primaryKey: config.primaryKey,
      schema: config.supabase.schema,
      updatedAtColumn: config.supabase.updatedAtColumn,
      deletedAtColumn: config.supabase.deletedAtColumn,
      pushRpcName: config.supabase.pushRpcName,
      channelName: config.supabase.channelName,
    });
  } else if (config.demoFallback !== false) {
    remoteAdapter = new MemoryDemoRemoteAdapter(300);
  } else {
    throw new Error(
      'No remote adapter configured. Please specify config.supabase or config.remote.'
    );
  }

  // 3. Resolve Network Provider
  const network = config.network ?? new DefaultNetworkStatusProvider(true);

  // 4. Create Client
  const client = new LocalFirstClient({
    local: localAdapter,
    remote: remoteAdapter,
    network,
    primaryKey: config.primaryKey ?? 'id',
    conflictResolver: config.conflictResolver ?? 'last-write-wins',
    pushIntervalMs: config.pushIntervalMs ?? 5000,
    pullIntervalMs: config.pullIntervalMs ?? 10000,
    maxRetries: config.maxRetries ?? 5,
  });

  // 5. Execute Migrations & Auto-initialize
  if (config.autoInitialize !== false) {
    await client.initialize();

    if (config.migrations && config.migrations.length > 0) {
      for (const query of config.migrations) {
        if (query && query.trim()) {
          await client.db.execute(query);
        }
      }
    }
  }

  return client;
}
