---
name: local-lite-upgrade
description: Review a codebase that uses the local-lite npm package for code that must change after a local-lite upgrade. Use when upgrading local-lite, migrating from legacy options or aliases, fixing bundler errors in Metro/Web, or updating authentication, queries, and adapters.
---

# local-lite upgrade review

Checklist and automated review instructions for upgrading apps to the latest version of `local-lite`.

## 0. Upgrade Checklist (3.2.0 Changes)

* **Universal Scope Defaults (`scope_id` / `scopeId`)**:
  - `SqlServerSyncStorage` defaults `scopeField` to `'scope_id'` and `createSyncEventsHandler` defaults `scopeQueryParam` to `'scopeId'`.
  - **Action**: Pass `scopeField` / `scopeQueryParam` explicitly if your app uses `'business_id'` / `'businessId'`.
* **Schema & Migration Options (`includeScopeSyncIndexes`, `scopeColumn`)**:
  - Removed `includeBusinessSyncIndexes`; `parseSchemaIndexes()`, `generateSchemaIndexes()`, `buildSqlTargetSchema()`, and `generateSqlMigration()` now use `includeScopeSyncIndexes` and `scopeColumn` (default `'scope_id'`).
* **Universal Payments & Self-Hosted RPCs**:
  - Removed `createDarajaAdapter`, `formatKenyanPhone`, `businessId`/`tenantId`/`contractId`/`merchantRequestId`, and hardcoded rental-app routes in `SelfHostedRemoteAdapter.call()`.
  - **Action**: Use `createPaymentAdapter()` with `metadata` for custom/regional gateways.

## 0.1 Upgrade Checklist (3.1.0 Changes)

* **ESM-Only & Node 24+**:
  - `local-lite` now ships native ESM (`"type": "module"`) and requires `"node": ">=24.0.0"`.
  - **Action**: Ensure Node 24+ and ESM imports (or Node 24 `require(esm)`).
* **Removed Dashboard (`local-lite/server` & CLI)**:
  - Removed `createDashboardHandler` and the `local-lite dashboard` / `local-lite dev` CLI commands.
  - **Action**: Remove any imports of `createDashboardHandler` or scripts invoking `local-lite dashboard` / `local-lite dev`.
* **Stricter TypeScript Defaults (`unknown` / `Record<string, unknown>`)**:
  - `useLiveQuery`, `liveQuery`, `createLiveQuery`, `useSearch`, `useSession`, `useKVStore`, `PostgresQueryResult`, `PostgresExecutor`, `FieldEncryptor`, and `AuditEntry` no longer default to `any`.
  - **Action**: Pass explicit generics (e.g. `useLiveQuery<Todo>(...)`) or narrow `unknown` return values.

## 0.2 Upgrade Checklist (3.0.0 Breaking Changes)

* **Trimmed Root & Config Barrels**:
  - `'local-lite'` now exports only `core`, `config`, `schema`, and `utils` (`uuid`, `sql`, `portability`).
  - `'local-lite/config'` no longer re-exports `LocalFirstClient` or provider adapters.
  - **Action**: Move React hooks to `'local-lite/react'`, auth to `'local-lite/auth'`, feature modules (`actions`, `backups`, `keys`, `kv-store`, `search`, `storage`, `scheduler`, `payments`) to `'local-lite/<module>'`, and adapters to `'local-lite/<adapter>'`.
* **Firebase Modular SDK v11+ Only**:
  - Removed v8/compat `.collection()`, `.batch()`, `.ref()`, `.put()`, and `.save()` branches from `FirestoreRemoteAdapter` and `createFirebaseStorageUploader`.
  - **Action**: Pass modular `firebase/firestore` and `firebase/storage` (`firebase >= 11.0.0`) instances/modules.
* **Strict `RemoteDBAdapter.pushChanges(): Promise<PushResult>`**:
  - Returning `boolean` from `pushChanges()` is no longer supported.
  - **Action**: Return `{ success, successfulIds, failedIds, errors? }` from all custom remote adapters.
* **Canonical `AuthUser` Shape (`local-lite/auth`)**:
  - Removed `userId`, `displayName`, `picture`, and `UnifiedAuthUser` aliases.
  - **Action**: Replace with `id`, `name`, `avatarUrl`, and `AuthUser`.

## 1. Upgrade Checklist (2.0.0 & Legacy Migrations)

Search the codebase for each affected pattern and apply the migration:

