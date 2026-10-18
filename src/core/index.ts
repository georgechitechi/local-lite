// Provider-independent entry point: no config resolvers, UI, or backend implementations.
export * from './client.js';
export * from './types.js';
export * from './query.js';
export * from './sync-worker.js';
export * from './conflict.js';
export * from './outbox-store.js';
export * from './meta-store.js';
export * from './table-manager.js';
export * from './schema-manager.js';
export * from './query-builder.js';
export * from '../reactive/event-emitter.js';
export * from '../adapters/network/index.js';
export type { LocalDBAdapter, LocalTransaction } from '../adapters/local/index.js';
export type { RemoteDBAdapter } from '../adapters/remote/index.js';
export * from '../utils/logger.js';
