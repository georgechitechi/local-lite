# ⚡ local-lite Documentation

Welcome to the official documentation for **`local-lite`**, a lightweight, vendor-agnostic **local-first synchronization engine** for React Native, Expo, Web, and Node.js applications.

---

## 📚 Documentation Index

1. **[Getting Started](./getting-started.md)**
   - Installation & peer dependencies
   - 5-minute Quickstart with SQLite & Cloud
2. **[Architecture & Concepts](./architecture.md)**
   - The Transactional Outbox Pattern
   - 0ms local reads & writes
   - SyncWorker pipeline & infinite loop safety
3. **[Configuration Reference](./configuration.md)**
   - `defineSyncConfig()` and `LocalLiteConfig` options
   - User data isolation (`syncScope`), outbox coalescing, JSON auto-hydration, and advanced retry policies
4. **[Client API & Query Builder](./client-api.md)**
   - Atomic dual-write CRUD (`insert`, `update`, `delete`, `mutate`, `trackMutation`)
   - Batches (`batch`) and custom transactions (`transaction`)
   - Fluent `QueryBuilder` (`from`, `select`, `join`, `where`, `groupBy`, `orderBy`)
   - Native SQL aggregations (`count`, `sum`, `avg`, `aggregate`)
   - Telemetry & outbox management (`getMetrics`, `retryFailedMutations`, `clearFailedMutations`)
5. **[Fast Key-Value & Encrypted Preferences](./kv.md)**
   - Typed storage for strings, numbers, booleans, and JSON objects (`client.kv`)
   - TTL expiration with lazy cleanup and batch pruning
   - Zero-Knowledge client-side encrypted secrets (AES-256-GCM + PBKDF2)
   - Reactive `useKV()` React hook
6. **[Instant Full-Text Search](./search.md)**
   - Native SQLite FTS5 engine integration (`client.search`)
   - Prefix matching, BM25 ranking, and highlighted `<mark>` snippets
   - Reactive `useSearch()` React hook with automatic debouncing
7. **[Offline Media & Blob Storage](./storage.md)**
   - Decoupled binary storage from SQLite table queries (`client.storage`)
   - Local filesystem and in-memory file drivers with SHA-256 integrity verification
   - Background cloud sync queue for S3, Supabase, Cloudinary, and Firebase Storage
8. **[Offline Job Scheduler & Background Cron](./scheduler.md)**
   - Persistent offline job scheduling surviving app restarts (`client.scheduler`)
   - Human expressions (`'daily'`, `'hourly'`, `'every 15 minutes'`) and 5-part cron
   - Run history tracking, duration telemetry, and automatic error logging
9. **[Local SQLite Adapters](./adapters-local.md)**
   - Expo SQLite (`expo-sqlite`)
   - Bare React Native (`@op-engineering/op-sqlite`)
   - Node.js / Electron (`better-sqlite3`)
   - Built-in Node 22+ (`node:sqlite`)
   - Edge / Turso (`@libsql/client`)
   - Web / Browser (`sql.js`)
10. **[Remote Backend Adapters](./adapters-remote.md)**
    - Supabase (Postgres + Realtime)
    - Convex (Reactive documents + RPCs)
    - Firebase / Firestore
    - Memory Demo (Mock testing without cloud)
    - Building custom backend adapters
11. **[React & Expo Hooks](./react-hooks.md)**
    - `useLiveQuery()`: Zero-SQL single table reactive query
    - `useLiveQueries()`: Parallel multi-table queries with single atomic commit
    - `useLiveRow()`: Targeted single-record live query with row-level invalidation
    - `useLiveInfiniteQuery()`: Paginated infinite scrolling live query
    - `useKV()`: Reactive state binding for key-value preferences
    - `useSearch()`: Debounced instant full-text search hook
    - `useMutations()`: Null-safe memoized mutation helper methods
    - `useSyncStatus()`: Real-time sync engine & outbox queue inspector
    - `useDatabaseMaintenance()`: Reactive storage stats, outbox pruning, VACUUM, and WAL checkpoints
    - `<SyncInspector />` and `<BenchmarkModal />`: Developer UI debugging tools
12. **[Authentication (Google, Microsoft, GitHub, Apple)](./auth.md)**
    - Zero-backend OAuth 2.0 PKCE authentication
    - Automatic token refreshing & user profile fetching
    - Microsoft Graph & OneDrive integration
    - GitHub OAuth with verified email resolution
    - Sign in with Apple (Native iOS & OAuth)
    - Pluggable storage adapters (AsyncStorage, SecureStore, MMKV)
13. **[Google Sign-In & Drive Guide](./google-auth.md)**
    - Dedicated guide for zero-backend Google authentication
    - Unified Google Drive cloud backup synergy
14. **[Conflict Resolution & Field Merge](./conflict-resolution.md)**
    - Smart 3-Way field-level merge (`createFieldMergeResolver`)
    - Last-Write-Wins (LWW)
    - Client-Wins & Server-Wins
    - Custom conflict resolvers
15. **[Database Backups & Zero-Knowledge Encryption](./backups.md)**
    - Google Drive and Microsoft OneDrive sandboxed backups
    - Zero-Knowledge client-side encryption (AES-256-GCM + PBKDF2)
    - React backup hooks (`useGoogleDriveBackup`, `useOneDriveBackup`)
    - Universal binary database snapshots (`exportDatabase`, `importDatabase`)
16. **[Maintenance & Data Portability](./maintenance-portability.md)**
    - Storage breakdown, outbox pruning, VACUUM, and WAL checkpoints
    - PRAGMA analyze and structural integrity checks
    - Universal JSON & RFC-4180 CSV export and import
17. **[Action Outbox & Email Queue](./actions-email.md)**
    - 0ms offline transactional email enqueuing
    - Generic action dispatchers (push notifications, webhooks, analytics)
    - Idempotency deduplication, TTL expiration, and crash recovery
18. **[API Keys & Signed Tokens](./api-keys.md)**
    - Checksummed API key generation & verification (Stripe/GitHub pattern)
    - HMAC-SHA256 signed tokens with expiration and renewal
    - Local SQLite API key manager (`client.keys`)

---

## 💡 Core Philosophy

* **Local-First By Default:** The app writes to and reads from local SQLite first. Operations never stall on slow cell connections or outages.
* **Guaranteed Durability:** Every mutate operation executes in an atomic transaction that updates the user table and inserts a mutation into `sync_outbox` simultaneously. If the device restarts or loses power, pending changes are never lost.
* **Zero Lock-In:** Switch seamlessly between Supabase, Convex, Firestore, or your own REST/GraphQL server without rewriting your UI layer.
