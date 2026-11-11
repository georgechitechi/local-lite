---
name: local-lite-setup
description: Set up the local-lite local-first SQLite sync engine in a React / React Native / Expo / Web / Node app. Use when adding local-lite, writing a sync config with defineSyncConfig, schemaMigrations, configuring local authentication, foreign key cascading deletions, cloud backups, or wiring useLiveQuery and useLocalAuth.
---

# local-lite setup

Guide for initializing and configuring `local-lite` across mobile (iOS/Android), web (React/SPA), and desktop/backend (Node.js/Electron).

## 1. Installation

Install `local-lite` and the appropriate SQLite driver for your target platform:

```bash
# Expo / React Native
npx expo install local-lite expo-sqlite

# Node.js / Electron / Desktop
npm install local-lite better-sqlite3 # or @libsql/client
```

If connecting to a remote backend, also install the matching client SDK:
* **Supabase**: `@supabase/supabase-js`
* **Convex**: `convex`
* **Firestore**: `firebase`

---

## 2. Platform Bundler Setup (Expo & Web)

If targeting **Expo Web**, configure `metro.config.js` to support WebAssembly SQLite (`wa-sqlite.wasm`) and avoid dual React resolutions in monorepos:

```javascript
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Enable WebAssembly (.wasm) for expo-sqlite on the web
config.resolver.assetExts.push('wasm');

// Handle web vs native react-native module aliasing
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'react-native') {
    return context.resolveRequest(context, 'react-native-web', platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
```

In `app.json`, set client-side single-page output for the web:
```json
{
  "expo": {
    "web": {
      "output": "single"
    }
  }
}
```

---

## 3. Configuration (`sync.config.ts`)

Create a singleton client configuration with `defineSyncConfig` and `createSyncClient`:

```typescript
import * as SQLite from 'expo-sqlite';
import { defineSyncConfig, createSyncClient, type LocalFirstClient } from 'local-lite/config';

export const syncConfig = defineSyncConfig({
  // 1. Local Database instance or factory
  database: () => SQLite.openDatabaseAsync('app.db'),

  // 2. Synced table names
  tables: ['todos', 'projects'],

  // 3. Schema Migrations (strictly append-only)
  schemaMigrations: [
    {
      version: 1,
      up: [
        `CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );`,
        `CREATE TABLE IF NOT EXISTS todos (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          title TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );`,
      ],
    },
  ],

  // 4. Foreign key relationships and cascading deletions
  relationships: [
    {
      parentTable: 'projects',
      childTable: 'todos',
      foreignKey: 'project_id',
      onDelete: 'cascade', // 'cascade' | 'restrict' | 'setNull' | 'noAction'
    },
  ],

  // 5. Automatic updated_at timestamp maintenance
  touchUpdatedAt: true,

  // 6. Zero-backend local SQLite authentication
  localAuth: {
    minPasswordLength: 8,
    maxFailedAttempts: 5,
    lockoutDurationMs: 15 * 60 * 1000, // 15 minutes
  },

  // 7. Remote Backend (choose one or omit for local-only)
  // Option A: Turnkey Self-Hosted Server (Zero cloud dependencies)
  server: {
    url: 'https://api.mydomain.com/api/sync',
    token: process.env.EXPO_PUBLIC_SYNC_SECRET,
  },
  // Option B: Supabase
  // supabase: { url: process.env.EXPO_PUBLIC_SUPABASE_URL!, anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! },
  // Option C: Convex
  // convex: { client: convexClient },
  // Option D: Pure Local-Only
  // localOnly: true,

  // 8. Offline Email Delivery Configuration
  email: {
    provider: 'resend', // 'nodemailer' | 'resend' | 'sendgrid' | 'postmark' | 'dev'
    apiKey: process.env.EXPO_PUBLIC_RESEND_API_KEY,
    defaults: { from: 'Support <support@mydomain.com>' },
  },

  // 9. Sync tuning
  pushIntervalMs: 500,
  pullIntervalMs: 5000,
  conflictResolver: 'last-write-wins',
});

// Singleton client promise
let clientPromise: Promise<LocalFirstClient> | null = null;
export function getSyncClient(): Promise<LocalFirstClient> {
  if (!clientPromise) {
    clientPromise = createSyncClient(syncConfig);
  }
  return clientPromise;
}
```

---

## 4. Schema & Migration Rules

1. Every synced table **must** include:
   * `id TEXT PRIMARY KEY`
   * `updated_at INTEGER NOT NULL`
2. Never edit an applied migration. Always increment the `version` and append a new migration object to `schemaMigrations`.
3. Use `generateUUID()` from `local-lite` to create unique IDs.

---

## 5. React Integration

Use `local-lite/react` hooks for reactive data binding and local authentication:

```tsx
import React, { useState, useEffect } from 'react';
import { View, Text, Button } from 'react-native';
import { useLiveQuery, useSyncStatus, useLocalAuth } from 'local-lite/react';
import { getSyncClient } from './sync.config';
import type { LocalFirstClient } from 'local-lite/config';

export function App() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);

  useEffect(() => {
    getSyncClient().then(setClient);
  }, []);

  // 1. Reactive live SQLite query (auto-updates when table mutates)
  const { data: todos } = useLiveQuery<{ id: string; title: string }>(
    client,
    'SELECT * FROM todos ORDER BY updated_at DESC;',
    []
  );

  // 2. Real-time sync engine connectivity & outbox metrics
  const { isOnline, isSyncing, pendingChanges } = useSyncStatus(client);

  // 3. Reactive zero-backend local authentication
  const { user, isSignedIn, signIn, signOut } = useLocalAuth(client?.auth);

  return (
    <View>
      <Text>Status: {isOnline ? 'Online' : 'Offline'} ({pendingChanges} pending)</Text>
      {isSignedIn ? (
        <View>
          <Text>Welcome, {user?.displayName || user?.email}!</Text>
          <Button title="Sign Out" onPress={() => signOut()} />
        </View>
      ) : (
        <Button title="Sign In" onPress={() => signIn('user@example.com', 'Password123!')} />
      )}
    </View>
  );
}
```
