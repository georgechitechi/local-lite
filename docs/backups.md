# 📦 Database Backups & Cloud Sync
`local-lite` includes zero-backend cloud backup and zero-knowledge database encryption out of the box.

---

## ☁️ 1. Cloud Backup Storages

Export and restore SQLite database snapshots directly to personal cloud storage:
* **Google Drive** (`GoogleDriveBackupClient`, `GoogleDriveBackupStorage`)
* **Microsoft OneDrive** (`OneDriveBackupClient`, `OneDriveBackupStorage`)

Backups are securely isolated in application-sandboxed folders (`appDataFolder` on Google Drive, `special/approot` on OneDrive) without needing full drive permissions.

### Example: OneDrive Backup Client
```typescript
import { OneDriveBackupClient, createDatabaseBackup, restoreDatabaseBackup } from 'local-lite/backups';

export const oneDriveBackup = new OneDriveBackupClient({
  clientId: 'YOUR_AZURE_CLIENT_ID',
  redirectUri: 'myapp://oauth-ms',
  authorize: async ({ authorizationUrl, redirectUri }) => {
    // Open WebBrowser session
    return { code: '...', state: '...' };
  },
});

// Connect user account
await oneDriveBackup.connect();

// Create SQLite snapshot and upload to OneDrive approot:/backups/
const fileName = await createDatabaseBackup(client.db, oneDriveBackup);
console.log(`Backup uploaded: ${fileName}`);

// List available cloud backups
const backups = await oneDriveBackup.list();

// Restore database
await restoreDatabaseBackup(client.db, oneDriveBackup, backups[0].name);
```

---

## 🔐 2. Zero-Knowledge Encrypted Backups (AES-256-GCM + PBKDF2)

For sensitive user data (medical notes, passwords, financial records), `local-lite` provides client-side zero-knowledge encryption before snapshots leave the device.

### Security Architecture:
* **Key Derivation:** PBKDF2 using SHA-256 and a random 16-byte cryptographic salt (50,000 iterations).
* **Authenticated Encryption:** AES-256-GCM with a unique 12-byte IV per backup, providing confidential encryption and cryptographic tamper resistance.
* **Self-Describing Header:** Magic bytes `LLENC1` and iteration count are packed into the header for automatic validation.

### Usage:

```typescript
import {
  createEncryptedDatabaseBackup,
  restoreEncryptedDatabaseBackup,
} from 'local-lite/backups';

// Create encrypted backup with user passphrase
const fileName = await createEncryptedDatabaseBackup(client.db, oneDriveBackup, {
  passphrase: 'user-chosen-secret-passphrase',
  fileName: 'medical-records.enc.db', // optional
});

// Restore encrypted backup
await restoreEncryptedDatabaseBackup(client.db, oneDriveBackup, fileName, {
  passphrase: 'user-chosen-secret-passphrase',
});
```

If an incorrect passphrase is provided or the encrypted file is modified/corrupted, decryption fails immediately with a clear error:
`Backup decryption failed: Incorrect passphrase or corrupted database backup.`
