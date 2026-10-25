# 📦 Cloud Backups & Zero-Knowledge Encryption

`local-lite` includes zero-backend cloud backup and client-side zero-knowledge database encryption out of the box.

```typescript
import {
  GoogleDriveBackupClient,
  OneDriveBackupClient,
  performBackup,
  performRestore,
  createDatabaseBackup,
  restoreDatabaseBackup,
  createEncryptedDatabaseBackup,
  restoreEncryptedDatabaseBackup,
} from 'local-lite/backups';

import {
  useCloudBackup,
  useGoogleDriveBackup,
  useOneDriveBackup,
} from 'local-lite/react';
```

---

## ☁️ 1. Supported Cloud Storage Providers

SQLite snapshots are exported directly to user personal cloud storage in secure, application-sandboxed directories without requiring full drive access:
* **Google Drive** (`GoogleDriveBackupClient`, `GoogleDriveBackupStorage` using the sandboxed `appDataFolder`)
* **Microsoft OneDrive** (`OneDriveBackupClient`, `OneDriveBackupStorage` using the sandboxed `special/approot` directory)

---

## 🚀 2. Setting Up Backup Clients

### Google Drive Client:
```typescript
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { GoogleDriveBackupClient, createGoogleDriveTokenStore } from 'local-lite/backups';

export const googleDriveBackup = new GoogleDriveBackupClient({
  clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID!,
  redirectUri: Linking.createURL('oauth'),
  tokenStore: createGoogleDriveTokenStore(secureStorage),
  authorize: async ({ authorizationUrl, redirectUri }) => {
    const res = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);
    if (res.type !== 'success' || !res.url) return null;
    const url = new URL(res.url);
    return {
      code: url.searchParams.get('code') ?? '',
      state: url.searchParams.get('state') ?? '',
    };
  },
});
```

### OneDrive Client:
```typescript
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { OneDriveBackupClient, createOneDriveTokenStore } from 'local-lite/backups';

export const oneDriveBackup = new OneDriveBackupClient({
  clientId: process.env.EXPO_PUBLIC_AZURE_CLIENT_ID!,
  redirectUri: Linking.createURL('oauth'),
  tokenStore: createOneDriveTokenStore(secureStorage),
  authorize: async ({ authorizationUrl, redirectUri }) => {
    const res = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);
    if (res.type !== 'success' || !res.url) return null;
    const url = new URL(res.url);
    return {
      code: url.searchParams.get('code') ?? '',
      state: url.searchParams.get('state') ?? '',
    };
  },
});
```

---

## 💾 3. Backing Up and Restoring via `client`

You can create and restore backups directly through your initialized `LocalFirstClient`:

```typescript
// Connect user session
await googleDriveBackup.connect();

// 1. Create backup snapshot
const fileName = await client.backup(googleDriveBackup, {
  fileName: 'my-app-backup.db', // optional
});
console.log('Backup created:', fileName);

// 2. List backups
const backups = await googleDriveBackup.list();

// 3. Restore snapshot
await client.restore(googleDriveBackup, backups[0].name);
```

---

## 🔐 4. Zero-Knowledge Encryption (AES-256-GCM + PBKDF2)

For sensitive applications (medical records, finances, personal notes), data can be encrypted on-device before uploading to the cloud. Neither Google, Microsoft, nor anyone intercepting the file can read the snapshot.

### Security Specifications:
* **Key Derivation:** PBKDF2 with SHA-256, 50,000 iterations, and a unique 16-byte cryptographic salt per backup.
* **Authenticated Encryption:** AES-256-GCM with a unique 12-byte initialization vector (IV) and 16-byte authentication tag preventing tampering.
* **Header Structure:** Self-describing `LLENC1` magic bytes header packing the salt, IV, and iteration count for automatic decryption validation.

### Usage:
```typescript
// Create encrypted backup with passphrase:
const encryptedFileName = await client.backup(googleDriveBackup, {
  passphrase: 'user-chosen-secret-passphrase',
  fileName: 'medical-snapshot.enc.db',
});

// Restore encrypted backup:
await client.restore(googleDriveBackup, encryptedFileName, {
  passphrase: 'user-chosen-secret-passphrase',
});
```

If the passphrase is incorrect or the file was modified in transit, decryption immediately rejects with:
`Backup decryption failed: Incorrect passphrase or corrupted database backup.`

---

## ⚛️ 5. React Hooks for Cloud Backups

Use `useGoogleDriveBackup` or `useOneDriveBackup` to manage cloud backups reactively in your UI:

```tsx
import React from 'react';
import { View, Text, Button, FlatList, ActivityIndicator } from 'react-native';
import { useGoogleDriveBackup } from 'local-lite/react';
import { googleDriveBackup } from './backup';

export function CloudBackupScreen({ client }) {
  const {
    isConnected,
    isLoading,
    isBackingUp,
    isRestoring,
    backups,
    connect,
    disconnect,
    backup,
    restore,
    deleteBackup,
  } = useGoogleDriveBackup(googleDriveBackup, client, {
    passphrase: 'optional-user-passphrase',
    autoRefresh: true,
  });

  if (isLoading) return <ActivityIndicator />;

  if (!isConnected) {
    return (
      <View>
        <Text>Connect your Google Drive to enable cloud backups.</Text>
        <Button title="Connect Google Drive" onPress={() => connect()} />
      </View>
    );
  }

  return (
    <View style={{ padding: 16 }}>
      <Button
        title={isBackingUp ? 'Creating Backup...' : 'Create New Backup'}
        disabled={isBackingUp}
        onPress={() => backup()}
      />

      <FlatList
        data={backups}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
            <View>
              <Text style={{ fontWeight: '600' }}>{item.name}</Text>
              <Text style={{ color: '#666' }}>{new Date(item.createdAt).toLocaleString()}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Restore" onPress={() => restore(item.name)} disabled={isRestoring} />
              <Button title="Delete" color="#ef4444" onPress={() => deleteBackup(item.id)} />
            </View>
          </View>
        )}
      />

      <Button title="Disconnect" color="#64748b" onPress={() => disconnect()} />
    </View>
  );
}
```

---

## 🗄️ 6. Universal Database Snapshots (`exportDatabase` & `importDatabase`)

`LocalFirstClient` includes built-in methods to export and import portable binary snapshots independently of any cloud service (e.g. for local file system saves, air-gapped USB transfers, or diagnostic dumps):

```typescript
// 1. Export entire SQLite state as Uint8Array bytes
const snapshotBytes = await client.exportDatabase();

// 2. Restore database from snapshot bytes
await client.importDatabase(snapshotBytes);
```
