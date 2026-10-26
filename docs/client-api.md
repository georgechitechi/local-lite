# 💻 Client API & Query Builder

The `LocalFirstClient` is the core synchronization and database interface for `local-lite`. It manages local SQLite operations, the transactional outbox queue, background synchronization, and reactive listeners.

```typescript
import { LocalFirstClient } from 'local-lite';
// or from 'local-lite/config' via createSyncClient(config)
```

---

## 1. Lifecycle & Connection Management

### `client.initialize(): Promise<void>`
Initializes SQLite storage: sets PRAGMA modes (WAL, synchronous NORMAL), ensures internal tables (`sync_outbox`, `sync_meta`), runs configured migrations, creates tables if `autoSchema: true`, and starts background sync loops if `autoStart: true`.
Safe to call concurrently or repeatedly.

```typescript
await client.initialize();
console.log('Client ready:', client.isReady);
```

### `client.stop(): void`
Pauses all background sync loops, intervals, and network event listeners. Queued mutations remain safe in the outbox.

```typescript
client.stop();
```

### `client.close(): Promise<void>`
Stops sync workers, destroys remote subscriptions, and closes the local SQLite connection, safely releasing native database locks.

```typescript
await client.close();
```

### `client.reset(options?: { dropTables?: boolean }): Promise<void>`
Resets local state by stopping sync, deleting or dropping all managed tables, clearing `sync_outbox` and `sync_meta`, and resetting the sync watermark cursor.

```typescript
// Clear all rows from managed tables and reset outbox
await client.reset();

// Or completely drop all tables from SQLite
await client.reset({ dropTables: true });
```

---

## 2. Atomic Dual-Write Mutations (CRUD)

Every write operation executes inside an atomic SQLite transaction that modifies the target table and appends a record to `sync_outbox` simultaneously.

### `client.insert(table, payload, options?): Promise<string>`
Inserts a record and generates a UUID v4 if an `id` is not provided.

```typescript
// Auto-generated UUID
const todoId = await client.insert('todos', {
  title: 'Review PR',
  completed: 0,
});

// Explicit ID
await client.insert('todos', 'custom-uuid-123', {
  title: 'Custom ID Item',
  completed: 0,
});
```

### `client.insertMany(table, records, options?): Promise<string[]>`
Inserts multiple records in a single atomic database transaction.

```typescript
const ids = await client.insertMany('todos', [
  { title: 'Task 1', completed: 0 },
  { title: 'Task 2', completed: 1 },
]);
```

### `client.update(table, id, payload, options?): Promise<void>`
Updates an existing record by its primary key.

```typescript
await client.update('todos', todoId, {
  completed: 1,
});
```

### `client.updateMany(table, updates, options?): Promise<void>`
Updates multiple records atomically in a single transaction.

```typescript
await client.updateMany('todos', [
  { id: 'id-1', payload: { completed: 1 } },
  { id: 'id-2', payload: { completed: 0 } },
]);
```

### `client.delete(table, id, options?): Promise<void>`
Deletes a record by its primary key.

```typescript
await client.delete('todos', todoId);
```

### `client.mutate(table, id, operation, payload, options?): Promise<void>`
Low-level atomic dual-write method:

```typescript
await client.mutate('todos', 'todo-1', 'UPDATE', { completed: 1 }, {
  skipOutbox: false,        // Set true to skip cloud sync (local only)
  customTimestamp: Date.now(), // Override mutation timestamp
});
```

### `client.trackMutation(table, id, operation, payload, options?): Promise<string>`
Appends a mutation to `sync_outbox` without modifying the local table. Useful when performing custom raw SQL operations that need to be synchronized with the remote backend.

---

## 3. Atomic Batches & Custom Transactions

### `client.batch(mutations, options?): Promise<string[]>`
Executes multiple diverse operations across multiple tables atomically.

```typescript
await client.batch([
  {
    tableName: 'projects',
    rowId: 'proj-1',
    operation: 'INSERT',
    payload: { name: 'Mobile App' },
  },
  {
    tableName: 'tasks',
    operation: 'INSERT',
    payload: { project_id: 'proj-1', title: 'Setup Expo' },
  },
  {
    tableName: 'notifications',
    rowId: 'notif-99',
    operation: 'DELETE',
  },
]);
```

### `client.transaction(action): Promise<T>`
Executes an arbitrary callback inside an ACID transaction with a scoped `TransactionalClient`. If an error is thrown, all SQLite changes and outbox records roll back, and no change events are emitted.

