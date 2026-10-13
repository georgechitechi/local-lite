# 🏛️ Architecture & Concepts

`local-lite` is designed around the **Transactional Outbox Pattern**, a proven distributed systems architecture adapted for client applications.

---

## The System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       React / React Native UI               │
│                                                             │
│   useLiveQuery()                            useSyncStatus() │
└────────▲──────────────────────────────────────────▲─────────┘
         │ (Events: change:table)                   │ (Events: sync:status)
┌────────┴──────────────────────────────────────────┴─────────┐
│                      EventEmitter                           │
└────────▲──────────────────────────────────────────▲─────────┘
         │ (Emit)                                   │ (Emit)
┌────────┴──────────────────────────────────────────┴─────────┐
│                    LocalFirstClient                         │
│                                                             │
│   insert() / update() / delete() / mutate()                 │
└────────┬──────────────────────────────────────────┬─────────┘
         │ (Atomic Transaction)                     │ (Wakeup)
         ▼                                          ▼
┌─────────────────────────┐            ┌──────────────────────┐
│   Local SQLite Engine   │            │      SyncWorker      │
│                         │            │                      │
│ ┌─────────────────────┐ │            │ 1. Push Outbox items │
│ │ User Table (todos)  │ │            │ 2. Fetch remote logs │
│ ├─────────────────────┤ │            │ 3. Resolve conflicts │
│ │ sync_outbox (queue) │◄┼────────────┤ 4. Update Meta Store │
│ ├─────────────────────┤ │            └──────────┬───────────┘
│ │ sync_meta   (state) │ │                       │
│ └─────────────────────┘ │                       │
└─────────────────────────┘                       ▼
                                       ┌──────────────────────┐
                                       │    Remote Adapter    │
                                       │  (Supabase / Convex) │
                                       └──────────────────────┘
```

---

## 1. Atomic Dual-Write (The Transactional Outbox)

In standard apps, if an API call fails after a state update, or if the user closes the app mid-flight, local state and remote state become desynchronized.

`local-lite` solves this by executing a single SQLite atomic transaction whenever `client.mutate()` is called:
1. **User Table Update:** Writes the record to the table (e.g. `INSERT INTO todos ...`).
2. **Outbox Entry:** Simultaneously appends a log to the internal `sync_outbox` table:
   - `id`: Unique mutation UUID
   - `tableName`: Table modified
   - `rowId`: Primary key affected
   - `operation`: `'INSERT'`, `'UPDATE'`, or `'DELETE'`
   - `payload`: JSON data
   - `timestamp`: Mutation timestamp

Because both operations occur inside the same SQLite transaction:
- If the app crashes or the battery dies, both commit or both roll back together.
- Pending mutations remain safely in SQLite until successfully acknowledged by the server.

---

## 2. The SyncWorker Pipeline

The `SyncWorker` is a background coordination engine that executes two main loops:

### Push Loop
1. Reads pending records from `sync_outbox` sorted by timestamp.
2. Formats mutations into a batch.
3. Invokes `remoteAdapter.pushChanges(batch)`.
4. Upon successful server acknowledgment, deletes the processed records from `sync_outbox`.
5. If the server fails or returns a network error, applies exponential backoff and leaves the outbox untouched.

### Pull Loop
1. Reads the latest sync watermark timestamp from the internal `sync_meta` table.
2. Calls `remoteAdapter.fetchChanges(tables, sinceTimestamp)`.
3. For each delta received from the server:
   - Evaluates the configured **ConflictResolver**.
   - If the server change wins, writes the delta into local SQLite.
4. Updates the high-watermark timestamp in `sync_meta`.
5. Emits table change events to re-render any active `useLiveQuery()` components.

---

## 3. Infinite-Loop Prevention

A common bug in bidirectional sync engines is "mutation echo":
`Remote pull -> Writes to local DB -> Outbox mistakenly thinks user created a new record -> Pushes back to remote`.

`local-lite` avoids this entirely:
- **Direct internal writes:** When `SyncWorker` applies incoming deltas, it bypasses the `client.mutate()` outbox pathway and executes direct SQLite SQL updates.
- **Event firing:** It triggers `events.emit('change:tableName')` so your UI updates reactively, without appending any records to `sync_outbox`.

---

## 4. Offline Resilience & Network Awareness

- `local-lite` ships with a network listener (`DefaultNetworkStatusProvider` or `@react-native-community/netinfo`).
- When offline:
  - Local queries and mutations execute with **0ms latency**.
  - Periodic network calls are paused to conserve battery and CPU.
- When connectivity restores:
  - The network listener detects the change and triggers an **immediate outbox flush**.
