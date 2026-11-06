---
name: local-lite-storage
description: Manage binary files, images, and attachments with offline caching and cloud sync in local-lite. Use when configuring BlobStorageManager, ExpoFileDriver, syncing files to Supabase Storage, Firebase Storage, or Convex, and using useStorage or useBlobUpload.
---

# local-lite Blob & File Storage

Guide for managing binary files, media, and attachments with local offline caching and cloud bucket synchronization in `local-lite`.

---

## 1. Storage Architecture

`local-lite/storage` decouples file metadata in SQLite from the actual binary data on disk:
* **Local File Drivers**: Persists binary blobs to disk (`ExpoFileDriver` on mobile, `NodeFsFileDriver` on Node.js/Electron).
* **Remote Storage Providers**: Synchronizes files to remote cloud buckets (Supabase Storage, Firebase Storage, Convex Files).
* **Metadata Store**: Automatically maintains offline status, upload progress, mime types, and SHA-256 checksums in the `_local_blobs` SQLite table.

---

## 2. Configuration

Enable storage in `defineSyncConfig`:

```typescript
import { defineSyncConfig } from 'local-lite/config';
import { ExpoFileDriver } from 'local-lite/storage';

export const syncConfig = defineSyncConfig({
  database: () => SQLite.openDatabaseAsync('app.db'),
  tables: ['documents', 'photos'],

  // Blob storage configuration
  storage: {
    // 1. Local storage driver
    driver: new ExpoFileDriver({
      baseDirectory: 'attachments', // Stored in private app document directory
    }),

    // 2. Remote storage provider (e.g. Supabase Storage bucket)
    provider: {
      type: 'supabase',
      bucket: 'user-attachments',
      url: process.env.EXPO_PUBLIC_SUPABASE_URL!,
      anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
    },

    // 3. Auto-sync uploads when online
    autoSync: true,
  },
});
```

---

## 3. Saving & Reading Files

### Save a File (Immediate Offline Access)
```typescript
import { getSyncClient } from './sync.config';

const client = await getSyncClient();

// Saves to local disk immediately and queues for background cloud sync
const blob = await client.storage.save({
  id: 'avatar-user-123.jpg',
  data: fileBytes, // Uint8Array or Blob
  mimeType: 'image/jpeg',
  metadata: { userId: '123' },
});

console.log('Saved locally at:', blob.localPath);
```

### Retrieve a File
```typescript
// Read as raw Uint8Array
const data = await client.storage.read('avatar-user-123.jpg');

// Or get local file URI for <Image source={{ uri }} />
const uri = await client.storage.getLocalUri('avatar-user-123.jpg');
```

---

## 4. React Integration (`useStorage` & `useBlobUpload`)

Use reactive hooks from `local-lite/react` for image pickers, file attachments, and upload progress:

```tsx
import React from 'react';
import { View, Image, Text, Button } from 'react-native';
import { useStorage } from 'local-lite/react';
import { getSyncClient } from './sync.config';

export function DocumentViewer({ fileId }: { fileId: string }) {
  const [client, setClient] = React.useState(null);
  React.useEffect(() => { getSyncClient().then(setClient); }, []);

  const { fileUri, isSyncing, progress, error } = useStorage(client?.storage, fileId);

  if (error) return <Text>Error loading file: {error.message}</Text>;

  return (
    <View>
      {fileUri ? (
        <Image source={{ uri: fileUri }} style={{ width: 300, height: 300 }} />
      ) : (
        <Text>Loading file from local storage...</Text>
      )}
      {isSyncing && <Text>Syncing to cloud: {progress}%</Text>}
    </View>
  );
}
```