```typescript
await client.transaction(async (txClient) => {
  await txClient.insert('accounts', { id: 'acc-1', balance: 500 });
  await txClient.update('transfers', 'tr-1', { status: 'COMPLETED' });
});
```

---

## 4. Reading Data & Declarative Queries

### `client.findById(table, id, options?): Promise<T | null>`
Fetches a single record by its primary key. Excludes soft-deleted records by default.

```typescript
const todo = await client.findById('todos', 'todo-1');
// Include soft-deleted rows:
const deletedTodo = await client.findById('todos', 'todo-1', { includeDeleted: true });
```

### `client.findByIds(table, ids, options?): Promise<T[]>`
Fetches multiple records by their primary keys in a single `WHERE id IN (...)` query.

```typescript
const items = await client.findByIds('todos', ['todo-1', 'todo-2', 'todo-3']);
```

### `client.findMany(table, options?): Promise<T[]>`
Fetches records matching declarative filtering and sorting options.

```typescript
const activeWork = await client.findMany('tasks', {
  where: {
    completed: 0,
    priority: { $gte: 2 },
    tags: { $contains: 'urgent' },
  },
  orderBy: 'due_date',
  order: 'asc',
  limit: 25,
  offset: 0,
});
```

### Supported Query Operators:

| Operator | Syntax | Description | Example |
| :--- | :--- | :--- | :--- |
| **`$eq`** | `{ col: { $eq: val } }` or `{ col: val }` | Equal to | `{ status: 'ACTIVE' }` |
| **`$ne`** | `{ col: { $ne: val } }` | Not equal to | `{ status: { $ne: 'DELETED' } }` |
| **`$gt` / `$gte`** | `{ col: { $gt: val } }` | Greater than (or equal) | `{ age: { $gte: 18 } }` |
| **`$lt` / `$lte`** | `{ col: { $lt: val } }` | Less than (or equal) | `{ price: { $lte: 99.99 } }` |
| **`$in`** | `{ col: { $in: [a, b] } }` | In set | `{ role: { $in: ['admin', 'manager'] } }` |
| **`$nin`** | `{ col: { $nin: [a, b] } }` | Not in set | `{ status: { $nin: ['archived'] } }` |
| **`$like`** | `{ col: { $like: '%term%' } }` | SQL LIKE pattern | `{ name: { $like: 'John%' } }` |
| **`$contains`** | `{ col: { $contains: 'word' } }` | Case-insensitive substring | `{ email: { $contains: '@gmail' } }` |
| **`$between`** | `{ col: { $between: [min, max] } }` | Between range (inclusive) | `{ score: { $between: [70, 100] } }` |
| **`$isNull`** | `{ col: { $isNull: true } }` | IS NULL | `{ deleted_at: { $isNull: true } }` |
| **`$isNotNull`** | `{ col: { $isNotNull: true } }` | IS NOT NULL | `{ verified_at: { $isNotNull: true } }` |
| **`$or`** | `{ $or: [condA, condB] }` | Logical OR | `{ $or: [{ role: 'admin' }, { points: { $gt: 100 } }] }` |
| **`$and`** | `{ $and: [condA, condB] }` | Logical AND | `{ $and: [{ active: 1 }, { verified: 1 }] }` |

---

## 5. Fluent SQL QueryBuilder (`client.from()`)

Build optimized relational queries with joins, grouping, and method chaining:

```typescript
const report = await client
  .from('orders')
  .select(
    'orders.id',
    'orders.total',
    'customers.name AS customer_name',
    'customers.email'
  )
  .join('customers', 'orders.customer_id', 'customers.id')
  .leftJoin('discounts', 'orders.discount_id', 'discounts.id')
  .where({
    'orders.status': 'COMPLETED',
    'orders.total': { $gte: 100 },
  })
  .orderBy('orders.created_at', 'desc')
  .limit(50)
  .execute();
```

---

## 6. Native SQL Aggregations

Compute metrics natively in SQLite without fetching all rows into memory:

### Simple Aggregates:
```typescript
const totalUsers = await client.count('users', { where: { active: 1 } });
const totalRevenue = await client.sum('orders', 'total', { where: { status: 'PAID' } });
const avgRating = await client.avg('reviews', 'rating');
```

### Multi-Metric Aggregation:
Calculate count, sums, averages, minimums, and maximums in a single query:

