# 💾 Local SQLite Adapters

`local-lite` supports any SQLite driver across mobile, desktop, and web environments.

The configuration helper automatically detects the driver passed to `config.database`. Alternatively, you can import and instantiate any adapter directly.

---

## 1. Expo SQLite (`expo-sqlite`)

Recommended for **Expo & React Native** apps.

```bash
npx expo install expo-sqlite
```

### Auto-Detection via `defineSyncConfig`:
```typescript
import { defineSyncConfig } from 'local-lite/config';
import * as SQLite from 'expo-sqlite';

export const config = defineSyncConfig({
  database: () => SQLite.openDatabaseAsync('my_app.db'),
  tables: ['todos'],
});
```

### Standalone Adapter:
```typescript
import { ExpoSQLiteAdapter } from 'local-lite/expo-sqlite';
import * as SQLite from 'expo-sqlite';

const db = await SQLite.openDatabaseAsync('my_app.db');
const adapter = new ExpoSQLiteAdapter(db);
```

---

## 2. OP-SQLite (`@op-engineering/op-sqlite`)

High-performance JSI SQLite driver for **bare React Native** apps.

```bash
npm install @op-engineering/op-sqlite
```

### Usage:
```typescript
import { defineSyncConfig } from 'local-lite/config';
import { open } from '@op-engineering/op-sqlite';

const db = open({ name: 'my_app.db' });

export const config = defineSyncConfig({
  database: db,
  tables: ['todos'],
});
```

---

## 3. Better-SQLite3 (`better-sqlite3`)

Synchronous, ultra-fast SQLite driver for **Node.js, Electron, Next.js, and server environments**.

```bash
npm install better-sqlite3
```

### Usage:
```typescript
import { defineSyncConfig } from 'local-lite/config';
import Database from 'better-sqlite3';

const db = new Database('my_app.db');

export const config = defineSyncConfig({
  database: db,
  tables: ['todos'],
});
```

---

## 4. Node.js 22+ Built-in (`node:sqlite`)

Zero-dependency SQLite bundled directly inside Node.js v22.5.0+.

### Usage:
```typescript
import { defineSyncConfig } from 'local-lite/config';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('my_app.db');

export const config = defineSyncConfig({
  database: db,
  tables: ['todos'],
});
```

---

## 5. LibSQL / Turso (`@libsql/client`)

Supports edge workers, local files, and embedded replicas via Turso / LibSQL.

```bash
npm install @libsql/client
```

### Usage:
```typescript
import { defineSyncConfig } from 'local-lite/config';
import { createClient } from '@libsql/client';

const client = createClient({
  url: 'file:my_app.db',
});

export const config = defineSyncConfig({
  database: client,
  tables: ['todos'],
});
```

---

## 6. Sql.js (WebAssembly / Browser)

Pure WebAssembly SQLite for client-side web applications and PWAs.

```bash
npm install sql.js
```

### Usage:
```typescript
import { defineSyncConfig } from 'local-lite/config';
import initSqlJs from 'sql.js';

const SQL = await initSqlJs();
const db = new SQL.Database();

export const config = defineSyncConfig({
  database: db,
  tables: ['todos'],
});
```

---

## Custom Local Database Adapters

If you use a custom or proprietary SQLite binding, implement the `LocalDBAdapter` interface:

```typescript
import { LocalDBAdapter, LocalTransaction } from 'local-lite';

export class CustomSQLiteAdapter implements LocalDBAdapter {
  async execute(sql: string, params?: any[]): Promise<any> {
    // Execute query and return result rows
  }

  async transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    // Execute multiple statements atomically
  }

  async close(): Promise<void> {
    // Optional cleanup
  }
}
```
