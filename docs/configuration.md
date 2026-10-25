# ⚙️ Configuration Reference

The configuration engine uses `defineSyncConfig(config)` to provide full TypeScript autocompletion and compile-time validation.

```typescript
import { defineSyncConfig, createSyncClient } from 'local-lite/config';
```

---

## Complete `LocalLiteConfig` Options

### Database, Tables & Schema

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `database` | `any \| string \| (() => Promise<any>) \| LocalDBAdapter` | Optional | Database instance, factory function, or custom adapter. |
| `databaseName` | `string` | Not set | Database filename when auto-opening via `expo-sqlite`. |
| `tables` | `string[]` | `[]` | List of table names to synchronize. |
| `autoSchema` | `boolean` | `false` | When true, automatically creates tables and adds missing columns dynamically on insert/update. |
| `primaryKey` | `string` | `'id'` | Primary key column name used across tables. |
| `migrations` | `string[]` | `[]` | Idempotent SQL executed in a transaction during initialization, before sync starts. |
| `autoStart` | `boolean` | `true` | Start automatic sync after initialization. Set false to queue writes and push/pull manually. |
| `autoInitialize` | `boolean` | `true` | Automatically creates internal outbox tables and initializes the client on startup. |

---

### Sync Performance & Advanced SQLite Policies

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `coalesceOutbox` | `boolean` | `true` | When true, multiple pending mutations for the same row are coalesced into a single outbox record before pushing (e.g. intermediate updates are merged, and an insert followed by an offline delete is discarded), drastically reducing bandwidth. |
| `touchUpdatedAt` | `boolean \| string` | `true` | Stamps an `updated_at` (or specified column name) on every local INSERT/UPDATE write in SQLite so reactive queries (which compare rows by `id` + `updated_at`) immediately detect offline edits. Only the local row is stamped; remote outbox payloads are untouched. |
| `autoPauseOnBackground` | `boolean` | `true` | When true on React Native/Expo, automatically pauses polling intervals and timers when the app moves to the background to conserve device battery and CPU, and resumes immediately upon foregrounding. |
| `jsonColumns` | `Record<string, string[]>` | `{}` | Map of table names to arrays of column names containing JSON data. These columns are automatically serialized to JSON strings on write and parsed back to JavaScript objects/arrays on read. |
| `autoHydrateJSON` | `boolean` | `false` | When true, any string value that begins and ends with `{}` or `[]` is automatically parsed with `JSON.parse` upon query execution. |

---

### Dynamic User Data Isolation & Multi-Tenancy (`syncScope`)

For multi-tenant apps or applications where users should only push and pull records matching their account ID:

```typescript
export const syncConfig = defineSyncConfig({
  database: () => SQLite.openDatabaseAsync('app.db'),
  tables: ['milestones', 'records'],

  // Static user scope:
  syncScope: { user_id: 'user_123' },

  // Or dynamic async scope function:
  syncScope: async () => {
    const user = await authClient.getUser();
    return user ? { user_id: user.id } : {};
  },
});
```

* The active scope is passed down to `remoteAdapter.fetchChanges(since, syncScope)` to filter remote delta queries.
* In Supabase, queries filter matching columns automatically.
* You can update the scope dynamically after login with `client.setSyncScope({ user_id: user.id })`.

---

### Remote Cloud Backends

Provide **one** of the following backend options:

#### `supabase`
```typescript
supabase: {
  url?: string;             // Supabase Project URL (e.g. process.env.EXPO_PUBLIC_SUPABASE_URL)
  anonKey?: string;         // Supabase Anon / Publishable Key
  client?: SupabaseClient;  // Optional pre-instantiated Supabase client
  schema?: string;          // Postgres schema (Default: 'public')
  updatedAtColumn?: string; // Timestamp column for deltas (Default: 'updated_at')
  deletedColumn?: string;   // Column for soft deletes (Default: 'deleted')
  deletedValue?: any;       // Value for deleted rows (Default: true)
  pushRpcName?: string;     // Optional custom RPC name for bulk operations
  channelName?: string;     // Realtime broadcast channel name (Default: 'local_first_sync')
}
```

#### `convex`
```typescript
convex: {
  client: ConvexClient;     // Instantiated ConvexClient
  pushMutation?: any;       // Mutation function/name for pushes (Default: 'sync:pushBatch')
  pullQuery?: any;          // Query function/name for deltas (Default: 'sync:pullDeltas')
  primaryKey?: string;      // Primary key column name (Default: 'id')
  deletedColumn?: string;   // Column for soft deletes (Default: 'deleted')
  updatedAtColumn?: string; // Timestamp column for deltas (Default: 'updatedAt')
}
```

#### `firebase`
```typescript
firebase: {
  firestore: Firestore;     // Modular Firestore instance or @react-native-firebase/firestore
  primaryKey?: string;      // Primary key field (Default: 'id')
  updatedAtColumn?: string; // Timestamp field for delta pulls (Default: 'updatedAt')
  deletedColumn?: string;   // Boolean field for soft deletes (Default: 'deleted')
  firestoreModule?: any;    // Optional reference to modular firebase/firestore SDK
}
```

#### `remote`
Pass an object implementing `RemoteDBAdapter` to connect to custom REST, GraphQL, or WebSocket servers.

#### `inMemoryRemote`
* Type: `boolean` (Default: `false`)
* Missing backend configuration throws unless `inMemoryRemote: true` is explicitly enabled.
* Simulates an in-memory remote backend with 300ms artificial network delay for unit testing and offline development.

---

### Timing, Retry & Exponential Backoff

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `pushIntervalMs` | `number` | `5000` | Periodic timer interval (in ms) to flush pending outbox records to remote. |
| `pullIntervalMs` | `number` | `10000` | Periodic timer interval (in ms) to fetch remote deltas. |
| `maxRetries` | `number` | `5` | Maximum push attempts before a failing mutation is marked as `FAILED`. |
| `retry` | `number \| RetryConfig` | — | Advanced retry settings with exponential backoff and jitter. |

#### Advanced Retry Configuration:
```typescript
retry: {
  maxRetries: Infinity,     // Supports infinite retries for persistent background sync
  initialDelayMs: 1000,     // Delay before the first retry (1 second)
  maxDelayMs: 30000,        // Max ceiling delay (30 seconds)
  backoffMultiplier: 1.5,   // Exponential backoff multiplier
  jitter: true,             // Add randomized jitter to avoid synchronized server stampedes
  shouldRetry: (err, op) => {
    // Only retry transient network/server errors; fail immediately on 400 Bad Request
    if (err?.status === 400) return false;
    return true;
  },
}
```

---

### Logging & Diagnostics

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `logLevel` | `'debug' \| 'info' \| 'warn' \| 'error' \| 'none'` | `'info'` | Minimum log verbosity. |
| `logger` | `SyncLogger \| CustomLogger \| boolean` | Default | Pass `false` to silence all logs, or supply a custom logger (e.g., Sentry, Winston, Datadog). |

#### Custom Logger Example:
```typescript
logger: {
  debug: (msg, ...args) => console.debug('[Sync]', msg, ...args),
  info: (msg, ...args) => console.info('[Sync]', msg, ...args),
  warn: (msg, ...args) => console.warn('[Sync]', msg, ...args),
  error: (msg, ...args) => Sentry.captureMessage(msg),
}
```
