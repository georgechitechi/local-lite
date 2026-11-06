---
name: local-lite-upgrade
description: Review a codebase that uses the local-lite npm package for code that must change after a local-lite upgrade. Use when upgrading local-lite, migrating from legacy options, fixing bundler errors in Metro/Web, or updating authentication and adapters.
---

# local-lite upgrade review

Checklist and automated review instructions for upgrading apps to the latest version of `local-lite`.

## 1. Upgrade Checklist

Search the codebase for each affected pattern and apply the migration:

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

---

## 2. Review Workflow

1. Scan `sync.config.ts` (or client creation files) for deprecated options (`migrations`, legacy adapters).
2. Verify all synced tables contain `id TEXT PRIMARY KEY` and `updated_at INTEGER NOT NULL`.
3. Verify `schemaMigrations` versions are strictly sequential integers starting from 1.
4. Report each match with file path and line number alongside minimal migration code.
