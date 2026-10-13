# ⚡ outbox-sync

A lightweight, vendor-agnostic **local-first synchronization engine** for React Native, Expo, and Web applications.

Built around the **Transactional Outbox Pattern**, `outbox-sync` ensures instant, zero-latency local writes in SQLite while guaranteeing offline resilience and asynchronous synchronization with your backend (including native **Supabase** support).

---

## Features

* **⚡ 0ms Optimistic Writes:** Write to local SQLite immediately via atomic dual-write (`client.mutate()`).
* **📦 Transactional Outbox:** Mutations are stored atomically in a local `sync_outbox` table, preventing data loss if the app closes or loses connectivity mid-write.
* **🌐 Native Supabase Adapter:** First-class sync with Postgres tables using Supabase upserts, delta timestamp queries, and Realtime Channels.
* **🛡️ Conflict Resolution:** Built-in strategies including **Last-Write-Wins (LWW)**, Server-Wins, Client-Wins, or custom resolver functions.
* **📶 Network-Aware:** Automatically pauses polling when offline and triggers immediate sync flushes the instant connectivity is restored.
* **🔄 Infinite-Loop Safe:** Incoming remote deltas update local tables and fire reactive UI listeners without echoing back into the outbox.

---

## Installation

```bash
npm install outbox-sync
```

Peer dependencies (install what you use):

```bash
# If using Expo SQLite
npx expo install expo-sqlite @react-native-community/netinfo

# If syncing with Supabase
npm install @supabase/supabase-js
```

---

### 1. Define your Configuration (`sync.config.ts`)

```typescript
// sync.config.ts
import { defineSyncConfig, createSyncClient } from 'outbox-sync';
import * as SQLite from 'expo-sqlite';

export const syncConfig = defineSyncConfig({
  // Open SQLite database
  database: () => SQLite.openDatabaseAsync('app.db'),

  // Tables to sync
  tables: ['todos', 'notes', 'tags'],

  // Automatic schema: creates tables & alters columns on the fly (no migrations needed!)
  autoSchema: true,

  // Supabase backend configuration
  supabase: {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://xyz.supabase.co',
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY',
  },

  // Fallback to in-memory demo mock if credentials are empty
  demoFallback: true,

  // Conflict handling strategy
  conflictResolver: 'last-write-wins',
});

// Singleton client instance
export const client = await createSyncClient(syncConfig);
```

### 2. Use in React Native / Expo UI

```tsx
import { useLiveQuery, useOutboxStatus } from 'outbox-sync';
import { client } from './sync.config';

export function TodoScreen() {
  // Automatically re-renders on local writes AND background remote pulls!
  const { data: todos } = useLiveQuery(client, 'todos', async () => {
    return await client.db.execute('SELECT * FROM todos ORDER BY id DESC');
  });

  const { pendingCount } = useOutboxStatus(client);

  const addTodo = async (title: string) => {
    // 0ms instant local write + queues outbox background sync
    await client.mutate('todos', `todo_${Date.now()}`, 'INSERT', {
      title,
      completed: 0,
    });
  };

  return (
    <View>
      <Text>Pending outbox items: {pendingCount}</Text>
      {todos.map(t => <Text key={t.id}>{t.title}</Text>)}
    </View>
  );
}
```

---

## Supported SQLite Drivers

`outbox-sync` is fully driver-agnostic and auto-detects your SQLite instance directly:

| Platform | Recommended Driver | Auto-Detected or Subpath Import |
| :--- | :--- | :--- |
| **Expo (iOS/Android/Web)** | `expo-sqlite` | `database: () => SQLite.openDatabaseAsync('app.db')` |
| **Bare React Native** | `@op-engineering/op-sqlite` | `outbox-sync/op-sqlite` |
| **Node.js / Electron / Desktop** | `better-sqlite3` | `outbox-sync/better-sqlite3` |
| **Edge / Server / Turso** | `@libsql/client` (LibSQL) | `outbox-sync/libsql` |
| **Web Browser / PWAs** | `sql.js` (WebAssembly) | `outbox-sync/sql-js` |
| **Node.js 22+ (Built-in)** | `node:sqlite` (DatabaseSync) | `outbox-sync/node-sqlite` |

```ts
// 1. Bare React Native (@op-engineering/op-sqlite)
import { open } from '@op-engineering/op-sqlite';
export const syncConfig = defineSyncConfig({
  database: open({ name: 'app.db' }), // Auto-detected!
  tables: ['todos'],
  autoSchema: true,
});

// 2. Turso / Edge (@libsql/client)
import { createClient } from '@libsql/client';
export const syncConfig = defineSyncConfig({
  database: createClient({ url: 'file:local.db' }), // Auto-detected!
  tables: ['todos'],
  autoSchema: true,
});

// 3. Web Browsers (sql.js WASM)
import initSqlJs from 'sql.js';
const SQL = await initSqlJs();
export const syncConfig = defineSyncConfig({
  database: new SQL.Database(), // Auto-detected!
  tables: ['todos'],
  autoSchema: true,
});
```

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
    ├──► pushChanges() ──► Remote Backend (Supabase / REST / WebSocket)
    │
    └──◄ fetchChanges() ◄── Remote Deltas (Merged via Conflict Resolver)
```

---

## Example App

An interactive Expo app is included in the [`example/`](./example) directory demonstrating:
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

Run the test suite:
```bash
npm test
```

## License

MIT
