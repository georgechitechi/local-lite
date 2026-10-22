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

## Database Backups

The `local-lite/backups` entry point creates SQLite snapshots from database bytes supplied
by your platform adapter. Its Google Drive backup client handles OAuth authorization-code
+ PKCE, code exchange, token refresh, and file storage.
The app supplies its OAuth client ID, callback URI/browser authorization, and secure token
storage; these platform-specific capabilities cannot safely be assumed by a
framework-neutral package. Backups do not alter or replace the remote adapter used for
live synchronization.

```typescript
import {
  createDatabaseBackup,
  GoogleDriveBackupClient,
  createGoogleDriveTokenStore,
} from 'local-lite/backups';

const tokenStore = createGoogleDriveTokenStore(secureKeyValueStorage);
const drive = new GoogleDriveBackupClient({
  clientId: googleOAuthClientId,
  redirectUri,
  authorize: openAuthorizationUrlInSystemBrowser,
  tokenStore,
});

await drive.connect();
await createDatabaseBackup(database, drive);
```

The `authorize` callback opens the supplied `authorizationUrl` and returns the
authorization `code` and `state` from the registered `redirectUri`, or `null` if the user
cancels. The client validates the OAuth state and performs the PKCE code exchange.
`tokenStore` implements `get`, `set`, and `remove`; use your platform's secure credential
storage, not plain preferences. The client refreshes expired tokens automatically, and its
`list()` method returns backup metadata for restore-selection screens. For apps that
already manage OAuth, `GoogleDriveBackupStorage` remains available and accepts an
access-token callback.

For example, an Expo app can provide the browser and secure-store bridges:

```typescript
const tokenStore = createGoogleDriveTokenStore(secureStorage, 'drive-backup-tokens');
const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID;
if (!googleClientId) throw new Error('Google Drive OAuth client ID is required.');

const drive = new GoogleDriveBackupClient({
  clientId: googleClientId,
  redirectUri: makeRedirectUri({ scheme: 'myapp', path: 'oauth' }),
  tokenStore,
  authorize: async ({ authorizationUrl, redirectUri }) => {
    const result = await WebBrowser.openAuthSessionAsync(
      authorizationUrl,
      redirectUri,
    );
    if (result.type !== 'success') return null;

    const callback = new URL(result.url);
    return {
      code: callback.searchParams.get('code') ?? '',
      state: callback.searchParams.get('state') ?? '',
    };
  },
});
```

Register the exact redirect URI with the Google OAuth client. OAuth client IDs and
redirect behavior differ by target platform; no generic library can register the app or
create those provider credentials on the developer's behalf.

```typescript
import {
  createDatabaseBackup,
  restoreDatabaseBackup,
  type BackupDatabase,
  type BackupStorage,
} from 'local-lite/backups';

const database: BackupDatabase = {
  exportDatabase: () => sqliteDatabase.serializeAsync(),
  importDatabase: async bytes => {
    // Validate and restore using the SQLite driver's platform-specific backup APIs.
    await restoreSQLiteSnapshot(sqliteDatabase, bytes);
  },
};

const storage: BackupStorage = {
  save: async (name, bytes) => writeIntoPrivateBackupsDirectory(name, bytes),
  read: async name => readFromPrivateBackupsDirectory(name),
};

const name = await createDatabaseBackup(database, storage);
await restoreDatabaseBackup(database, storage, name);
```

Backups are stored as plain `.db` files, so anyone with access to the cloud file can read
the database. Use this only when that exposure is acceptable and protect access through
the cloud account. Stop concurrent writes and synchronization before restoring, and use
the platform's database backup API rather than replacing a live SQLite file directly.
