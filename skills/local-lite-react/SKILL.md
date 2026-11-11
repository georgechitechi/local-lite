---
name: local-lite-react
description: Master reactive patterns, hooks, live queries, and optimistic state in React and React Native with local-lite. Use when writing useLiveQuery, useSyncStatus, useLocalAuth, useKV, useSearch, useQueryBuilder, or optimizing component re-renders.
---

# local-lite React & React Native Integration

Comprehensive guide to building reactive, offline-first user interfaces using `local-lite/react`.

---

## 1. Core Hooks Overview

| Hook | Purpose |
| :--- | :--- |
| `useLiveQuery(client, sql, params, deps)` | Reactive SQLite query. Auto-re-runs whenever relevant tables mutate. |
| `useSyncStatus(client)` | Tracks online/offline status, sync worker state, and outbox changes. |
| `useLocalAuth(client.auth)` | Manages zero-backend SQLite authentication, user profiles, and sessions. |
| `useKV(client.kv, key, default)` | Reactive key-value store for preferences and application state. |
| `useEncryptedKV(client.kv, key, pass)` | End-to-end encrypted secret preferences with AES-256-GCM. |
| `useSearch(client, ftsTable, query)` | Real-time full-text search powered by SQLite FTS5. |
| `useQueryBuilder(client, table, filter)` | Declarative MongoDB-style query filters. |
| `useCloudBackup(backupClient, db)` | Cloud backups (OneDrive / Google Drive) with live progress. |

---

## 2. Live Queries (`useLiveQuery`)

`useLiveQuery` executes raw SQLite queries and re-runs them reactively when affected tables change:

```tsx
import React, { useMemo } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useLiveQuery } from 'local-lite/react';
import type { LocalFirstClient } from 'local-lite/config';

interface Todo {
  id: string;
  title: string;
  completed: number;
}

export function TodoList({ client, projectId }: { client: LocalFirstClient; projectId: string }) {
  // Always memoize params to prevent unnecessary query executions
  const params = useMemo(() => [projectId], [projectId]);

  const { data: todos, loading, error, refetch } = useLiveQuery<Todo>(
    client,
    'SELECT * FROM todos WHERE project_id = ? ORDER BY updated_at DESC;',
    params
  );

  if (loading) return <Text>Loading...</Text>;
  if (error) return <Text>Query error: {error.message}</Text>;

  return (
    <FlatList
      data={todos}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <Text style={{ textDecorationLine: item.completed ? 'line-through' : 'none' }}>
          {item.title}
        </Text>
      )}
    />
  );
}
```

---

## 3. Optimistic 0ms Writes (`client.mutate`)

For zero-latency user experiences, perform writes using `client.mutate()`. This writes directly to local SQLite in an atomic transaction and automatically triggers all matching `useLiveQuery` hooks across the UI:

```tsx
import { generateUUID } from 'local-lite';

async function addTodo(client: LocalFirstClient, title: string, projectId: string) {
  const newTodo = {
    id: generateUUID(),
    project_id: projectId,
    title,
    completed: 0,
    updated_at: Date.now(),
  };

  // 1. Dual-writes to local SQLite and queues in outbox for sync
  await client.mutate('todos', 'INSERT', newTodo);
  // All useLiveQuery hooks listening to 'todos' update instantly (0ms)!
}
```

---

## 4. Reactive Preferences & Encrypted KV

```tsx
import { useKV, useEncryptedKV } from 'local-lite/react';

export function SettingsScreen({ client }) {
  // 1. Plain reactive setting
  const [theme, setTheme] = useKV<'light' | 'dark'>(client?.kv, 'app_theme', 'light');

  // 2. Encrypted setting (AES-256-GCM)
  const [apiKey, setApiKey] = useEncryptedKV(client?.kv, 'openai_key', 'UserPassphrase!');

  return (
    <View>
      <Text>Theme: {theme}</Text>
      <Button title="Toggle Theme" onPress={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
    </View>
  );
}
```

---

## 5. Performance Best Practices

1. **Memoize Query Parameters**: Pass memoized arrays or primitives to `useLiveQuery` to avoid re-triggering queries on every parent component render.
2. **Selective Column Projections**: In high-frequency queries, select only required columns (`SELECT id, title FROM ...`) instead of `SELECT *` to reduce SQLite serialization overhead.
3. **Batch Mutations**: Wrap bulk inserts in transactions or `client.mutateBatch()` rather than issuing individual `INSERT` statements in loops.

---

## 6. DevTools & Debugging (`<SyncInspector />`)

Inspect database tables, live outbox operations, and trigger one-tap manual flushes of mutations and queued emails using the developer widget:

```tsx
import { SyncInspector } from 'local-lite/devtools';

export function DevOverlay({ client }) {
  if (__DEV__) {
    return <SyncInspector client={client} position="bottom-right" defaultOpen={false} />;
  }
  return null;
}
```

