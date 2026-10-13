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

## Quick Start (Expo SQLite + Supabase)

```typescript
import * as SQLite from 'expo-sqlite';
import { createClient } from '@supabase/supabase-js';
import {
  LocalFirstClient,
  ExpoSQLiteAdapter,
  SupabaseRemoteAdapter,
  DefaultNetworkStatusProvider
} from 'outbox-sync';

// 1. Initialize Supabase
const supabase = createClient('https://xyz.supabase.co', 'YOUR_ANON_KEY');

// 2. Open Local SQLite Database
const expoDb = await SQLite.openDatabaseAsync('app.db');

// 3. Initialize Outbox-Sync Client
const client = new LocalFirstClient({
  local: new ExpoSQLiteAdapter(expoDb),
  remote: new SupabaseRemoteAdapter(supabase, {
    tables: ['todos'],
    updatedAtColumn: 'updated_at',
    primaryKey: 'id',
  }),
  conflictResolver: 'last-write-wins',
});

await client.initialize();

// 4. Perform an Instant Local Mutation
await client.mutate('todos', 'todo-1', 'INSERT', {
  title: 'Local-first is awesome',
  completed: false,
});

// 5. Subscribe to Reactive Changes (Local + Remote)
client.events.on('todos', (event) => {
  console.log(`Table "todos" changed via ${event.source}:`, event);
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
