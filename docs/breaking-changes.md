# Breaking Changes and AI Code-Review Guide

This guide records breaking changes introduced in `local-lite` (`3.2.0`, `3.1.0`, `3.0.0`, and `2.0.0`) and gives
an actionable checklist for reviewing an application or repository update.
Use it when upgrading to this version or when asking an AI assistant to check
whether dependent code needs changes.

## AI review prompt

Copy this prompt into your code-review request:

> Review this codebase for required updates against
> [`docs/breaking-changes.md`](./breaking-changes.md). Search application code,
> configuration, tests, examples, and custom adapters for every affected API.
> Report each match with file and line, explain whether it needs a change, and
> suggest a minimal migration. Do not edit files unless asked. Do not treat
> unrelated uses of the same words as API usage.

This guide ships with the package at
`node_modules/local-lite/docs/breaking-changes.md`. A ready-made skill is at
`node_modules/local-lite/skills/local-lite-upgrade/SKILL.md` (setup and custom
adapter skills live beside it); copy the folders
into `.github/skills/` (Copilot) or `.claude/skills/` (Claude Code).

## Changes in 3.2.0

### 1. Universal scope defaults (`scope_id` / `scopeId`)

- `SqlServerSyncStorage` now defaults `scopeField` to `'scope_id'` (previously `'business_id'`).
- `createSyncEventsHandler` now defaults `scopeQueryParam` to `'scopeId'` (previously `'businessId'`).
- Pass `{ scopeField: 'business_id' }` or `{ scopeQueryParam: 'businessId' }` explicitly if your existing database or clients use `business_id`.

### 2. Schema generator & SQL migrations (`scopeColumn` / `includeScopeSyncIndexes`)

- Removed `includeBusinessSyncIndexes` from `GenerateSchemaIndexesOptions` and `parseSchemaIndexes()`; use `includeScopeSyncIndexes` and `scopeColumn` (default `'scope_id'`).
- `buildSqlTargetSchema()` and `generateSqlMigration()` now accept `scopeColumn` (default `'scope_id'`) for the composite `(scopeColumn, 'updated_at')` index.

### 3. Generic `SelfHostedRemoteAdapter.call()` & universal `local-lite/payments`

- Removed hardcoded rental-app RPC routes (`business-access/*`, `contracts/*`, `tenant-self-service`, `payments/stk`) from `SelfHostedRemoteAdapter.call()`; pass explicit paths or `namespace:action` names instead.
- Removed `createDarajaAdapter`, `formatKenyanPhone`, `businessId`, `tenantId`, `contractId`, and `merchantRequestId` from `local-lite/payments` and `local-lite/payments/server`. Use `createPaymentAdapter()` and `metadata` instead (see [Universal Payments](./payments.md)).

## Changes in 3.1.0

### 1. ESM-only package & Node 24+ requirement

