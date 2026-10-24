# ⚛️ React & React Native Hooks

`local-lite` provides first-class reactive hooks for React, React Native, and Expo applications via `local-lite/react`.

```typescript
import { useLiveQuery, useSyncStatus } from 'local-lite/react';
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

## 2. `useSyncStatus`

`useSyncStatus` provides real-time visibility into the sync engine, connectivity status, active operations, and the local SQLite outbox queue.

### Signature:
```typescript
function useSyncStatus(client: LocalFirstClient | null): {
  isOnline: boolean;          // True when network connectivity is active
  isSyncing: boolean;         // True while actively pushing or pulling
  isPushing: boolean;         // True while pushing local mutations to remote
  isPulling: boolean;         // True while pulling remote deltas
  pendingCount: number;       // Number of mutations waiting in local SQLite outbox
  pendingRecords: any[];      // Array of pending outbox queue items
  lastSyncedAt: number | null;// Unix timestamp of last successful sync
  refresh: () => Promise<void>;
};
```

---

### Usage Example (Sync Status Badge):

```tsx
import { useSyncStatus } from 'local-lite/react';

export function SyncBadge({ client }) {
  const { isOnline, isSyncing, pendingCount, lastSyncedAt } = useSyncStatus(client);

  if (!isOnline) {
    return <Text style={{ color: '#ef4444' }}>📶 Offline (Changes saved locally)</Text>;
  }

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

---

## 3. `useGoogleAuth`

`useGoogleAuth` connects your React component to a `GoogleAuthClient` instance, providing reactive user profile data, sign-in, and sign-out actions.

### Signature:
```typescript
function useGoogleAuth(client: GoogleAuthClient | null | undefined): {
  user: GoogleUser | null;
  isSignedIn: boolean;
  loading: boolean;
  error: Error | null;
  signIn: () => Promise<GoogleUser | null>;
  signOut: () => Promise<void>;
  refetchUser: () => Promise<GoogleUser | null>;
};
```

---

### Usage Example:

```tsx
import { useGoogleAuth } from 'local-lite/react';
import { googleAuth } from './auth';

export function AuthButton() {
  const { user, isSignedIn, loading, signIn, signOut } = useGoogleAuth(googleAuth);

  if (loading) return <Text>Loading account...</Text>;

  if (!isSignedIn || !user) {
    return <Button title="Sign in with Google" onPress={signIn} />;
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {user.picture && (
        <Image source={{ uri: user.picture }} style={{ width: 32, height: 32, borderRadius: 16 }} />
      )}
      <Text>{user.name}</Text>
      <Button title="Sign Out" onPress={signOut} />
    </View>
  );
}
```

For full details on configuring redirect URIs, OAuth scopes, and Google Drive backups, see **[Google Sign-In & Auth](google-auth.md)**.

