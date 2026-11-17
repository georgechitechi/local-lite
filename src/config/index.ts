import { LocalFirstClient } from '../core/client.js';
import { DefaultNetworkStatusProvider } from '../adapters/network/index.js';
import { createEmailHandler } from '../email/index.js';
import { LocalLiteConfig } from './types.js';
import { resolveLocalAdapter } from './resolve-local.js';
import { resolveRemoteAdapter } from './resolve-remote.js';

// Export all config types
export * from './types.js';

// Export adapter resolvers
export { resolveLocalAdapter } from './resolve-local.js';
export { resolveRemoteAdapter } from './resolve-remote.js';

/**
 * Type-safe configuration helper function (similar to defineConfig in Vite/Tailwind).
 */
export function defineSyncConfig(config: LocalLiteConfig): LocalLiteConfig {
  return config;
}

/**
 * Factory that instantiates, wires up, and initializes a LocalFirstClient from a LocalLiteConfig.
 */
export async function createSyncClient(
  config: LocalLiteConfig,
): Promise<LocalFirstClient> {
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
    requestTimeoutMs: config.requestTimeoutMs,
    retry: config.retry,
    logger: config.logger,
    logLevel: config.logLevel,
    autoSchema,
    tables: config.tables ?? [],
    relationships: config.relationships ?? [],
    schemaMigrations: config.schemaMigrations,
    autoStart: config.autoStart,
    jsonColumns: config.jsonColumns,
    syncScope: config.syncScope,
    autoPauseOnBackground: config.autoPauseOnBackground,
    touchUpdatedAt: config.touchUpdatedAt,
    auth: config.auth,
  });

  // 5. Execute Migrations & Auto-initialize
  if (config.autoInitialize !== false) {
    await client.initialize();
  }

  // 6. Direct Email Dispatch (Nodemailer, Resend, SendGrid, Postmark, HTTP, etc.)
  if (config.email) {
    if (config.email.transport || config.email.provider === 'nodemailer') {
      throw new Error(
        "Nodemailer email delivery is server-only. Import 'local-lite/server' and register createNodemailerHandler from your server runtime.",
      );
    }
    const emailHandler = createEmailHandler({
      provider: config.email.provider,
      transport: config.email.transport,
      apiKey: config.email.apiKey,
      endpoint: config.email.endpoint,
      headers: config.email.headers,
      defaultFrom: config.email.defaults?.from,
      defaults: config.email.defaults,
      ...config.email.options,
    });
    client.actions.registerEmailHandler(emailHandler);
  }

  return client;
}
