# Offline Media & Blob Storage (`client.storage`)

In local-first applications, large files like inspection photos, tenant contracts, audio recordings, and PDF documents should never bloat your SQLite queries or database caches. `client.storage` keeps binary files efficiently on disk (or in-memory / cache) while tracking rich metadata and offline sync states in SQLite (`_local_blobs`).

`local-lite` supports **Supabase Storage**, **Convex File Storage**, and **Firebase Cloud Storage** out of the box.

---

## Features

- **Decoupled Architecture**: Separates heavy binary payloads from SQLite table scans.
- **Integrity Checksums**: Auto-computes SHA-256 digests to ensure binary integrity and prevent duplicates.
- **Pluggable Local Drivers**: `MemoryFileDriver` (testing & web), `NodeFileDriver` (Node.js filesystem), and `ExpoFileDriver` (Expo & React Native filesystem).
- **Out-of-the-Box Cloud Uploaders**:
  - ⚡ **Supabase Storage**: Buckets, public URLs, and signed URLs.
  - 🌐 **Convex File Storage**: `generateUploadUrl`, POST upload, `storageId`, and reactive serving queries.
  - 🔥 **Firebase Cloud Storage**: Modular v9+ SDK & compat SDK, custom metadata, and download URLs.
- **Auto-Wiring**: Pass `bucket` or `uploadMutation` to `client.storage` and local-lite automatically connects to your active remote database adapter.
- **Mobile-Ready**: Direct URI resolution (`file://`) and zero-memory-leak local file import (`saveFromUri`) from `expo-image-picker` or `expo-document-picker`.

---

## 1. Supabase Storage Setup

```typescript
import { SupabaseAdapter } from 'local-lite/supabase';
import { ExpoFileDriver } from 'local-lite/storage';
import { File, Directory, Paths } from 'expo-file-system';

const remote = new SupabaseAdapter(supabaseClient, {
  tables: ['properties', 'units'],
});

const client = new LocalLiteClient({
  db: new ExpoSQLiteAdapter(expoDb),
  remote,
  storage: {
    driver: new ExpoFileDriver({ File, Directory, Paths }),
    // Explicit uploader:
    uploader: remote.createStorageUploader({
      bucket: 'property-photos',
      urlType: 'public', // or 'signed'
      upsert: true,
    }),
    // Or auto-wired: simply pass bucket: 'property-photos'
  },
});
```

---

## 2. Convex File Storage Setup

```typescript
import { ConvexRemoteAdapter } from 'local-lite/convex';
import { ExpoFileDriver } from 'local-lite/storage';
import { api } from '../convex/_generated/api';

const remote = new ConvexRemoteAdapter(convexClient, {
  tables: ['messages', 'documents'],
});

const client = new LocalLiteClient({
  db: new ExpoSQLiteAdapter(expoDb),
  remote,
  storage: {
    driver: new ExpoFileDriver({ File, Directory, Paths }),
    // Explicit uploader:
    uploader: remote.createStorageUploader({
      uploadMutation: api.files.generateUploadUrl, // or 'sync:generateUploadUrl'
      getUrlQuery: api.files.getUrl,               // optional query resolving storageId -> serving URL
      saveFileMutation: api.files.saveFile,        // optional metadata persistence
    }),
  },
});
```

---

## 3. Firebase Cloud Storage Setup

Works seamlessly with modular (`firebase/storage`) and compat SDKs:

```typescript
import { FirestoreAdapter } from 'local-lite/firebase';
import { ExpoFileDriver } from 'local-lite/storage';
import * as storageModule from 'firebase/storage';

const remote = new FirestoreAdapter(firestoreDb, {
  tables: ['properties', 'tenants'],
});

const client = new LocalLiteClient({
  db: new ExpoSQLiteAdapter(expoDb),
  remote,
  storage: {
    driver: new ExpoFileDriver({ File, Directory, Paths }),
    // Explicit uploader:
    uploader: remote.createStorageUploader({
      basePath: 'property-media',
      storageModule, // pass modular SDK { ref, uploadBytes, getDownloadURL }
      cacheControl: 'public, max-age=31536000',
    }),
  },
});
```

---

## Universal Factory: `createStorageUploader`

If creating uploaders standalone without `remote` adapter:

```typescript
import { createStorageUploader } from 'local-lite/storage';

// Supabase
const supabaseUploader = createStorageUploader('supabase', supabaseClient, {
  bucket: 'avatars',
});

// Convex
const convexUploader = createStorageUploader('convex', convexClient, {
  uploadMutation: api.files.generateUploadUrl,
  getUrlQuery: api.files.getUrl,
});

// Firebase
const firebaseUploader = createStorageUploader('firebase', firebaseStorage, {
  basePath: 'documents',
});
```