```typescript
const stats = await client.aggregate('receipts', {
  where: { business_id: 'biz_01' },
  count: true,
  sum: ['amount', 'tax', 'discount'],
  avg: ['amount'],
  min: ['created_at'],
  max: ['amount'],
});

console.log(stats.count);        // e.g. 150
console.log(stats.sum?.amount);   // e.g. 4520.50
console.log(stats.avg?.amount);   // e.g. 30.14
console.log(stats.max?.amount);   // e.g. 500.00
```

---

## 7. Direct Raw SQL (`client.query`)

Execute arbitrary SQL statements directly on SQLite with bound parameters:

```typescript
const result = await client.query(`
  SELECT
    strftime('%Y-%m', created_at) AS month,
    COUNT(*) AS total_count,
    SUM(amount) AS monthly_revenue
  FROM invoices
  WHERE deleted = 0
  GROUP BY month
  ORDER BY month DESC
`);
```

---

## 8. JSON Columns & Auto-Hydration

SQLite stores JSON as text strings. `local-lite` supports automatic serialization on write and auto-deserialization on read:

```typescript
export const client = new LocalFirstClient({
  local: dbAdapter,
  remote: remoteAdapter,
  // Automatically deserialize specific table columns
  jsonColumns: {
    patients: ['allergies', 'emergency_contacts', 'metadata'],
    milestones: ['measurements'],
  },
  // Or automatically hydrate any column containing valid JSON object/array strings
  autoHydrateJSON: true,
});

// Write normal JavaScript objects:
await client.insert('patients', {
  name: 'Jane Doe',
  allergies: ['Penicillin', 'Peanuts'],
});

// Read automatically returns arrays/objects, not JSON strings:
const patient = await client.findById('patients', id);
console.log(Array.isArray(patient.allergies)); // true
```

---

## 9. Dynamic Multi-Tenant User Data Isolation (`syncScope`)

For multi-tenant apps or applications where users should only pull and push their own data:

```typescript
export const client = new LocalFirstClient({
  local: dbAdapter,
  remote: remoteAdapter,
  // Static scope:
  syncScope: { user_id: 'user_abc123' },

  // Or dynamic async scope function:
  syncScope: async () => {
    const session = await authClient.getUser();
    return session ? { user_id: session.id, organization_id: session.orgId } : {};
  },
});

// Update tenant or active user dynamically upon login or switch:
client.setSyncScope({ user_id: 'new_user_456' });
```

---

## 10. Outbox Inspection & Telemetry

Inspect and control the transactional outbox:

```typescript
// 1. Get real-time performance telemetry
const metrics = await client.getMetrics();
console.log(metrics.totalPushedMutations);
console.log(metrics.totalPulledDeltas);
console.log(metrics.lastPushDurationMs);
console.log(metrics.lastPullDurationMs);

// 2. Fetch pending or failed outbox records
const records = await client.getOutboxRecords({
  status: 'FAILED',
  limit: 50,
});

// 3. Retry failed mutations (resets status to PENDING and triggers immediate push)
await client.retryFailedMutations();

// 4. Remove poison-pill mutations permanently
await client.clearFailedMutations();

// 5. Inspect and reset pull cursor
const lastSyncedAt = await client.getLastSyncedAt();
await client.resetSyncCursor(); // Forces next pull to re-fetch all cloud data
```

---

## 11. Action Outbox & Email Queue (`client.actions`)

Enqueues asynchronous actions (emails, notifications, webhooks) with offline durability, idempotency deduplication, and automatic retries.

```typescript
// Enqueue an email offline (instant 0ms local write)
const emailAction = await client.actions.sendEmail({
  to: 'customer@example.com',
  subject: 'Order Confirmed',
  html: '<h1>Thank you!</h1>',
  idempotencyKey: 'order_123',
  ttlMs: 24 * 60 * 60 * 1000,
});

// Register an email dispatcher
client.actions.registerEmailHandler(async (email) => {
  const res = await sendWithProvider(email);
  return { messageId: res.id };
});

// Enqueue generic offline actions
await client.actions.enqueue({
  action: 'push_notification',
  payload: { title: 'New message', token: 'fcm-xxx' },
});

// Flush pending actions immediately
await client.actions.flush();

// Query, cancel, or prune actions
const action = await client.actions.get(emailAction.id);
await client.actions.cancel(emailAction.id);
await client.actions.prune({ completedOlderThanMs: 86400000 });
```

See the dedicated [**Action Outbox & Email Queue Guide**](./actions-email.md) for full architecture, cloud function integration, and options reference.
