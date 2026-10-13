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
   - `defineSyncConfig()` and `LocalLiteConfig`
   - Database auto-detection, retries, and logging
4. **[Local SQLite Adapters](./adapters-local.md)**
   - Expo SQLite (`expo-sqlite`)
   - Bare React Native (`@op-engineering/op-sqlite`)
   - Node.js / Electron (`better-sqlite3`)
   - Built-in Node 22+ (`node:sqlite`)
   - Edge / Turso (`@libsql/client`)
   - Web / Browser (`sql.js`)
5. **[Remote Backend Adapters](./adapters-remote.md)**
   - Supabase (Postgres + Realtime)
   - Convex (Reactive documents + RPCs)
   - Firebase / Firestore
   - Memory Demo (Mock testing without cloud)
   - Building custom backend adapters
6. **[React & React Native Hooks](./react-hooks.md)**
   - `useLiveQuery()`: Zero-SQL live query hook
   - `useSyncStatus()`: Real-time sync engine & queue status inspector
7. **[Conflict Resolution](./conflict-resolution.md)**
   - Last-Write-Wins (LWW)
   - Client-Wins & Server-Wins
   - Custom conflict resolvers

---

## 💡 Core Philosophy

* **Local-First By Default:** The app writes to and reads from local SQLite first. Operations never stall on slow cell connections or outages.
* **Guaranteed Durability:** Every mutate operation executes in an atomic transaction that updates the user table and inserts a mutation into `sync_outbox` simultaneously. If the device restarts or loses power, pending changes are never lost.
* **Zero Lock-In:** Switch seamlessly between Supabase, Convex, Firestore, or your own REST/GraphQL server without rewriting your UI layer.
