# ⚡ local-lite

[![Documentation](https://img.shields.io/badge/docs-GitHub%20Pages-0284c7.svg?style=flat-square)](https://georgechitechi.github.io/local-lite/)
[![npm version](https://img.shields.io/npm/v/local-lite.svg?style=flat-square)](https://www.npmjs.com/package/local-lite)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

A lightweight, vendor-agnostic **local-first synchronization engine** for React Native, Expo, and Web applications.

Built around the **Transactional Outbox Pattern**, `local-lite` ensures instant, zero-latency local writes in SQLite while guaranteeing offline resilience and asynchronous synchronization with your backend (including native **Supabase**, **Convex**, and **Firebase / Firestore** support).

---

## 📖 Documentation

> 🌐 **Interactive Documentation Site:** **[https://georgechitechi.github.io/local-lite/](https://georgechitechi.github.io/local-lite/)**

* **[Quickstart & Setup](https://georgechitechi.github.io/local-lite/#/getting-started)** - 5-minute setup with Expo, React Native, or Node.js
* **[Architecture](https://georgechitechi.github.io/local-lite/#/architecture)** - Transactional outbox pattern, SyncWorker loops, and event pipeline
* **[Configuration Reference](https://georgechitechi.github.io/local-lite/#/configuration)** - Options for `defineSyncConfig()`, retries, and loggers
* **[Local SQLite Adapters](https://georgechitechi.github.io/local-lite/#/adapters-local)** - Expo SQLite, OP-SQLite, better-sqlite3, node:sqlite, and LibSQL
* **[Remote Cloud Adapters](https://georgechitechi.github.io/local-lite/#/adapters-remote)** - Supabase, Convex, Cloud Firestore, and custom adapters
* **[Authentication (Google, Microsoft, GitHub, Apple)](https://georgechitechi.github.io/local-lite/#/auth)** - Direct PKCE & native Apple authentication clients & hooks
* **[Database Backups & Encryption](https://georgechitechi.github.io/local-lite/#/backups)** - Google Drive, OneDrive, and Zero-Knowledge AES-256-GCM snapshots
* **[Conflict Resolution & Field Merge](https://georgechitechi.github.io/local-lite/#/conflict-resolution)** - 3-Way field merging, LWW, Client-Wins, and Server-Wins
* **[Maintenance & Data Portability](https://georgechitechi.github.io/local-lite/#/maintenance-portability)** - VACUUM, WAL checkpoints, outbox pruning, and JSON/CSV export/import
* **[React & Expo Hooks](https://georgechitechi.github.io/local-lite/#/react-hooks)** - `useLiveQuery()`, `useSyncStatus()`, and auth hooks

---

## Independent core and explicit policies

Use `local-lite/core` for the sync engine with your own `LocalDBAdapter` and
`RemoteDBAdapter`. This entry point does not load provider implementations,
configuration auto-detection, or React. UI hooks and backend adapters remain optional.

```typescript
import { LocalFirstClient } from 'local-lite/core';

const client = new LocalFirstClient({
  local: myLocalAdapter,
  remote: myRemoteAdapter,
  autoSchema: false,
  autoStart: false,
  conflictResolver: myConflictResolver,
});
await client.initialize();
// Writes remain in the outbox until you push manually or enable automatic sync.
await client.syncWorker.pushLocalChanges();
// Or enable polling, reconnect handling, and realtime subscriptions:
client.syncWorker.start();
```

Authentication, account switching, application schemas, UI reloads, and decisions
to discard failed writes belong to the caller. The core does not inspect backend
error codes to delete failed mutations. Conflict resolution and retry settings
remain configurable; the existing default conflict strategy is last-write-wins.

### Compatibility changes from 0.0.3

- Missing remote configuration now throws. Temporary demo behavior requires
  `inMemoryRemote: true`; it must never silently acknowledge production writes.
- `autoSchema` now defaults to `false` in the configuration factory as well as the
  core constructor. Set `autoSchema: true` to retain inferred schema behavior.
- Migrations run transactionally before sync starts, including when initialization
  is deferred with `autoInitialize: false`. Use idempotent SQL; this is not a
  versioned migration framework.
- `initialize()` is safe to call repeatedly or concurrently. After `stop()`, call
  `client.syncWorker.start()` to resume. Mutations after stop remain queued.
- `autoStart: false` prepares storage without automatic sync. Explicit push/pull
  methods remain available. Stop does not cancel adapter calls already in flight.
- Realtime changes update local rows without advancing the durable pull cursor.
  Custom pull adapters must return complete batches through their checkpoint and
  reject partial failures. Supabase table failures now reject the pull.
- Custom realtime adapters may return an unsubscribe function. Legacy adapters
  returning void remain supported; stopped workers ignore their later callbacks.

## Features

Interrupted pushes recover automatically at startup and before the next push cycle,
including when a temporary database error prevented saving a failure status.
Use one active sync client per local database. Recovery may replay a remote write,
so custom remote adapters should handle repeated operation IDs idempotently.
This recovers sync state; it does not repair corrupt SQLite files or cancel hung adapter calls.

* **⚡ 0ms Optimistic Writes:** Write to local SQLite immediately via atomic dual-write (`client.mutate()`).
* **📦 Transactional Outbox:** Mutations are stored atomically in a local `sync_outbox` table, preventing data loss if the app closes or loses connectivity mid-write.
* **🌐 Native Cloud Adapters:** First-class sync with Postgres tables (via **Supabase**), reactive document datastores (via **Convex**), and document collections (via **Firebase / Firestore**).
* **🛡️ Conflict Resolution:** Built-in strategies including **Last-Write-Wins (LWW)**, Server-Wins, Client-Wins, or custom resolver functions.
* **📶 Network-Aware:** Automatically pauses polling when offline and triggers immediate sync flushes the instant connectivity is restored.
* **🔄 Infinite-Loop Safe:** Incoming remote deltas update local tables and fire reactive UI listeners without echoing back into the outbox.
* **☁️ Database Backups:** Export and restore SQLite snapshots independently of your live sync backend.
* **🔑 Google Sign-In Out of the Box:** Secure, zero-backend Google OAuth 2.0 (PKCE) authentication with automatic token refresh, user profile retrieval, persistent session storage, and `useGoogleAuth()` hook.


---

## Installation

```bash
npm install local-lite
```

Peer dependencies (install what you use):

```bash
# If using Expo SQLite
npx expo install expo-sqlite @react-native-community/netinfo

# If syncing with Supabase
npm install @supabase/supabase-js

# If syncing with Convex
npm install convex

# If syncing with Firebase / Firestore
npm install firebase # or @react-native-firebase/firestore
```

---

### 1. Define your Configuration (`sync.config.ts`)

#### Option A: With Supabase

```typescript
// sync.config.ts
import { defineSyncConfig, createSyncClient } from 'local-lite';
import * as SQLite from 'expo-sqlite';

export const syncConfig = defineSyncConfig({
  database: () => SQLite.openDatabaseAsync('app.db'),
  tables: ['todos', 'notes'],
  autoSchema: true,

  // Supabase backend configuration
  supabase: {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://xyz.supabase.co',
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY',
  },

  conflictResolver: 'last-write-wins',
});

export const client = await createSyncClient(syncConfig);
```

#### Option B: With Convex

```typescript
// sync.config.ts
import { defineSyncConfig, createSyncClient } from 'local-lite';
import { ConvexClient } from 'convex/browser';
import * as SQLite from 'expo-sqlite';

const convexClient = new ConvexClient(process.env.EXPO_PUBLIC_CONVEX_URL!);

export const syncConfig = defineSyncConfig({
  database: () => SQLite.openDatabaseAsync('app.db'),
  tables: ['properties', 'tenants'],
  autoSchema: true,

  // Convex backend configuration
  convex: {
    client: convexClient,
    pushMutation: 'sync:pushBatch', // Or api.sync.pushBatch
    pullQuery: 'sync:pullDeltas',   // Or api.sync.pullDeltas
    deletedColumn: 'deleted',
    updatedAtColumn: 'updatedAt',
  },

  conflictResolver: 'last-write-wins',
});

export const client = await createSyncClient(syncConfig);
```

#### Option C: With Firebase / Cloud Firestore

```typescript
// sync.config.ts
import { defineSyncConfig, createSyncClient } from 'local-lite';
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import * as SQLite from 'expo-sqlite';

const app = initializeApp({
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);

export const syncConfig = defineSyncConfig({
  database: () => SQLite.openDatabaseAsync('app.db'),
  tables: ['properties', 'tenants'],
  autoSchema: true,

  // Firebase Firestore backend configuration
  firebase: {
    firestore: db,                // Modular Firestore or @react-native-firebase/firestore
    updatedAtColumn: 'updatedAt', // Timestamp field used for delta sync
    deletedColumn: 'deleted',     // Soft delete flag
  },

  conflictResolver: 'last-write-wins',
});

export const client = await createSyncClient(syncConfig);
```

---

### 2. Use in React Native / Expo UI

```tsx
import { useLiveQuery, useSyncStatus } from 'local-lite/react';
import { client } from './sync.config';

export function TodoScreen() {
  // ⚡ Zero-SQL Reactive Live Query (Auto re-renders on local writes AND background remote pulls!)
  const { data: todos } = useLiveQuery(client, 'todos', {
    orderBy: 'id',
    order: 'desc',
  });

  const { pendingCount, isOnline, isSyncing } = useSyncStatus(client);

  const addTodo = async (title: string) => {
    await client.insert('todos', {
      title,
      completed: 0,
    });
  };

  const toggleTodo = async (id: string, completed: number) => {
    await client.update('todos', id, { completed: completed ? 0 : 1 });
  };

  const removeTodo = async (id: string) => {
    await client.delete('todos', id);
  };

  return (
    <View>
      <Text>Pending outbox items: {pendingCount}</Text>
      {todos.map(t => <Text key={t.id}>{t.title}</Text>)}
    </View>
  );
}
```

### 3. Google Sign-In (Out of the Box)

`local-lite` provides a zero-backend, PKCE-secured Google OAuth 2.0 client with automatic token refreshing, user profile retrieval, and React hooks.

```tsx
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { GoogleAuthClient } from 'local-lite/auth';
import { useGoogleAuth } from 'local-lite/react';

const googleAuth = new GoogleAuthClient({
  clientId: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
  redirectUri: Linking.createURL('oauth'),
  authorize: async ({ authorizationUrl, redirectUri }) => {
    const res = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);
    if (res.type !== 'success' || !res.url) return null;
    const url = new URL(res.url);
    return {
      code: url.searchParams.get('code') || '',
      state: url.searchParams.get('state') || '',
    };
  },
});

export function UserProfileHeader() {
  const { user, isSignedIn, loading, signIn, signOut } = useGoogleAuth(googleAuth);

  if (loading) return <Text>Loading...</Text>;
  if (!isSignedIn) {
    return <Button title="Sign in with Google" onPress={signIn} />;
  }

  return (
    <View>
      <Text>Welcome, {user?.name} ({user?.email})</Text>
      <Button title="Sign Out" onPress={signOut} />
    </View>
  );
}
```

---


## Supabase Backend Setup & Schema

To synchronize with Supabase using zero-clock-skew delta queries and `deleted: true` soft deletes, execute the following script in your Supabase project (**Dashboard → SQL Editor**):

```sql
-- Ensure every application table has the soft-delete column expected by local-lite.
DO $$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS deleted BOOLEAN',
      table_record.table_schema,
      table_record.table_name
    );
    EXECUTE format(
      'UPDATE %I.%I SET deleted = FALSE WHERE deleted IS NULL',
      table_record.table_schema,
      table_record.table_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN deleted SET DEFAULT FALSE',
      table_record.table_schema,
      table_record.table_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN deleted SET NOT NULL',
      table_record.table_schema,
      table_record.table_name
    );
  END LOOP;
END $$;

-- 1. Automatic Timestamp Trigger
CREATE OR REPLACE FUNCTION public.set_sync_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create Synced Table (e.g. 'todos')
CREATE TABLE IF NOT EXISTS public.todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  completed INTEGER DEFAULT 0,
  deleted BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Index for high-performance delta sync queries
CREATE INDEX IF NOT EXISTS idx_todos_sync ON public.todos (updated_at);

-- 4. Auto-update updated_at on changes (including soft deletes)
CREATE OR REPLACE TRIGGER trigger_todos_updated_at
BEFORE UPDATE ON public.todos
FOR EACH ROW EXECUTE FUNCTION public.set_sync_updated_at();

-- 5. Enable Supabase Realtime broadcast replication
ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;
```

---

## Convex Backend Setup & Functions

In Convex, create a sync module (e.g., `convex/sync.ts`):

```typescript
// convex/sync.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// 1. Push batch mutation from outbox
export const pushBatch = mutation({
  args: {
    operations: v.array(
      v.object({
        id: v.string(),
        tableName: v.string(),
        rowId: v.string(),
        operation: v.string(),
        payload: v.any(),
        timestamp: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const op of args.operations) {
      const table = op.tableName;
      const existing = await ctx.db
        .query(table as any)
        .filter((q) => q.eq(q.field("id"), op.rowId))
        .first();

      if (op.operation === "DELETE") {
        if (existing) {
          await ctx.db.patch(existing._id, { deleted: true, updatedAt: now });
        }
      } else {
        const doc = { ...(op.payload || {}), id: op.rowId, deleted: false, updatedAt: now };
        if (existing) {
          await ctx.db.patch(existing._id, doc);
        } else {
          await ctx.db.insert(table as any, doc);
        }
      }
    }
    return true;
  },
});

// 2. Pull deltas query since timestamp cursor
export const pullDeltas = query({
  args: {
    sinceTimestamp: v.number(),
    tables: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const results: any[] = [];
    for (const table of args.tables) {
      const docs = await ctx.db
        .query(table as any)
        .filter((q) => q.gt(q.field("updatedAt"), args.sinceTimestamp))
        .collect();

      for (const d of docs) {
        results.push({ ...d, tableName: table });
      }
    }
    return results;
  },
});
```

---

## Supported SQLite Drivers

`local-lite` is fully driver-agnostic and auto-detects your SQLite instance directly:

| Platform | Recommended Driver | Auto-Detected or Subpath Import |
| :--- | :--- | :--- |
| **Expo (iOS/Android/Web)** | `expo-sqlite` | `database: () => SQLite.openDatabaseAsync('app.db')` |
| **Bare React Native** | `@op-engineering/op-sqlite` | `local-lite/op-sqlite` |
| **Node.js / Electron / Desktop** | `better-sqlite3` | `local-lite/better-sqlite3` |
| **Edge / Server / Turso** | `@libsql/client` (LibSQL) | `local-lite/libsql` |
| **Web Browser / PWAs** | `sql.js` (WebAssembly) | `local-lite/sql-js` |
| **Node.js 22+ (Built-in)** | `node:sqlite` (DatabaseSync) | `local-lite/node-sqlite` |

---

## Architecture

```
[ App UI ]
    │
    ▼
LocalFirstClient ──(Atomic Transaction)──► Local SQLite Table
    │                                             │
    ▼                                             ▼
sync_outbox (Pending queue)                 EventEmitter (UI refresh)
    │
    ▼ (Immediate / Debounced / Network-Aware)
SyncWorker
    │
    ├──► pushChanges() ──► Remote Backend (Supabase / Convex / Firebase / Custom)
    │
    └──◄ fetchChanges() ◄── Remote Deltas (Merged via Conflict Resolver)
```

---

## Example App

An interactive Expo app is included in the [`example/`](./example) directory demonstrating:
- Rental property & tenant management application
- Live SQLite reads and atomic dual-writes
- Network online/offline toggle simulation
- Real-time `sync_outbox` inspector
- Simulated server delta broadcasts

To run the example:
```bash
cd example
npm start
```

---

## Testing

Run the Vitest test suite:
```bash
npm test
```

## License

MIT
