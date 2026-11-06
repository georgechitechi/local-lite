---
name: local-lite-backups
description: Implement cloud backups, AES-256-GCM database encryption, and restore operations in local-lite. Use when configuring OneDrive or Google Drive backups, encrypted SQLite backups with passphrases, backup progress hooks, or useCloudBackup / useOneDriveBackup.
---

# local-lite Backups & Encryption

Comprehensive guide for creating, encrypting, and restoring SQLite database backups to Microsoft OneDrive and Google Drive.

---

## 1. Cloud Backup Providers

`local-lite/backups` provides dedicated clients for user-owned cloud drives. Backups are stored in an application-scoped folder (`approot:/backups/` on OneDrive, `appDataFolder` on Google Drive), so the user retains full ownership of their data.

### Supported Providers
* **Microsoft OneDrive**: `OneDriveBackupClient` (uses Microsoft Graph API).
* **Google Drive**: `GoogleDriveBackupClient` (uses Google Drive v3 REST API).

---

## 2. Setting Up Cloud Backups

### OneDrive Backup Setup
```typescript
import { OneDriveBackupClient } from 'local-lite/backups';
import { MicrosoftAuthClient } from 'local-lite/auth';

// 1. Create or reuse your Microsoft Auth Client
const authClient = new MicrosoftAuthClient({
  clientId: process.env.EXPO_PUBLIC_MS_CLIENT_ID!,
  redirectUri: 'myapp://auth',
  scopes: ['openid', 'profile', 'Files.ReadWrite.AppFolder'],
  authorize: async (req) => { /* Expo WebBrowser session */ },
});

// 2. Instantiate OneDriveBackupClient
export const oneDriveClient = new OneDriveBackupClient({
  authClient,
});
```

### Google Drive Backup Setup
```typescript
import { GoogleDriveBackupClient } from 'local-lite/backups';
import { GoogleAuthClient } from 'local-lite/auth';

const authClient = new GoogleAuthClient({
  clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID!,
  redirectUri: 'myapp://auth',
  scopes: ['https://www.googleapis.com/auth/drive.appdata'],
  authorize: async (req) => { /* Expo WebBrowser session */ },
});

export const googleDriveClient = new GoogleDriveBackupClient({
  authClient,
});
```

---

## 3. Creating & Restoring Backups

### Manual Backup Operation
```typescript
import { getSyncClient } from './sync.config';

const client = await getSyncClient();

// Upload current database snapshot to cloud
const result = await oneDriveClient.backup(client.db, {
  fileName: `backup-${Date.now()}.db`,
});
console.log('Uploaded backup:', result.name, result.size);

// List available cloud backups
const files = await oneDriveClient.list();

// Restore from a specific backup file
await oneDriveClient.restore(client.db, files[0].id);
```

---

## 4. End-to-End Database Encryption (AES-256-GCM)

For maximum privacy, encrypt the SQLite database snapshot with an end-user passphrase before it leaves the device:

```typescript
// 1. Encrypted Backup
await oneDriveClient.backup(client.db, {
  fileName: `encrypted-backup-${Date.now()}.db`,
  passphrase: 'UserSecretPassphrase123!',
  // Uses PBKDF2 key derivation and AES-256-GCM authenticated encryption
});

// 2. Encrypted Restore
await oneDriveClient.restore(client.db, files[0].id, {
  passphrase: 'UserSecretPassphrase123!',
});
```

If the passphrase is incorrect or the backup payload has been tampered with, AES-256-GCM authentication fails immediately and protects the local database from corruption.

---

## 5. React Integration (`useCloudBackup`)

Use the `useCloudBackup` (or `useOneDriveBackup` / `useGoogleDriveBackup`) hook for reactive backup management:

```tsx
import React from 'react';
import { View, Text, Button, ActivityIndicator } from 'react-native';
import { useOneDriveBackup } from 'local-lite/react';
import { oneDriveClient } from './backup.config';
import { getSyncClient } from './sync.config';

export function BackupScreen() {
  const [client, setClient] = React.useState(null);
  React.useEffect(() => { getSyncClient().then(setClient); }, []);

  const {
    connected,
    files,
    isBackingUp,
    isRestoring,
    progress,
    backup,
    restore,
    refreshFiles,
    connect,
  } = useOneDriveBackup(oneDriveClient, client?.db);

  if (!connected) {
    return <Button title="Connect to OneDrive" onPress={() => connect()} />;
  }

  return (
    <View>
      <Text>Cloud Backups ({files.length} available)</Text>
      
      {isBackingUp && <Text>Backing up: {progress}%</Text>}
      {isRestoring && <Text>Restoring: {progress}%</Text>}

      <Button
        title="Create Encrypted Backup"
        onPress={() => backup({ passphrase: 'MySecretPassphrase!' })}
        disabled={isBackingUp || isRestoring}
      />

      {files.map((file) => (
        <View key={file.id}>
          <Text>{file.name} ({(file.size / 1024).toFixed(1)} KB)</Text>
          <Button
            title="Restore"
            onPress={() => restore(file.id, { passphrase: 'MySecretPassphrase!' })}
          />
        </View>
      ))}
    </View>
  );
}
```