- `local-lite` now ships native ESM (`"type": "module"`, `"sideEffects": false`) with `"engines": { "node": ">=24.0.0" }`.
- Use ESM `import` (or Node 24's native `require(esm)` for synchronous modules). Legacy CJS-only builds on Node < 24 are no longer supported.

### 2. Removed web dashboard & CLI commands

- Removed `createDashboardHandler` and `DashboardHandlerOptions` from `local-lite/server`.
- Removed `npx local-lite dashboard` and `npx local-lite dev` from the CLI (`install-skills` and `db:generate` remain).

### 3. Stricter TypeScript generic defaults (`unknown` / `Record<string, unknown>`)

- Generic defaults on `useLiveQuery`, `liveQuery`, `createLiveQuery`, `subscribeLiveQuery`, `useSearch`, `useSession`, `useKVStore`, `PostgresQueryResult`, and `PostgresExecutor` changed from `any` to `Record<string, unknown>` (or `unknown`).
- `FieldEncryptor.decryptValue()` now returns `Promise<unknown>`, `FieldEncryptor.encryptValue()` returns `Promise<string | null | undefined>`, and `AuditEntry.before` / `after` use `Record<string, unknown> | null`.
- Pass an explicit type argument (e.g., `useLiveQuery<Todo>(client, 'todos')`) or narrow `unknown` values when upgrading.

## Changes in 3.0.0

### 1. Subpath-only exports (trimmed root & config barrels)

The root `'local-lite'` entry point now exports only `core`, `config`, `schema`, and `utils` (`uuid`, `sql`, `portability`). `local-lite/config` no longer re-exports `LocalFirstClient` or provider adapter classes.

| Removed import | Replacement |
| :--- | :--- |
| `import { useLiveQuery } from 'local-lite'` | `import { useLiveQuery } from 'local-lite/react'` |
| `import { LocalAuthEngine, GoogleAuthClient } from 'local-lite'` | `import { LocalAuthEngine, GoogleAuthClient } from 'local-lite/auth'` |
| `import { ActionManager } from 'local-lite'` | `import { ActionManager } from 'local-lite/actions'` |
| `import { LocalFirstClient } from 'local-lite/config'` | `import { LocalFirstClient } from 'local-lite'` (or `'local-lite/core'`) |
| `import { SupabaseRemoteAdapter } from 'local-lite'` / `'local-lite/config'` | `import { SupabaseRemoteAdapter } from 'local-lite/supabase'` |
| `import { ExpoSQLiteAdapter } from 'local-lite'` / `'local-lite/config'` | `import { ExpoSQLiteAdapter } from 'local-lite/expo-sqlite'` |

All feature modules (`backups`, `keys`, `kv-store`, `search`, `storage`, `scheduler`, `payments`, `testing`, `presence`, `vue`, `svelte`, `solid`) must be imported from their `local-lite/<subpath>` entry point.

### 2. Firebase Modular SDK v11+ only (v8 / compat removed)

- `FirestoreRemoteAdapter` (`local-lite/firebase`) and `createFirebaseStorageUploader` (`local-lite/storage`) now require the modular `firebase/firestore` and `firebase/storage` SDKs (`firebase >= 11.0.0`).
- Compat/v8 `.collection()`, `.batch()`, `.ref()`, `.put()`, and `.save()` fallback branches have been removed.

### 3. Strict `RemoteDBAdapter.pushChanges(): Promise<PushResult>`

- `RemoteDBAdapter.pushChanges()` no longer accepts `boolean` (`true`/`false`) return values.
- All built-in and custom remote adapters must return a structured `PushResult`:
  ```ts
  { success: true, successfulIds: operations.map((op) => op.id), failedIds: [] }
  ```

### 4. Canonical `AuthUser` identity (`local-lite/auth`)

- Removed redundant compatibility aliases from `AuthUser`: `userId`, `displayName`, and `picture`. Use canonical `id`, `name`, and `avatarUrl` instead.
- Removed the `UnifiedAuthUser` type alias; use `AuthUser`.

### 5. Updated `peerDependencies` minimums

`firebase >=11.0.0`, `@supabase/supabase-js >=2.45.0`, `convex >=1.15.0`, `better-sqlite3 >=11.0.0`, `@libsql/client >=0.14.0`, `@op-engineering/op-sqlite >=10.0.0`, `sql.js >=1.10.0`.

**Review checklist (3.0.0)**

- Search for imports from `'local-lite'` or `'local-lite/config'` that reference React hooks, auth, actions/storage/search/kv-store/payments, or local/remote adapter classes, and move them to `local-lite/<subpath>`.
- Search custom `RemoteDBAdapter` implementations and tests for `pushChanges()` returning `boolean` and update them to return `PushResult`.
- Search Firebase usage for compat `.collection()` / `.batch()` / `.ref()` / `.put()` mocks or instances and migrate to modular `firebase/firestore` and `firebase/storage`.
- Search auth consumers for `user.userId`, `user.displayName`, `user.picture`, or `UnifiedAuthUser` and replace with `user.id`, `user.name`, `user.avatarUrl`, and `AuthUser`.

## Changes in 2.0.0

### 1. Removed configuration & query aliases

The following redundant aliases have been removed in favor of a single canonical API:

| Removed API | Replacement |
| :--- | :--- |
| `localAuth` config option | Use `auth` in `LocalFirstClientConfig` / `LocalLiteConfig` |
| `maxRetries` top-level config option | Use `retry: number \| RetryConfig` (e.g. `retry: 5` or `retry: { maxRetries: 5 }`) |
| `client.find()` / `tx.find()` | Use `client.findMany()` / `tx.findMany()` |
| Unprefixed query operators (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `contains`, `startsWith`, `endsWith`, `null`) | Use `$`-prefixed operators (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$contains`, `$startsWith`, `$endsWith`, `$null`) |
| `autoHydrateJSON` config option | Use explicit `jsonColumns: { tableName: ['col1', 'col2'] }` |
| `MemoryDemoRemoteAdapter` / `NoopRemoteAdapter` re-exports in `local-lite/config` | Import from `local-lite` or `local-lite/core` |
| Legacy `migrations` error guard | Removed; use `schemaMigrations` |

### 2. Expo SQLite SDK 54+ `runAsync` required for writes

`ExpoSQLiteAdapter` no longer falls back to `getAllAsync` for write statements. The injected Expo SQLite database must provide `runAsync()` (standard in Expo SDK 54+ / `expo-sqlite >= 58.0.0`).

### 3. Hardened defaults & behavioral changes

- **Remote request timeout (`requestTimeoutMs: 30000`)**: `SyncWorker` now aborts/times out `pushChanges()` and `fetchChanges()` after `30000` ms by default (`requestTimeoutMs: 0` disables it). `RemoteDBAdapter` implementations may accept an optional `{ signal?: AbortSignal }` argument.
- **SQL `LIKE` wildcard escaping**: `$contains`, `$startsWith`, and `$endsWith` now escape literal `%`, `_`, and `\` using `LIKE ? ESCAPE '\'`.
- **Server changelog retention (`maxChangeLogEntries: 10000`)**: Both `MemoryServerSyncStorage` and `SQLiteServerSyncStorage` retain the latest `10000` changelog entries by default (`Infinity` or `0` disables compaction on `SQLiteServerSyncStorage`).
- **OAuth CSPRNG requirement**: `AppleAuthClient`, `GitHubAuthClient`, `GoogleAuthClient`, and `MicrosoftAuthClient` now require `globalThis.crypto.getRandomValues` (or a custom `options.randomBytes` provider on `GoogleAuthClient` / `MicrosoftAuthClient`) when generating OAuth `state` and PKCE verifiers, instead of falling back to `Math.random()`.

**Review checklist (2.0.0)**

- Search for `localAuth`, `autoHydrateJSON`, and top-level `maxRetries` in `sync.config.ts` / `LocalFirstClient` calls.
- Search for `.find(` on `client` or `tx` instances and replace with `.findMany(`.
- Search `where:` objects for unprefixed operator keys (`eq`, `gt`, `in`, `contains`, etc.) and prefix them with `$`.
- Confirm any `expo-sqlite` mock or instance in tests implements `runAsync()`.

## Suggested review output

For each potential issue, report:

1. File and line.
2. Which change above applies.
3. Whether a code update is required or the match is unrelated.
4. The smallest safe migration.
5. Any behavior or stored-data risk that needs application-owner confirmation.