### Removed Configuration Aliases (`localAuth`, `maxRetries`, `autoHydrateJSON`)
* **Old**: `createSyncClient({ localAuth: ..., maxRetries: 5, autoHydrateJSON: true })`
* **New**: `createSyncClient({ auth: ..., retry: 5, jsonColumns: { todos: ['meta'] } })`
* **Action**:
  - Replace `localAuth` with `auth`.
  - Replace top-level `maxRetries` on `LocalFirstClient` / `defineSyncConfig` / `SyncWorker` with `retry: number | RetryConfig`.
  - Replace `autoHydrateJSON: true` with explicit `jsonColumns` per table.

### Query Method & Operator Aliases (`find`, unprefixed operators)
* **Old**: `client.find('todos', { where: { count: { gt: 5 } } })`
* **New**: `client.findMany('todos', { where: { count: { $gt: 5 } } })`
* **Action**:
  - Replace `client.find()` / `tx.find()` with `findMany()`.
  - Prefix all `QueryOptions.where` operators with `$` (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$contains`, `$startsWith`, `$endsWith`, `$null`).
  - Note: `$contains`, `$startsWith`, and `$endsWith` now escape literal `%` and `_` characters (`LIKE ? ESCAPE '\'`).

### Demo Adapter Imports in `local-lite/config`
* **Old**: `import { MemoryDemoRemoteAdapter, NoopRemoteAdapter } from 'local-lite/config'`
* **New**: `import { MemoryDemoRemoteAdapter, NoopRemoteAdapter } from 'local-lite'` (or `'local-lite/core'`)

### Hardened Defaults & Server Storage
* **Remote Timeouts**: `SyncWorker` defaults to `requestTimeoutMs: 30000` (with `AbortSignal` forwarded to `SelfHostedRemoteAdapter`). Set `requestTimeoutMs: 0` to disable.
* **Persistent Self-Hosted Server**: Prefer `SQLiteServerSyncStorage` from `local-lite/server` over `MemoryServerSyncStorage` in production; both default to `maxChangeLogEntries: 10000`.
* **Expo SQLite**: `ExpoSQLiteAdapter` requires Expo SDK 51+ (`runAsync()` / `execAsync()`).
* **Expo SQLite**: `ExpoSQLiteAdapter` requires Expo SDK 54+ (`runAsync()` / `execAsync()`).

### Schema Migrations (`schemaMigrations` vs `migrations`)
* **Old**: `createSyncClient({ migrations: [ ... ] })`
* **New**: `createSyncClient({ schemaMigrations: [ { version: 1, up: [ ... ] } ] })`
* **Action**: `schemaMigrations` is strictly required. Each item requires `{ version: number, up: string[] }`.

### Custom Remote Adapters (`subscribeToLiveChanges`)
* **Contract**: `subscribeToLiveChanges(callback)` must return an unsubscribe cleanup function `() => void`. Returning `void` causes memory leaks and breaks lifecycle tearing.

### Expo Web & Metro Bundler Configuration
* **Symptom**: `Unable to resolve module ./wa-sqlite/wa-sqlite.wasm` or `Importing react-native internals is not supported on web`.
* **Fix**: In `metro.config.js`:
  1. Add `.wasm` to `config.resolver.assetExts.push('wasm')`.
  2. In `resolveRequest`, map `react-native` to `react-native-web` when `platform === 'web'`.
  3. Set `"output": "single"` in `app.json` under `expo.web`.

### UUID Generation
* **Old**: `import { v4 } from 'uuid';`
* **New**: `import { generateUUID } from 'local-lite';`
* **Action**: External `uuid` (v10+) references bare `crypto.randomUUID` which throws `Property 'crypto' doesn't exist` on Hermes. Use `generateUUID()` directly from `local-lite`.

### File Storage Driver (`ExpoFileDriver`)
* **Old**: Injecting `fileSystem` via legacy `expo-file-system`.
* **New**: Uses standard Expo SDK 58+ `File`, `Directory`, and `Paths` APIs. Remove legacy `fileSystem` option.

### Email Module Imports (`local-lite/nodemailer` ➔ `local-lite/email`)
* **Old**: `import { ... } from 'local-lite/nodemailer'`
* **New**: `import { ... } from 'local-lite/email'`
* **Action**: Update imports to the unified email module supporting Nodemailer, Resend, SendGrid, Postmark, and Dev Mailbox.

---

## 2. Review Workflow

1. Scan `sync.config.ts` and `LocalFirstClient` instantiations for removed options (`localAuth`, `maxRetries`, `autoHydrateJSON`, `migrations`).
2. Scan `find(` calls and `where:` objects for unprefixed operators (`eq`, `gt`, `in`, `contains`, etc.).
3. Verify `schemaMigrations` versions are strictly sequential integers starting from 1.
4. Check `expo-sqlite` mocks/instances provide `runAsync()` for parameterized writes.
5. Report each match with file path and line number alongside minimal migration code.
