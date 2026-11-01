# Breaking Changes and AI Code-Review Guide

This guide records breaking changes introduced in `local-lite` 0.0.30 and gives
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

For a workspace where this guide is not available in the dependency checkout,
point the assistant to the installed package's `docs/breaking-changes.md` or
provide this file directly.

## Changes in 0.0.30

### 1. Repeat-on-initialize `migrations` option removed

The `migrations: string[]` option was removed from `LocalLiteConfig` and
`LocalFirstClientConfig`. Passing it to `createSyncClient()` or the
`LocalFirstClient` constructor now throws. Use versioned `schemaMigrations`
instead.

```typescript
schemaMigrations: [
  {
    version: 1,
    up: 'CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)',
  },
  {
    version: 2,
    up: 'ALTER TABLE notes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0',
  },
],
```

**Review checklist**

- Find configuration properties named `migrations` and confirm they are the
  removed local-lite option, not another library's setting or a local variable.
- Convert SQL into consecutive, one-time `schemaMigrations` entries.
- Preserve the complete migration history in the application so existing
  installations can upgrade. Do not simply rename the array: old statements
  ran on every initialization, while versioned migrations run once.
- Update config helpers, test fixtures, and migration-related documentation.

### 2. Expo legacy FileSystem API removed

`ExpoFileDriver` now uses Expo SDK 58+ `File`, `Directory`, and `Paths`.
The `fileSystem` constructor option and legacy `expo-file-system` methods such
as `writeAsStringAsync`, `getInfoAsync`, `copyAsync`, and `downloadAsync` are no
longer supported.

```typescript
import { File, Directory, Paths } from 'expo-file-system';
import { ExpoFileDriver } from 'local-lite/storage';

const driver = new ExpoFileDriver({ File, Directory, Paths });
```

The `baseDir` and `useCache` options remain available.

**Review checklist**

- Find `new ExpoFileDriver({ fileSystem: ... })` and replace it with the modern
  named API options.
- Check Expo dependencies and runtime versions; the modern APIs require Expo
  SDK 58 or newer.
- Replace direct legacy FileSystem calls in integrations with `File` operations
  or `ExpoFileDriver` methods.
- Review tests and examples for legacy mocks or imports.

### 3. Custom realtime adapters must return cleanup

`RemoteDBAdapter.subscribeToLiveChanges()` now has the required return type
`() => void`. Every custom adapter implementation must return a function that
unsubscribes its listener. If no listener is created, return a no-op function.

```typescript
subscribeToLiveChanges(callback: (changes: DeltaChanges) => void): () => void {
  if (!this.canSubscribe()) return () => {};

  const subscription = this.startSubscription(callback);
  return () => subscription.unsubscribe();
}
```

**Review checklist**

- Find classes and object literals implementing `RemoteDBAdapter`.
- Confirm all code paths, including missing clients, empty table lists, and
  initialization failures, return a cleanup function.
- Confirm cleanup is safe to call once and prevents callbacks from a stopped or
  replaced subscription.
- Update mocks and test adapters to match the required signature.

### 4. `_migrations` is no longer an internal table name

`isInternalTable('_migrations')` now returns `false`. The name is not treated as
a local-lite engine table and may consequently appear in APIs that filter
internal tables, such as `getTables()` and maintenance reports.

**Review checklist**

- Find uses of `_migrations` as an application table or as a local-lite
  bookkeeping table.
- If an application uses this name and expects it to be hidden, rename the
  application table or filter it explicitly in the application.
- Do not rename or delete stored tables as part of an automated upgrade without
  confirming their ownership and contents.

### 5. FTS tokenizer errors now propagate

FTS table creation no longer retries without the `tokenize` option after a
tokenizer error. A configured tokenizer that the SQLite build does not support
causes search initialization to fail instead of silently creating a table with
different tokenization behavior.

**Review checklist**

- Find `client.search` configurations that set a custom tokenizer.
- Verify the target SQLite build supports the configured tokenizer and FTS5.
- Test search initialization and representative queries on every supported
  platform/build.
- Resolve an unsupported tokenizer by selecting one supported by the target
  runtime or correcting the SQLite build; do not rely on an implicit tokenizer
  fallback.

## Suggested review output

For each potential issue, report:

1. File and line.
2. Which change above applies.
3. Whether a code update is required or the match is unrelated.
4. The smallest safe migration.
5. Any behavior or stored-data risk that needs application-owner confirmation.
