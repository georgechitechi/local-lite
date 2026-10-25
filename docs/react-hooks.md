# ⚛️ React & Expo Hooks

`local-lite` provides first-class reactive hooks and UI developer tools for React, React Native, and Expo applications via `local-lite/react`.

```typescript
import {
  useLiveQuery,
  useLiveQueries,
  useLiveRow,
  useLiveInfiniteQuery,
  useMutations,
  useSyncStatus,
  useDatabaseMaintenance,
  useGoogleAuth,
  useMicrosoftAuth,
  useOneDriveAuth,
  useGitHubAuth,
  useAppleAuth,
  useCloudBackup,
  useGoogleDriveBackup,
  useOneDriveBackup,
  SyncInspector,
  BenchmarkModal,
} from 'local-lite/react';
```

---

## 1. `useLiveQuery`

`useLiveQuery` executes a reactive SQLite query against your local database. It automatically re-runs and re-renders your component whenever the table is modified locally or via incoming remote delta. It uses an in-memory LRU read-through cache to deliver **0ms mount latency with zero UI flicker**.

### Signature:
```typescript
function useLiveQuery<T = any>(
  client: LocalFirstClient | null | undefined,
  tableName: string,
  queryOrOptions?: QueryOptions | ((client: LocalFirstClient) => Promise<T[]> | T[])
): {
  data: T[];
  loading: boolean;
  refetch: () => Promise<void>;
};
```

### Usage Examples:

```tsx
import { useLiveQuery } from 'local-lite/react';

export function TodoList({ client }) {
  // 1. Declarative filtering and sorting without SQL
  const { data: todos, loading } = useLiveQuery(client, 'todos', {
    where: { completed: 0, priority: { $gte: 2 } },
    orderBy: 'updatedAt',
    order: 'desc',
    limit: 50,
  });

  if (loading) return <Text>Loading...</Text>;

  return (
    <FlatList
      data={todos}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <Text>{item.title}</Text>}
    />
  );
}
```

```tsx
// 2. Custom SQL Query with joins or aggregations
const { data: stats } = useLiveQuery(client, 'todos', async (c) => {
  return await c.query(`
    SELECT
      categories.name AS category,
      COUNT(todos.id) AS total_count
    FROM categories
    LEFT JOIN todos ON todos.category_id = categories.id
    GROUP BY categories.id
  `);
});
```

---

## 2. `useLiveQueries` (Multi-Table Live Queries)

When a screen requires data from multiple tables (e.g. projects, tasks, and users), calling multiple individual hooks causes cascading re-renders and UI stutter.

`useLiveQueries` solves this by:
* Fetching all tables concurrently with `Promise.all`.
* Committing results in a **single atomic React state update**.
* Coalescing multi-table change events so dependent computations execute only once.

### Signature:
```typescript
function useLiveQueries<T extends Record<string, any[]> = Record<string, any[]>>(
  client: LocalFirstClient | null | undefined,
  queries:
    | Array<string | (QueryOptions & { table: string })>
    | Record<string, string | (QueryOptions & { table?: string }) | LiveQueryFn<any>>
): {
  data: T;
  loading: boolean;
  refetch: () => Promise<void>;
};
```

### Usage Example:
```tsx
import { useLiveQueries } from 'local-lite/react';

export function DashboardScreen({ client }) {
  const { data, loading } = useLiveQueries(client, {
    projects: 'projects',
    activeTasks: {
      table: 'tasks',
      where: { completed: 0 },
      orderBy: 'created_at',
      order: 'desc',
    },
    members: 'team_members',
  });

  if (loading) return <ActivityIndicator />;

  return (
    <View>
      <Text>Active Projects: {data.projects.length}</Text>
      <Text>Pending Tasks: {data.activeTasks.length}</Text>
      <Text>Team Members: {data.members.length}</Text>
    </View>
  );
}
```

---

## 3. `useLiveRow` (Targeted Single-Row Live Query)

Queries a single row by primary key with **row-level invalidation**. Unlike table-level queries that re-render whenever *any* row in the table changes, `useLiveRow` only triggers re-renders when mutations affect this specific `rowId`.