---

## Direct Mobile Camera / Picker Import (`saveFromUri`)

When a user captures a photo or picks a document using `expo-image-picker` or `expo-document-picker`, avoid reading large byte arrays into JavaScript memory. Use `saveFromUri`:

```typescript
import * as ImagePicker from 'expo-image-picker';

const result = await ImagePicker.launchImageLibraryAsync({
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  quality: 0.8,
});

if (!result.canceled && result.assets[0]) {
  const asset = result.assets[0];

  // Directly copies the file without JS memory overhead and queues for cloud upload
  const record = await client.storage.saveFromUri(
    `properties/${propertyId}/hero.jpg`,
    asset.uri,
    {
      name: 'hero.jpg',
      mimeType: 'image/jpeg',
      metadata: { propertyId },
    }
  );

  console.log('Saved to local storage at:', record.localPath);
  console.log('Remote Cloud URL (if online):', record.remoteUrl);
}
```

---

## Displaying in React Native (`getLocalUri`)

To render a locally stored image in React Native `<Image />` without reading bytes into memory:

```tsx
import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';

export function PropertyHeroImage({ imageKey }: { imageKey: string }) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    client.storage.getLocalUri(imageKey).then(setUri);
  }, [imageKey]);

  if (!uri) return null;

  return <Image source={{ uri }} style={{ width: 300, height: 200, borderRadius: 8 }} />;
}
```

---

## Saving Raw Bytes Offline

```typescript
const imageBytes = new Uint8Array([...]);

const record = await client.storage.save('inspections/kitchen-1.jpg', imageBytes, {
  name: 'kitchen-1.jpg',
  mimeType: 'image/jpeg',
  metadata: { unitId: 'unit-4b', inspectionId: 'insp-123' },
});

console.log(record.id);        // Unique blob UUID
console.log(record.sha256);    // Hex SHA-256 hash
console.log(record.size);      // File size in bytes
console.log(record.status);    // 'PENDING' (or 'UPLOADED' if online)
```

---

## Retrieving and Deleting Files

```typescript
// Get metadata and raw binary data
const result = await client.storage.get('inspections/kitchen-1.jpg');
if (result) {
  const { record, data } = result;
  console.log(`Loaded ${record.name} (${data.byteLength} bytes)`);
}

// Get only raw bytes
const bytes = await client.storage.getData('inspections/kitchen-1.jpg');

// Get remote URL
const url = await client.storage.getDownloadUrl('inspections/kitchen-1.jpg');

// Delete file locally (and optionally remotely if deleteRemoteOnDelete is true)
await client.storage.delete('inspections/kitchen-1.jpg');
```

---

## Provider Options Reference

### Supabase Storage Options
| Option | Type | Default | Description |
|---|---|---|---|
| `bucket` | `string` | *(required)* | Name of the Supabase Storage bucket |
| `upsert` | `boolean` | `true` | Overwrites files with identical remote path |
| `urlType` | `'public' \| 'signed'` | `'public'` | Uses `getPublicUrl` or `createSignedUrl` |
| `signedUrlExpiresIn` | `number` | `86400` | Expiration in seconds for signed URLs |
| `pathTransform` | `(key, blob) => string` | `identity` | Custom mapping from local key to bucket path |
| `cacheControl` | `string` | `undefined` | Cache-Control HTTP header |

### Convex File Storage Options
| Option | Type | Default | Description |
|---|---|---|---|
| `uploadMutation` | `any` | `'sync:generateUploadUrl'` | Mutation reference or name generating upload URL |
| `uploadMutationArgs` | `object \| fn` | `{}` | Optional arguments for upload mutation |
| `getUrlQuery` | `any` | `undefined` | Optional query resolving `storageId` to serving URL |
| `saveFileMutation` | `any` | `undefined` | Optional mutation called to link file to Convex schema |
| `deleteMutation` | `any` | `undefined` | Optional mutation called when deleting from Convex |

### Firebase Cloud Storage Options
| Option | Type | Default | Description |
|---|---|---|---|
| `bucket` | `string` | `undefined` | Optional bucket name / gs:// URI |
| `basePath` | `string` | `undefined` | Prefix path inside bucket (e.g. `'uploads'`) |
| `storageModule` | `object` | `undefined` | Modular Firebase SDK (`{ ref, uploadBytes, getDownloadURL, deleteObject }`) |
| `customMetadata` | `object \| fn` | `undefined` | Custom metadata attached to storage object |
| `cacheControl` | `string` | `undefined` | Cache-Control HTTP header |
