import { describe, it, expect, beforeEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';
import { BlobStorageManager, MemoryFileDriver, RemoteStorageUploader } from '../src/storage/index.js';

describe('BlobStorageManager & Media Storage', () => {
  let db: MockDB;
  let driver: MemoryFileDriver;
  let storage: BlobStorageManager;

  beforeEach(async () => {
    db = new MockDB();
    driver = new MemoryFileDriver();
    storage = new BlobStorageManager(db, { driver });
    await storage.initialize();
  });

  it('saves binary data and computes SHA-256 and size correctly', async () => {
    const data = new TextEncoder().encode('Hello offline-first storage!');
    const record = await storage.save('documents/notes.txt', data, {
      name: 'notes.txt',
      mimeType: 'text/plain',
      metadata: { tag: 'important' },
    });

    expect(record.key).toBe('documents/notes.txt');
    expect(record.name).toBe('notes.txt');
    expect(record.mimeType).toBe('text/plain');
    expect(record.size).toBe(data.byteLength);
    expect(record.sha256).toBeDefined();
    expect(record.status).toBe('PENDING');

    // Retrieve file
    const retrieved = await storage.get('documents/notes.txt');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.record.id).toBe(record.id);
    expect(new TextDecoder().decode(retrieved?.data)).toBe('Hello offline-first storage!');
  });

  it('supports deletion of blob binary and metadata', async () => {
    await storage.save('avatars/user-1.png', 'fake-image-bytes', { mimeType: 'image/png' });
    expect(await storage.getRecord('avatars/user-1.png')).not.toBeNull();

    await storage.delete('avatars/user-1.png');
    expect(await storage.getRecord('avatars/user-1.png')).toBeNull();
    expect(await storage.getData('avatars/user-1.png')).toBeNull();
  });

  it('uploads pending blobs using remote storage uploader when triggered', async () => {
    const uploadedRemoteUrls: string[] = [];
    const mockUploader: RemoteStorageUploader = {
      upload: async (blob, data) => {
        const url = `https://cdn.example.com/${blob.key}`;
        uploadedRemoteUrls.push(url);
        return { remoteUrl: url };
      },
    };

    storage.setUploader(mockUploader);

    await storage.save('reports/q3.pdf', 'PDF-DATA', {
      autoUpload: false,
    });

    const pendingBefore = await storage.list('PENDING');
    expect(pendingBefore).toHaveLength(1);

    const { uploaded, failed } = await storage.syncPending();
    expect(uploaded).toBe(1);
    expect(failed).toBe(0);
    expect(uploadedRemoteUrls).toContain('https://cdn.example.com/reports/q3.pdf');

    const uploadedRecords = await storage.list('UPLOADED');
    expect(uploadedRecords).toHaveLength(1);
    expect(uploadedRecords[0].remoteUrl).toBe('https://cdn.example.com/reports/q3.pdf');
  });

  it('integrates cleanly into LocalFirstClient via client.storage', async () => {
    const remote = new MemoryDemoRemoteAdapter(50);
    const network = new DefaultNetworkStatusProvider(true);

    const client = new LocalFirstClient({
      local: db,
      remote,
      network,
    });
    await client.initialize();

    const saved = await client.storage.save('lease.pdf', 'CONTRACT_BYTES', { mimeType: 'application/pdf' });
    expect(saved.key).toBe('lease.pdf');

    client.stop();
  });
});
