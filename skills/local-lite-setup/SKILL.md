---
name: local-lite-setup
description: Set up the local-lite local-first SQLite sync engine in a React / React Native / Expo / Node app. Use when adding local-lite, writing a sync config with defineSyncConfig, schemaMigrations, choosing a remote backend (Supabase, Convex, Firestore, demo), or wiring useLiveQuery and useSyncStatus.
---

# local-lite setup

Read `node_modules/local-lite/README.md` and the docs (`docs/getting-started.md`, `docs/configuration.md`, `docs/adapters-remote.md` in the repo) if available. Then:

1. **Install** `local-lite`, a SQLite driver (`expo-sqlite` for Expo/RN, or a Node SQLite driver for Node/Electron), and one backend SDK (`@supabase/supabase-js`, `convex`, or `firebase`). Ask which platform and backend if unclear.
2. **Create `sync.config.ts`** using `defineSyncConfig` and `createSyncClient` from `local-lite/config`:
   - `database`: instance or factory, e.g. `() => SQLite.openDatabaseAsync('app.db')`
   - `tables`: array of synced table names
   - `schemaMigrations`: ordered `{ version, up: [sql...] }`. Each synced table needs `id TEXT PRIMARY KEY` and `updated_at INTEGER NOT NULL`. Never edit an applied migration; append a new version.
   - one remote config (`supabase`, `convex`, `firestore`, or demo) with credentials from env vars
   - optional `conflictResolver: 'last-write-wins'`, `pushIntervalMs`, `pullIntervalMs`
   - export a singleton `getSyncClient()` that caches the `createSyncClient(syncConfig)` promise
3. **Backend schema**: follow the matching section of `docs/adapters-remote.md` (Postgres SQL, Convex schema and sync functions, or Firestore setup) so server tables match.
4. **UI**: use `useLiveQuery` and `useSyncStatus` from `local-lite/react`; generate IDs with `generateUUID` from `local-lite`.
5. **Do not** use the removed `migrations` option (use `schemaMigrations`) and do not pass `fileSystem` to `ExpoFileDriver`. See `docs/breaking-changes.md`.
6. Verify the app type-checks and completes a first sync against the demo backend before switching to a real one.