### Signature:
```typescript
function useLiveRow<T = any>(
  client: LocalFirstClient | null | undefined,
  tableName: string,
  rowId: string | null | undefined,
  options?: { includeDeleted?: boolean }
): {
  data: T | null;
  loading: boolean;
  refetch: () => Promise<void>;
};
```

### Usage Example:
```tsx
import { useLiveRow } from 'local-lite/react';

export function TodoItemDetails({ client, todoId }) {
  const { data: todo, loading } = useLiveRow(client, 'todos', todoId);

  if (loading) return <Text>Loading...</Text>;
  if (!todo) return <Text>Item not found</Text>;

  return (
    <View>
      <Text style={{ fontWeight: 'bold' }}>{todo.title}</Text>
      <Text>Status: {todo.completed ? 'Done' : 'Pending'}</Text>
    </View>
  );
}
```

---

## 4. `useLiveInfiniteQuery` (Paginated Infinite Scrolling)

Progressively loads pages of records with automatic live updates when underlying items are inserted, edited, or deleted.

### Signature:
```typescript
function useLiveInfiniteQuery<T = any>(
  client: LocalFirstClient | null | undefined,
  tableName: string,
  options?: InfiniteQueryOptions // { pageSize?: number; where?: WhereFilter; orderBy?: string; order?: 'asc' | 'desc' }
): {
  data: T[];
  loading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<void>;
};
```

### Usage Example:
```tsx
import { useLiveInfiniteQuery } from 'local-lite/react';

export function InfiniteFeed({ client }) {
  const {
    data: items,
    loading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useLiveInfiniteQuery(client, 'feed_items', {
    pageSize: 20,
    orderBy: 'created_at',
    order: 'desc',
  });

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <Text>{item.text}</Text>}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      ListFooterComponent={isFetchingNextPage ? <ActivityIndicator /> : null}
    />
  );
}
```

---

## 5. `useMutations` (Universal Mutation Helpers)

Provides memoized, null-safe helper methods for performing database operations without checking `if (!client)` manually.

### Signature:
```typescript
const {
  insert,
  insertMany,
  update,
  updateMany,
  delete: remove,
  batch,
  transaction,
} = useMutations(client);
```

### Usage Example:
```tsx
import { useMutations } from 'local-lite/react';

export function TaskEditor({ client }) {
  const mutations = useMutations(client);

  const handleCreate = async () => {
    const id = await mutations.insert('tasks', {
      title: 'New Task',
      completed: 0,
    });
  };

  const handleToggle = async (id: string, current: number) => {
    await mutations.update('tasks', id, { completed: current ? 0 : 1 });
  };

  const handleBatchArchive = async (ids: string[]) => {
    await mutations.updateMany(
      'tasks',
      ids.map((id) => ({ id, payload: { archived: 1 } }))
    );
  };

  return (
    <Button title="Create Task" onPress={handleCreate} />
  );
}
```

---

## 6. `useSyncStatus`

Inspects real-time sync worker activity, network connectivity, and pending outbox mutations.

### Signature:
```typescript
function useSyncStatus(client: LocalFirstClient | null | undefined): {
  isOnline: boolean;           // True when internet connectivity is active
  isSyncing: boolean;          // True while actively pushing or pulling
  isPushing: boolean;          // True while pushing local mutations to remote
  isPulling: boolean;          // True while pulling remote deltas
  pendingCount: number;        // Number of mutations queued in local SQLite outbox
  pendingRecords: any[];       // Array of pending outbox queue records
  lastSyncedAt: number | null; // Timestamp of last successful sync
  refresh: () => Promise<void>;
};
```

### Usage Example:
```tsx
import { useSyncStatus } from 'local-lite/react';

export function SyncBadge({ client }) {
  const { isOnline, isSyncing, pendingCount, lastSyncedAt } = useSyncStatus(client);

  if (!isOnline) {
    return <Text style={{ color: '#ef4444' }}>📶 Offline (Changes saved locally)</Text>;
  }
  if (isSyncing) {
    return <Text style={{ color: '#0284c7' }}>🔄 Syncing with cloud...</Text>;
  }
  if (pendingCount > 0) {
    return <Text style={{ color: '#f59e0b' }}>⏳ {pendingCount} change(s) pending</Text>;
  }
  return (
    <Text style={{ color: '#10b981' }}>
      ✅ Synced {lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : ''}
    </Text>
  );
}
```

