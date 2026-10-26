# Offline Media & Blob Storage (`client.storage`)

In local-first applications, large files like inspection photos, tenant contracts, audio recordings, and PDF documents should never bloat your SQLite queries or database caches. `client.storage` keeps binary files efficiently on disk (or in-memory / cache) while tracking rich metadata and offline sync states in SQLite (`_local_blobs`).

---

## Features

- **Decoupled Architecture**: Separates binary payloads from SQLite table scans.
- **Integrity Checksums**: Auto-computes SHA-256 digests to ensure binary integrity and prevent duplicates.
- **Pluggable Drivers**: `MemoryFileDriver` (universal) and `NodeFileDriver` (filesystem).
- **Background Cloud Uploader**: Plug in AWS S3, Cloudinary, Supabase Storage, or Firebase Storage to upload pending offline media once online.

---

## Saving Files Offline

```typescript
// Save Uint8Array or string
const imageBytes = new Uint8Array([...]);

const record = await client.storage.save('inspections/kitchen-1.jpg', imageBytes, {
  name: 'kitchen-1.jpg',
  mimeType: 'image/jpeg',
  metadata: { unitId: 'unit-4b', inspectionId: 'insp-123' },
});

console.log(record.id);        // Unique blob UUID
console.log(record.sha256);    // Hex SHA-256 hash
console.log(record.size);      // File size in bytes
console.log(record.status);    // 'PENDING'
```

---

## Retrieving Files

```typescript
// Get metadata and raw binary data
const result = await client.storage.get('inspections/kitchen-1.jpg');
if (result) {
  const { record, data } = result;
  console.log(`Loaded ${record.name} (${data.byteLength} bytes)`);
}

// Get only raw bytes
const bytes = await client.storage.getData('inspections/kitchen-1.jpg');

// Delete file and metadata
await client.storage.delete('inspections/kitchen-1.jpg');
```

---

## Remote Cloud Sync (S3 / Supabase / Cloudinary)

Attach an uploader to automatically sync pending offline files when online:

```typescript
client.storage.setUploader({
  async upload(blob, data) {
    const response = await fetch(`https://api.mycloud.com/upload/${blob.key}`, {
      method: 'POST',
      body: data,
      headers: { 'Content-Type': blob.mimeType },
    });
    const result = await response.json();
    return { remoteUrl: result.publicUrl };
  },
});

// Trigger sync for all pending offline files
const { uploaded, failed } = await client.storage.syncPending();
console.log(`Synced ${uploaded} media files to cloud storage`);
```
