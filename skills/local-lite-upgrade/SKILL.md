---
name: local-lite-upgrade
description: Review a codebase that uses the local-lite npm package for code that must change after a local-lite upgrade. Use when upgrading local-lite, fixing errors about the removed `migrations` option, `fileSystem` in ExpoFileDriver, custom RemoteDBAdapter implementations, or `_migrations` table handling.
---

# local-lite upgrade review

1. Read `node_modules/local-lite/docs/breaking-changes.md` (or `docs/breaking-changes.md` in the local-lite repo). It lists each breaking change with migration code and a review checklist.
2. Search the user's code, config, tests and examples for every affected API listed there:
   - `migrations` option passed to `createSyncClient()` / `LocalFirstClient` (use `schemaMigrations`)
   - `ExpoFileDriver` with a `fileSystem` option or legacy `expo-file-system` APIs
   - custom `RemoteDBAdapter` whose `subscribeToLiveChanges` does not return an unsubscribe function
   - reliance on FTS tokenizer fallback
   - code treating `_migrations` as an internal table
3. Report each match with file and line, whether it needs a change, and a minimal migration.
4. Do not edit files unless the user asks. Ignore unrelated uses of the same words.
