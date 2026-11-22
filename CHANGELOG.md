# Changelog

All notable changes to `local-lite` are documented in this file.

## [3.2.0] - 2026-11-22

### Changed
- **100% Universal Core & Server:**
  - Changed `SqlServerSyncStorage` default `scopeField` from `'business_id'` to `'scope_id'` and `createSyncEventsHandler` default `scopeQueryParam` from `'businessId'` to `'scopeId'`.
  - Parameterized `scopeColumn` (default `'scope_id'`) in `src/schema/generator.ts` and `src/schema/sqlMigrations.ts`, and replaced `includeBusinessSyncIndexes` with `includeScopeSyncIndexes`.
  - Removed hardcoded app-specific RPC routes (`business-access/*`, `contracts/*`, `tenant-self-service`, `payments/stk`) from `SelfHostedRemoteAdapter.call()`.

## [3.1.1] - 2026-11-22

### Changed
- **Universal Payments (`local-lite/payments` & `local-lite/payments/server`):**
  - Replaced region-specific `createDarajaAdapter` and `formatKenyanPhone` with the generic `createPaymentAdapter(options)` factory supporting both offline/manual recording and custom online/regional providers.
  - Removed domain-specific `businessId`, `tenantId`, `contractId`, and `merchantRequestId` columns from `PaymentInitiateInput`, `PaymentReservationRecord`, `PaymentWebhookResult`, and `createSqlPaymentStore`.
- **Documentation & Tooling:**
  - Added [docs/payments.md](./docs/payments.md) with `createPaymentAdapter()` and custom Daraja integration examples.
  - Added `EADDRINUSE` port fallback and single-line logging in `scripts/serve-docs.mjs`.
  - Fixed `||` -> `??` defaults on zero-capable numeric options in `src/actions/store.ts` and `src/core/sync-worker.ts`.
  - Removed `@arethetypeswrong/cli` from `devDependencies` (ESM-only `publint` + `package-smoke.mjs` cover export verification).
  - Unignored `scripts/` in `.gitignore` so `scripts/build.mjs` and `scripts/serve-docs.mjs` are tracked in Git.

## [3.1.0] - 2026-11-22

### Changed
- **ESM-only & Node 24+:** Switched package to native ESM (`"type": "module"`, `"sideEffects": false`) with `"engines": { "node": ">=24.0.0" }`.
- **Removed Dashboard:** Removed `createDashboardHandler` (`local-lite/server`) and `local-lite dashboard` / `local-lite dev` CLI commands.
- **Stricter TypeScript Defaults:** Replaced `any` defaults with `Record<string, unknown>` / `unknown` across live-query hooks, `useSearch`, `useSession`, `useKVStore`, `useSyncStatus`, `PostgresExecutor`, `FieldEncryptor`, and `AuditEntry`.
- **CI & Quality Gate:** Added `node-code-cleaner` lint/format/circular-dependency gate, `publint`, and cross-platform CI matrix (Ubuntu, Windows, macOS on Node 24).

## [3.0.0]

- Subpath-only feature and adapter exports across `local-lite/<subpath>`.
- Firebase Modular SDK v11+ only (compat/v8 removed).
- Strict `PushResult` return type on `RemoteDBAdapter.pushChanges()`.
- Canonical `AuthUser` identity (`id`, `name`, `avatarUrl`).
- See [docs/breaking-changes.md](./docs/breaking-changes.md) for full upgrade details.
