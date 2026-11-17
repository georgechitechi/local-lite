// v3.0.0 root entry point: core engine, config factory, schema utilities, and shared helpers.
// Provider adapters (supabase, convex, firebase, postgres, sqlite), React/Vue/Svelte/Solid hooks,
// and feature modules (auth, backups, storage, search, kv-store, scheduler, actions, keys, payments, testing, presence)
// are imported via their dedicated subpath exports (e.g. 'local-lite/react', 'local-lite/supabase').
export * from './core/index.js';
export * from './config/index.js';
export * from './schema/index.js';
export * from './utils/uuid.js';
export * from './utils/sql.js';
export * from './utils/portability.js';
