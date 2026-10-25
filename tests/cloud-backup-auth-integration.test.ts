import { describe, expect, it, vi } from 'vitest';
import {
  GoogleAuthClient,
  type GoogleUser,
} from '../src/auth/google.js';
import {
  MicrosoftAuthClient,
  type MicrosoftUser,
} from '../src/auth/microsoft.js';
import {
  GoogleDriveBackupClient,
  OneDriveBackupClient,
  performBackup,
  performRestore,
  type CloudBackupFile,
} from '../src/backups/index.js';

function response(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Cloud Backup - Auth Integration & React Patterns', () => {
  it('connects GoogleDriveBackupClient using an existing GoogleAuthClient seamlessly', async () => {
    let authorized = false;
    const mockGoogleAuth = new GoogleAuthClient({
      clientId: 'google-client-id',
      redirectUri: 'myapp://oauth',
      authorize: async request => {
        authorized = true;
        return { code: 'google-auth-code', state: request.state };
      },
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes('token')) {
          return response({
            access_token: 'google-access-token-123',
            refresh_token: 'google-refresh-token',
            expires_in: 3600,
          });
        }
        if (url.includes('userinfo')) {
          return response({
            sub: 'user-google-1',
            email: 'user@gmail.com',
            name: 'Google User',
          });
        }
        return response({});
      },
    });

    // Create backup client directly from googleAuth client
    const backupClient = mockGoogleAuth.createDriveBackupClient({
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes('/files?q=')) {
          return response({ files: [{ id: 'folder-123' }] });
        }
        if (url.includes('/files?uploadType=resumable')) {
          return new Response(null, {
            status: 200,
            headers: { Location: 'https://upload.google.com/session-123' },
          });
        }
        if (url.includes('session-123')) {
          return new Response(null, { status: 200 });
        }
        if (url.includes('/files/file-1?alt=media')) {
          return new Response(new TextEncoder().encode('Restored Plain DB'));
        }
        return response({});
      },
    });

    const statusHistory: boolean[] = [];
    backupClient.onStatusChange(connected => {
      statusHistory.push(connected);
    });

    expect(await backupClient.isConnected()).toBe(false);

    // Connect via backup client
    const connected = await backupClient.connect();
    expect(connected).toBe(true);
    expect(authorized).toBe(true);
    expect(await backupClient.isConnected()).toBe(true);
    expect(statusHistory).toContain(true);

    // Perform backup using high-level backup method on client
    const testDb = {
      exportDatabase: async () => new TextEncoder().encode('Active SQLite DB'),
      importDatabase: async () => {},
    };
    const fileName = await backupClient.backup(testDb, { fileName: 'my-snapshot.db' });
    expect(fileName).toBe('my-snapshot.db');

    // Disconnect
    await backupClient.disconnect();
    expect(await backupClient.isConnected()).toBe(false);
    expect(statusHistory[statusHistory.length - 1]).toBe(false);
  });

  it('connects OneDriveBackupClient using an existing MicrosoftAuthClient seamlessly', async () => {
    let msSignInCalled = false;
    const mockMsAuth = new MicrosoftAuthClient({
      clientId: 'ms-client-id',
      redirectUri: 'myapp://oauth',
      authorize: async request => {
        msSignInCalled = true;
        return { code: 'ms-code', state: request.state };
      },
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes('token')) {
          return response({
            access_token: 'ms-access-token-456',
            refresh_token: 'ms-refresh-token',
            expires_in: 3600,
          });
        }
        if (url.includes('/me')) {
          return response({
            id: 'ms-user-1',
            mail: 'user@outlook.com',
            displayName: 'MS User',
          });
        }
        return response({});
      },
    });

    // Create backup client directly from microsoftAuth
    const oneDriveBackup = mockMsAuth.createOneDriveBackupClient({
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes('/content')) {
          return response({ id: 'item-1', name: 'backup.db' });
        }
        if (url.includes('/children')) {
          return response({
            value: [{ id: 'item-1', name: 'backup.db', size: 1024 }],
          });
        }
        return response({});
      },
    });

    const statusUpdates: boolean[] = [];
    oneDriveBackup.onStatusChange(conn => statusUpdates.push(conn));

    expect(await oneDriveBackup.isConnected()).toBe(false);

    // Connect
    const success = await oneDriveBackup.connect();
    expect(success).toBe(true);
    expect(msSignInCalled).toBe(true);
    expect(await oneDriveBackup.isConnected()).toBe(true);
    expect(statusUpdates).toContain(true);

    // List backups
    const list = await oneDriveBackup.list();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('backup.db');

    // High level backup
    const testDb = {
      exportDatabase: async () => new TextEncoder().encode('MS SQLite DB'),
      importDatabase: async () => {},
    };
    const saved = await oneDriveBackup.backup(testDb);
    expect(saved).toMatch(/^local-lite-.*\.db$/);

    // Disconnect
    await oneDriveBackup.disconnect();
    expect(await oneDriveBackup.isConnected()).toBe(false);
  });

  it('performs seamless encrypted backup and restore with passphrase', async () => {
    const memoryFiles = new Map<string, Uint8Array>();
    const storage = {
      save: async (name: string, data: Uint8Array) => {
        memoryFiles.set(name, data);
      },
      read: async (name: string) => {
        const d = memoryFiles.get(name);
        if (!d) throw new Error('Not found');
        return d;
      },
    };

    const originalData = new TextEncoder().encode('Super sensitive medical and child data');
    let restoredData = new Uint8Array();

    const db = {
      exportDatabase: async () => originalData,
      importDatabase: async (data: Uint8Array) => {
        restoredData = data;
      },
    };

    // Backup with passphrase
    const fileName = await performBackup(db, storage, {
      passphrase: 'correct-horse-battery-staple',
    });
    expect(fileName).toMatch(/\.enc\.db$/);

    // Attempt restore without passphrase on encrypted backup -> must fail informatively
    await expect(performRestore(db, storage, fileName)).rejects.toThrow(
      'This backup is encrypted. A passphrase is required to restore it.',
    );

    // Attempt restore with wrong passphrase -> must fail
    await expect(
      performRestore(db, storage, fileName, { passphrase: 'wrong-password' }),
    ).rejects.toThrow('decryption failed');

    // Restore with correct passphrase
    await performRestore(db, storage, fileName, {
      passphrase: 'correct-horse-battery-staple',
    });
    expect(new TextDecoder().decode(restoredData)).toBe('Super sensitive medical and child data');
  });
});
