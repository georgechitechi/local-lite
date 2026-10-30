# 🚀 Getting Started with local-lite

This guide walks you through installing `local-lite` and setting up your first offline-first sync pipeline in 5 minutes.

---

## 1. Installation

Install the core package:

```bash
npm install local-lite
```

### Install Drivers & Backend Dependencies

Install the SQLite driver for your target platform and your chosen cloud backend:

#### For Expo (iOS, Android, Web)
```bash
npx expo install expo-sqlite @react-native-community/netinfo
```

#### For Bare React Native
```bash
npm install @op-engineering/op-sqlite @react-native-community/netinfo
```

#### For Node.js / Electron / Desktop
```bash
npm install better-sqlite3
```

#### Cloud Backends (choose one)
```bash
# If using Supabase
npm install @supabase/supabase-js

# If using Convex
npm install convex

# If using Firebase / Firestore
npm install firebase # or @react-native-firebase/firestore
```

---

## 2. Define Your Configuration

Create a file named `sync.config.ts`:

```typescript
// src/sync.config.ts
import { defineSyncConfig, createSyncClient, LocalFirstClient } from 'local-lite/config';
import * as SQLite from 'expo-sqlite';

export const syncConfig = defineSyncConfig({
  // 1. Local Database instance or factory
  database: () => SQLite.openDatabaseAsync('app.db'),

  // 2. Tables to synchronize
  tables: ['todos', 'notes'],

  // 3. Create and evolve the local schema with ordered migrations
  schemaMigrations: [
    {
      version: 1,
      up: [
        'CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)',
        'CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, updated_at INTEGER NOT NULL DEFAULT 0)',
      ],
    },
  ],

  // 4. Remote backend credentials (e.g. Supabase, Convex, or in-memory demo)
  supabase: {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },

  // 5. Conflict strategy & sync intervals
  conflictResolver: 'last-write-wins',
  pushIntervalMs: 3000,
  pullIntervalMs: 8000,
});

// Singleton client initializer
let clientPromise: Promise<LocalFirstClient> | null = null;
export function getSyncClient(): Promise<LocalFirstClient> {
  if (!clientPromise) {
    clientPromise = createSyncClient(syncConfig);
  }
  return clientPromise;
}
```

---

## 3. Build a Reactive UI Component

Use `useLiveQuery` and `useSyncStatus` in your React or React Native components:

```tsx
// src/app/index.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList } from 'react-native';
import { useLiveQuery, useSyncStatus } from 'local-lite/react';
import { LocalFirstClient, generateUUID } from 'local-lite';
import { getSyncClient } from '../sync.config';

export default function TodoApp() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [text, setText] = useState('');

  // 1. Initialize client on mount
  useEffect(() => {
    getSyncClient().then(setClient);
  }, []);

  // 2. Live query: automatically re-renders on local writes & remote pulls
  const { data: todos } = useLiveQuery(client, 'todos', {
    orderBy: 'updated_at',
    order: 'desc',
  });

  // 3. Monitor sync engine & pending outbox queue
  const { pendingCount, isSyncing, isOnline } = useSyncStatus(client);

  // 4. Instant local write
  const handleAddTodo = async () => {
    if (!client || !text.trim()) return;
    const title = text.trim();
    setText('');

    await client.insert('todos', {
      id: generateUUID(),
      title,
      completed: 0,
      updated_at: Date.now(),
    });
  };

  const handleToggle = async (id: string, current: number) => {
    if (!client) return;
    await client.update('todos', id, {
      completed: current ? 0 : 1,
      updated_at: Date.now(),
    });
  };

  return (
    <View style={{ flex: 1, padding: 24 }}>
      <Text style={{ fontSize: 20, fontWeight: 'bold' }}>Local-First Todos</Text>
      <Text style={{ color: '#666', marginBottom: 16 }}>
        {pendingCount > 0 ? `Syncing (${pendingCount} pending)...` : 'All changes synced'}
      </Text>

      <View style={{ flexDirection: 'row', marginBottom: 16 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="New task..."
          style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', padding: 8, borderRadius: 4 }}
        />
        <TouchableOpacity onPress={handleAddTodo} style={{ backgroundColor: '#0284c7', padding: 10, marginLeft: 8, borderRadius: 4 }}>
          <Text style={{ color: '#fff' }}>Add</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={todos}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => handleToggle(item.id, item.completed)}>
            <Text style={{ paddingVertical: 8, textDecorationLine: item.completed ? 'line-through' : 'none' }}>
              {item.completed ? '✅' : '⬜'} {item.title}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
```

---

## Next Steps
- Learn how the [Transactional Outbox Architecture](./architecture.md) works under the hood.
- Explore driver guides in [Local Adapters](./adapters-local.md) and [Remote Adapters](./adapters-remote.md).
