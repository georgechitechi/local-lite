---
name: local-lite-schema
description: Design schemas, write migrations, configure cascading deletions, and build queries in local-lite. Use when defining foreign key relationships with onDelete (cascade, restrict, setNull), writing schemaMigrations, enabling touchUpdatedAt, setting up SQLite FTS5 search, or using query operators.
---

# local-lite Schema, Migrations & Queries

Guide for schema design, migrations, relationship management, and query execution in `local-lite`.

---

## 1. Schema Conventions

Every synchronized table in `local-lite` requires two mandatory columns:
* `id TEXT PRIMARY KEY`: Typically an RFC4122 v4 UUID generated via `generateUUID()`.
* `updated_at INTEGER NOT NULL`: Epoch millisecond timestamp (`Date.now()`).

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

---

## 2. Foreign Key Relationships & Cascading Deletions (`onDelete`)

Configure declarative relationship metadata directly in your client configuration so deletions automatically cascade or enforce integrity:

```typescript
import { defineSyncConfig } from 'local-lite/config';

export const syncConfig = defineSyncConfig({
  database: () => SQLite.openDatabaseAsync('app.db'),
  tables: ['projects', 'tasks', 'comments'],

  relationships: [
    {
      parentTable: 'projects',
      childTable: 'tasks',
      foreignKey: 'project_id',
      onDelete: 'cascade', // When a project is deleted, all its tasks are deleted
    },
    {
      parentTable: 'tasks',
      childTable: 'comments',
      foreignKey: 'task_id',
      onDelete: 'cascade', // Cascades down multiple levels
    },
    {
      parentTable: 'users',
      childTable: 'tasks',
      foreignKey: 'assignee_id',
      onDelete: 'setNull', // Sets task.assignee_id = NULL if user is removed
    },
  ],
});
```

### Supported `onDelete` Actions:
* `'cascade'`: Deletes all matching child records when the parent record is deleted.
* `'restrict'`: Throws an error preventing parent deletion if child records exist.
* `'setNull'`: Updates the foreign key column on child records to `NULL`.
* `'noAction'`: Leaves child records intact without performing automated changes.

---

## 3. Schema Migrations (`schemaMigrations`)

Migrations are managed via the append-only `schemaMigrations` array. Applied versions are tracked in SQLite in the `_migrations` internal table.

```typescript
schemaMigrations: [
  {
    version: 1,
    up: [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );`,
    ],
  },
  {
    version: 2,
    up: [
      // Add a column or index in a new version
      `ALTER TABLE users ADD COLUMN display_name TEXT;`,
      `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`,
    ],
  },
]
```

### Rules:
1. **Never edit an applied migration**: Modifying an existing migration version causes version drift. Always append a new `{ version: N + 1, up: [...] }`.
2. **Idempotence**: Prefer `IF NOT EXISTS` for table and index creation.

---

## 4. Automatic Timestamp Maintenance (`touchUpdatedAt`)

Ensure `updated_at` timestamps are always refreshed on every write by enabling `touchUpdatedAt`:

```typescript
export const syncConfig = defineSyncConfig({
  // Automatically updates updated_at on all mutations
  touchUpdatedAt: true,

  // Or customize the timestamp column name
  // touchUpdatedAt: 'modified_at',
});
```

---

## 5. Full-Text Search (SQLite FTS5)

Enable lightning-fast full-text search using SQLite's FTS5 virtual tables:

```typescript
// 1. Create the FTS5 virtual table in a schema migration
schemaMigrations: [
  {
    version: 3,
    up: [
      `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        title,
        content,
        content='notes',
        content_rowid='rowid'
      );`,
    ],
  },
]

// 2. Perform searches using client.search()
const results = await client.search('notes_fts', 'react native offline');

// 3. Or use the reactive React hook:
const { results, isSearching } = useSearch(client, 'notes_fts', searchQuery);
```

---

## 6. Query Builder & Complex Operators

Execute filtered queries with MongoDB-like declarative operators using `queryBuilder` or `useQueryBuilder`:

```typescript
const tasks = await client.query('tasks', {
  status: { $in: ['todo', 'in_progress'] },
  priority: { $gte: 2 },
  title: { $like: '%release%' },
}, {
  orderBy: { updated_at: 'DESC' },
  limit: 20,
});
```

### Supported Operators:
* `$eq`, `$ne`: Equal, Not Equal
* `$gt`, `$gte`: Greater Than, Greater Than or Equal
* `$lt`, `$lte`: Less Than, Less Than or Equal
* `$in`, `$nin`: In Array, Not In Array
* `$like`: SQL LIKE pattern matching
* `$null`: Is NULL or Not NULL (`{ deleted_at: { $null: true } }`)

