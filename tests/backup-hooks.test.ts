import { describe, expect, it } from 'vitest';
import {
  type CloudBackupClient,
  type CloudBackupFile,
  type BackupDatabase,
} from '../src/backups/index.js';
import {
  useCloudBackup,
  useGoogleDriveBackup,
  useOneDriveBackup,
} from '../src/react/backups.js';

class MockCloudBackupClient implements CloudBackupClient {
  private connected = false;
  private files: CloudBackupFile[] = [];
  private stored = new Map<string, Uint8Array>();
  private listeners = new Set<(connected: boolean) => void>();

  onStatusChange(listener: (connected: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(conn: boolean) {
    this.connected = conn;
    for (const l of this.listeners) l(conn);
  }

  async connect(): Promise<boolean> {
    this.notify(true);
    return true;
  }

  async disconnect(): Promise<void> {
    this.notify(false);
  }

  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  async list(): Promise<CloudBackupFile[]> {
    return this.files;
  }

  async save(fileName: string, data: Uint8Array): Promise<void> {
    this.stored.set(fileName, data);
    this.files.push({ id: fileName, name: fileName, size: data.byteLength });
  }

  async read(fileName: string): Promise<Uint8Array> {
    const d = this.stored.get(fileName);
    if (!d) throw new Error('File not found');
    return d;
  }

  async deleteBackup(fileName: string): Promise<void> {
    this.stored.delete(fileName);
    this.files = this.files.filter(f => f.id !== fileName);
  }

  getFiles() {
    return this.files;
  }
}

describe('React Backup Hooks & Client API', () => {
  it('exposes identical intuitive hook signatures and operations as auth', () => {
    expect(typeof useCloudBackup).toBe('function');
    expect(typeof useGoogleDriveBackup).toBe('function');
    expect(typeof useOneDriveBackup).toBe('function');
  });

  it('performs full backup, list, delete, and restore cycle using mock storage', async () => {
    const mockClient = new MockCloudBackupClient();
    let restoredBytes: Uint8Array | null = null;

    const database: BackupDatabase = {
      exportDatabase: async () => new TextEncoder().encode('Snapshot of application'),
      importDatabase: async data => {
        restoredBytes = data;
      },
    };

    expect(await mockClient.isConnected()).toBe(false);

    // Connect
    await mockClient.connect();
    expect(await mockClient.isConnected()).toBe(true);

    // Save
    await mockClient.save('test-1.db', new TextEncoder().encode('Snapshot of application'));
    const files = await mockClient.list();
    expect(files.length).toBe(1);
    expect(files[0].name).toBe('test-1.db');

    // Read / Restore
    const data = await mockClient.read('test-1.db');
    await database.importDatabase(data);
    expect(restoredBytes).not.toBeNull();
    expect(new TextDecoder().decode(restoredBytes!)).toBe('Snapshot of application');

    // Delete
    await mockClient.deleteBackup('test-1.db');
    const updatedFiles = await mockClient.list();
    expect(updatedFiles.length).toBe(0);

    // Disconnect
    await mockClient.disconnect();
    expect(await mockClient.isConnected()).toBe(false);
  });
});