---

## 7. `useDatabaseMaintenance`

Provides reactive controls to monitor database disk usage, prune outbox logs, vacuum defragmentation, and force WAL checkpoints.

```tsx
import { useDatabaseMaintenance } from 'local-lite/react';

export function MaintenanceScreen({ client }) {
  const {
    stats,
    loading,
    refreshStats,
    pruneOutbox,
    vacuum,
    checkpoint,
  } = useDatabaseMaintenance(client);

  return (
    <View>
      <Text>Database Size: {stats?.databaseSizeBytes ?? 0} bytes</Text>
      <Text>Pending Outbox: {stats?.outbox.pending ?? 0}</Text>
      <Button title="Prune Outbox (>14 days)" onPress={() => pruneOutbox({ retentionDays: 14 })} />
      <Button title="Defragment (VACUUM)" onPress={vacuum} />
      <Button title="Truncate WAL" onPress={() => checkpoint('TRUNCATE')} />
    </View>
  );
}
```

---

## 8. Authentication Hooks

* `useGoogleAuth(googleAuthClient)`
* `useMicrosoftAuth(oneDriveAuthClient)`
* `useOneDriveAuth(oneDriveAuthClient)`
* `useGitHubAuth(gitHubAuthClient)`
* `useAppleAuth(appleAuthClient)`

Each hook returns `{ user, isSignedIn, loading, error, signIn, signOut }`. See **[Authentication](auth.md)** for complete details.

---

## 9. Cloud Backup Hooks

* `useCloudBackup(backupClient, database, options)`
* `useGoogleDriveBackup(googleDriveClient, database, options)`
* `useOneDriveBackup(oneDriveClient, database, options)`

Provides complete cloud backup lifecycle in React:

```tsx
import { useGoogleDriveBackup } from 'local-lite/react';
import { googleDriveBackup } from './backup-client';

export function BackupManager({ client }) {
  const {
    isConnected,
    isLoading,
    isBackingUp,
    isRestoring,
    backups,
    backup,
    restore,
    deleteBackup,
  } = useGoogleDriveBackup(googleDriveBackup, client, {
    passphrase: 'user-secret-passphrase', // Optional zero-knowledge encryption
  });

  return (
    <View>
      <Button
        title={isBackingUp ? 'Backing up...' : 'Backup to Google Drive'}
        disabled={isBackingUp}
        onPress={() => backup()}
      />
      {backups.map((b) => (
        <View key={b.id}>
          <Text>{b.name} ({new Date(b.createdAt).toLocaleDateString()})</Text>
          <Button title="Restore" onPress={() => restore(b.name)} />
          <Button title="Delete" onPress={() => deleteBackup(b.id)} />
        </View>
      ))}
    </View>
  );
}
```

---

## 10. Developer Tools & Components

`local-lite/react` includes ready-to-use developer UI components for testing, monitoring, and stress testing your sync engine:

### `<SyncInspector />`
A floating or inline developer widget displaying real-time outbox queues, active sync status, connection indicators, push/pull controls, theme toggling, and benchmark runner.

```tsx
import { SyncInspector } from 'local-lite/react';
import { client } from './sync.config';

export default function App() {
  return (
    <View style={{ flex: 1 }}>
      <YourAppContent />

      {/* Developer Sync Inspector */}
      {__DEV__ && (
        <SyncInspector
          client={client}
          position="bottom-right"
          variant="pill" // 'pill' | 'compact' | 'icon' | 'minimal'
          theme="auto"   // 'auto' | 'dark' | 'light'
          enableBenchmark={true}
        />
      )}
    </View>
  );
}
```

### `<BenchmarkModal />`
An automated in-app stress test runner measuring:
* Atomic batch ingestion throughput (records/sec)
* SQLite indexing & query responsiveness
* ACID rollback isolation integrity
* Non-blocking WAL concurrency
* Outbox queue flushing performance
