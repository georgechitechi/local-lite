# ⚙️ Configuration Reference

The configuration engine uses `defineSyncConfig(config)` to provide full TypeScript autocompletion and compile-time validation.

```typescript
import { defineSyncConfig } from 'local-lite/config';
```

---

## `LocalLiteConfig` Options

### Database & Tables

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
Pass an object implementing `RemoteDBAdapter` to bypass built-in cloud providers and connect to custom REST or GraphQL APIs.

#### `inMemoryRemote`
* Type: `boolean`
* Default: `false`. Missing backend configuration throws unless demo mode is explicitly enabled.
* When enabled without cloud credentials, simulates an in-memory remote server with artificial network delays (300ms) for testing offline-first workflows locally without any cloud setup.

---

### Timing & Retry Policies

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `pushIntervalMs` | `number` | `5000` | Periodic timer interval (in ms) to flush pending outbox records to remote. |
| `pullIntervalMs` | `number` | `10000` | Periodic timer interval (in ms) to fetch remote deltas. |
| `maxRetries` | `number` | `5` | Maximum push attempts before a failing mutation is marked or paused. |
| `retry` | `number \| RetryConfig` | — | Advanced retry settings with exponential backoff and jitter. |

#### Advanced Retry Configuration
```typescript
retry: {
  maxRetries: Infinity,     // Supports infinite retries for reliable background syncing
  initialDelayMs: 1000,     // Delay before the first retry (1 second)
  maxDelayMs: 30000,        // Max ceiling delay (30 seconds)
  backoffMultiplier: 1.5,   // Exponential multiplier
  jitter: true,             // Add randomized jitter to prevent thundering herd
  shouldRetry: (err, operation) => true, // Custom function to decide whether an error is retryable
}
```

---

### Logging & Diagnostics

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `logLevel` | `'debug' \| 'info' \| 'warn' \| 'error' \| 'none'` | `'info'` | Minimum log verbosity. |
| `logger` | `SyncLogger \| CustomLogger \| boolean` | Default | Pass `false` to silence all logs, or supply a custom logger (e.g., Winston, Sentry, Datadog). |

#### Custom Logger Example
```typescript
logger: {
  debug: (msg, ...args) => console.debug('[MyLog]', msg, ...args),
  info: (msg, ...args) => console.info('[MyLog]', msg, ...args),
  warn: (msg, ...args) => console.warn('[MyLog]', msg, ...args),
  error: (msg, ...args) => Sentry.captureMessage(msg),
}
```

## Lifecycle and adapter boundaries

For an explicit adapter-only setup, import `LocalFirstClient` and adapter types
from `local-lite/core`. The `local-lite/config` factory retains optional provider
conveniences. See the README compatibility notes for changed defaults.

With `autoInitialize: false`, call `await client.initialize()` before using storage.
Configured migrations still run during that call. Concurrent calls share the same
initialization; a failure can be retried. To resume after `client.stop()`, use
`client.syncWorker.start()`. `autoStart: false` disables automatic push scheduling
as well as polling and subscriptions until start is called.

The library retains failed outbox writes for inspection/retry or explicit
`clearFailedMutations()` calls. Application-specific error handling, authentication,
account switching, reloads, and schema policies belong to the consuming app.
