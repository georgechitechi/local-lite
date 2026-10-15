import { LocalFirstClient } from '../core/client.js';
import { DefaultNetworkStatusProvider } from '../adapters/network/index.js';
import { LocalLiteConfig } from './types.js';
import { resolveLocalAdapter } from './resolve-local.js';
import { resolveRemoteAdapter } from './resolve-remote.js';

// Export all config types
export * from './types.js';

// Export adapter resolvers
export { resolveLocalAdapter } from './resolve-local.js';
export { resolveRemoteAdapter } from './resolve-remote.js';

// Re-export adapters and core client for convenience
export { LocalFirstClient } from '../core/client.js';
export { ExpoSQLiteAdapter } from '../adapters/local/expo-sqlite.js';
export { OpSQLiteAdapter } from '../adapters/local/op-sqlite.js';
export { BetterSQLite3Adapter } from '../adapters/local/better-sqlite3.js';
export { LibSQLAdapter } from '../adapters/local/libsql.js';
export { SqlJsAdapter } from '../adapters/local/sql-js.js';
export { NodeSQLiteAdapter } from '../adapters/local/node-sqlite.js';
export { SupabaseRemoteAdapter } from '../adapters/remote/supabase.js';
export { ConvexRemoteAdapter } from '../adapters/remote/convex.js';
export { FirestoreRemoteAdapter } from '../adapters/remote/firestore.js';
export { MemoryDemoRemoteAdapter } from '../adapters/remote/demo.js';

/**
 * Type-safe configuration helper function (similar to defineConfig in Vite/Tailwind).
 */
export function defineSyncConfig(config: LocalLiteConfig): LocalLiteConfig {
  return config;
}

/**
 * Factory that instantiates, wires up, and initializes a LocalFirstClient from a LocalLiteConfig.
 */
export async function createSyncClient(config: LocalLiteConfig): Promise<LocalFirstClient> {
  // 1. Resolve Local Database Adapter
  const localAdapter = await resolveLocalAdapter(config);

  // 2. Resolve Remote Cloud Adapter
  const remoteAdapter = await resolveRemoteAdapter(config);

  // 3. Resolve Network Provider
  const network = config.network ?? new DefaultNetworkStatusProvider(true);

  const autoSchema = config.autoSchema ?? false;

  // 4. Instantiate Local-First Client
  const client = new LocalFirstClient({
    local: localAdapter,
    remote: remoteAdapter,
    network,
    primaryKey: config.primaryKey ?? 'id',
    conflictResolver: config.conflictResolver ?? 'last-write-wins',
    pushIntervalMs: config.pushIntervalMs ?? 5000,
    pullIntervalMs: config.pullIntervalMs ?? 10000,
    maxRetries: config.maxRetries ?? 5,
    retry: config.retry,
    logger: config.logger,
    logLevel: config.logLevel,
    autoSchema,
    tables: config.tables ?? [],
    migrations: config.migrations,
    autoStart: config.autoStart,
  });

  // 5. Execute Migrations & Auto-initialize
  if (config.autoInitialize !== false) {
    await client.initialize();

  }

  return client;
}
