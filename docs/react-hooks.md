# ⚛️ React & React Native Hooks

`local-lite` provides first-class reactive hooks for React, React Native, and Expo applications via `local-lite/react`.

```typescript
import { useLiveQuery, useOutboxStatus } from 'local-lite/react';
```

---

## 1. `useLiveQuery`

`useLiveQuery` executes a reactive SQLite query against your local database. It automatically re-runs and re-renders your component whenever:
- You perform a local insert, update, or delete on the table.
- The `SyncWorker` pulls new deltas from the cloud.

### Signature:
```typescript
function useLiveQuery<T = any>(
  client: LocalFirstClient | null,
  tableName: string,
  queryOrOptions?: QueryOptions | ((db: LocalDBAdapter) => Promise<T[]>)
): {
  data: T[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
};
```

---

### Basic Usage:

```tsx
import { useLiveQuery } from 'local-lite/react';

export function TodoList({ client }) {
  const { data: todos, loading } = useLiveQuery(client, 'todos', {
    orderBy: 'updatedAt',
    order: 'desc',
    limit: 50,
  });

  if (loading) return <Text>Loading SQLite data...</Text>;

  return (
    <FlatList
      data={todos}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <Text>{item.title}</Text>}
    />
  );
}
```

---

### Filtering with `where`:

```tsx
// Query active (incomplete) tasks
const { data: activeTasks } = useLiveQuery(client, 'tasks', {
  where: { completed: 0, category: 'work' },
  orderBy: 'priority',
  order: 'asc',
});
```

---

### Custom SQL Queries:

For advanced queries involving `JOIN`, aggregations (`COUNT`, `SUM`), or subqueries, pass a custom query function:

```tsx
const { data: stats } = useLiveQuery(client, 'todos', async (db) => {
  return await db.execute(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completedCount
    FROM todos
  `);
});
```

---

## 2. `useOutboxStatus`

`useOutboxStatus` provides real-time diagnostic visibility into the local sync outbox queue.

### Signature:
```typescript
function useOutboxStatus(client: LocalFirstClient | null): {
  pendingCount: number;      // Number of mutations waiting in local SQLite
  isSyncing: boolean;         // True while actively pushing or pulling
  lastSyncedAt: number | null;// Unix timestamp of last successful sync
  records: OutboxItem[];      // Array of pending outbox queue items
  refresh: () => Promise<void>;
};
```

---

### Usage Example (Sync Status Badge):

```tsx
import { useOutboxStatus } from 'local-lite/react';

export function SyncBadge({ client }) {
  const { pendingCount, isSyncing, lastSyncedAt } = useOutboxStatus(client);

  if (isSyncing) {
    return <Text style={{ color: '#38bdf8' }}>🔄 Syncing with cloud...</Text>;
  }

  if (pendingCount > 0) {
    return (
      <Text style={{ color: '#f59e0b' }}>
        ⏳ {pendingCount} offline change{pendingCount > 1 ? 's' : ''} queued
      </Text>
    );
  }

  return (
    <Text style={{ color: '#10b981' }}>
      ✅ Synced (last at {new Date(lastSyncedAt || Date.now()).toLocaleTimeString()})
    </Text>
  );
}
```
