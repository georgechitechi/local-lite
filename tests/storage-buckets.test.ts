import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BlobStorageManager,
  MemoryFileDriver,
  selfHostedStorage,
  type StorageBucketRecord,
} from '../src/storage/index.js';
import {
  createStorageEndpoint,
  type StorageMetadataAdapter,
  type StoredFileMeta,
} from '../src/server/storage.js';
import { SelfHostedRemoteAdapter } from '../src/adapters/remote/self-hosted.js';

function createInMemoryMetadata(): StorageMetadataAdapter {
  const buckets = new Map<string, StorageBucketRecord>([
    [
      'public',
      { id: 'b-pub', name: 'public', visibility: 'public', createdAt: 1 },
    ],
    [
      'private',
      { id: 'b-priv', name: 'private', visibility: 'private', createdAt: 1 },
    ],
  ]);
  const files = new Map<string, StoredFileMeta>();
  return {
    async getBucket(name) {
      return buckets.get(name) ?? null;
    },
    async listBuckets() {
      return [...buckets.values()];
    },
    async createBucket(b) {
      buckets.set(b.name, b);
    },
    async deleteBucket(name) {
      buckets.delete(name);
    },
    async countFilesInBucket(bucket) {
      return [...files.values()].filter((f) => f.bucket === bucket).length;
    },
    async upsertFile(file) {
      files.set(file.storageKey, file);
    },
    async getFile(storageKey, bucket) {
      const f = files.get(storageKey);
      if (!f) return null;
      if (bucket && f.bucket !== bucket) return null;
      return f;
    },
    async updateFileBucket(storageKey, toBucket) {
      const f = files.get(storageKey);
      if (f) f.bucket = toBucket;
    },
    async deleteFile(storageKey) {
      files.delete(storageKey);
    },
  };
}

function createMockBlobDb() {
  const rows = new Map<string, any>();
  return {
    async execute(sql: string, params: any[] = []) {
      const s = sql.trim();
      if (s.startsWith('CREATE') || s.startsWith('ALTER')) return [];
      if (s.startsWith('INSERT INTO')) {
        const [
          id,
          key,
          bucket,
          name,
          mime_type,
          size,
          local_path,
          remote_url,
          status,
          sha256,
          metadata,
          created_at,
          updated_at,
        ] = params;
        rows.set(key, {
          id,
          key,
          bucket,
          name,
          mime_type,
          size,
          local_path,
          remote_url,
          status,
          sha256,
          metadata,
          created_at,
          updated_at,
        });
        return [];
      }
      if (s.startsWith('SELECT * FROM') && s.includes('WHERE key = ?')) {
        const row = rows.get(params[0]);
        return row ? [row] : [];
      }
      if (s.startsWith('SELECT * FROM')) {
        let list = [...rows.values()];
        if (s.includes('status = ?') && s.includes('bucket = ?')) {
          list = list.filter(
            (r) => r.status === params[0] && r.bucket === params[1],
          );
        } else if (s.includes('status = ?')) {
          list = list.filter((r) => r.status === params[0]);
        } else if (s.includes('bucket = ?')) {
          list = list.filter((r) => r.bucket === params[0]);
        }
        return list;
      }
      if (s.startsWith('UPDATE') && s.includes('SET bucket = ?')) {
        const key = params[params.length - 1];
        const row = rows.get(key);
        if (row) {
          row.bucket = params[0];
          if (s.includes('remote_url = ?')) row.remote_url = params[1];
        }
        return [];
      }
      if (s.startsWith('UPDATE') && s.includes('SET status = ?')) {
        const id = params[params.length - 1];
        for (const r of rows.values()) {
          if (r.id === id) {
            r.status = params[0];
            if (s.includes('remote_url = ?')) r.remote_url = params[1];
          }
        }
        return [];
      }
      if (s.startsWith('DELETE') && s.includes('WHERE key = ?')) {
        rows.delete(params[0]);
        return [];
      }
      return [];
    },
  };
}

describe('local-lite multi-bucket storage & createStorageEndpoint', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('uploads, signs, moves, lists, and deletes bucketed blobs end-to-end', async () => {
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'll-buckets-'));
    dirs.push(uploadDir);

    const handler = createStorageEndpoint({
      uploadDir,
      signingSecret: 'test-secret-key-32-characters-long',
      metadata: createInMemoryMetadata(),
      authenticate: async (req) =>
        req.headers.get('authorization') === 'Bearer ok'
          ? { userId: 'u1' }
          : null,
    });

    const uploader = selfHostedStorage('https://api.example.com', {
      getToken: () => 'ok',
      fetch: (input, init) =>
        handler(new Request(String(input), init as RequestInit)),
    });

    const storage = new BlobStorageManager(createMockBlobDb() as any, {
      driver: new MemoryFileDriver(),
      uploader,
      deleteRemoteOnDelete: true,
    });
    await storage.initialize();

    const createdBucket = await storage.createBucket('property-photos', 'public');
    expect(createdBucket.name).toBe('property-photos');

    const saved = await storage.save(
      'avatars/u1.png',
      new Uint8Array([137, 80, 78, 71]),
      { bucket: 'property-photos', name: 'u1.png', mimeType: 'image/png' },
    );
    expect(saved.status).toBe('UPLOADED');
    expect(saved.bucket).toBe('property-photos');
    expect(saved.remoteUrl).toBe(
      'https://api.example.com/storage/files/property-photos/avatars/u1.png',
    );

    const inBucket = await storage.list({ bucket: 'property-photos' });
    expect(inBucket).toHaveLength(1);

    const moved = await storage.move('avatars/u1.png', 'private');
    expect(moved?.bucket).toBe('private');
    expect(moved?.remoteUrl).toBe(
      'https://api.example.com/storage/files/private/avatars/u1.png',
    );

    // Private file requires signed URL
    const unauthedRead = await handler(
      new Request('https://api.example.com/storage/files/private/avatars/u1.png'),
    );
    expect(unauthedRead.status).toBe(401);

    const signed = await storage.getSignedUrl('avatars/u1.png');
    expect(signed?.url).toContain('?token=');
    const authedRead = await handler(new Request(signed!.url));
    expect(authedRead.status).toBe(200);

    await storage.delete('avatars/u1.png');
    expect(await storage.list({ bucket: 'private' })).toHaveLength(0);

    await storage.deleteBucket('property-photos');
    const remainingBuckets = await storage.listBuckets();
    expect(remainingBuckets.some((b) => b.name === 'property-photos')).toBe(
      false,
    );
  });

  it('auto-wires SelfHostedStorageUploader from SelfHostedRemoteAdapter.createStorageUploader', async () => {
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'll-autoremote-'));
    dirs.push(uploadDir);

    const handler = createStorageEndpoint({
      uploadDir,
      signingSecret: 'test-secret-key-32-characters-long',
      metadata: createInMemoryMetadata(),
      authenticate: async (req) =>
        req.headers.get('authorization') === 'Bearer auto-tok'
          ? { userId: 'u2' }
          : null,
    });

    const remote = new SelfHostedRemoteAdapter({
      url: 'https://api.example.com',
      token: 'auto-tok',
      fetch: (input, init) =>
        handler(new Request(String(input), init as RequestInit)),
    });

    const uploader = remote.createStorageUploader({ bucket: 'public-assets' });
    const storage = new BlobStorageManager(createMockBlobDb() as any, {
      driver: new MemoryFileDriver(),
      uploader,
      bucket: 'public-assets',
    });
    await storage.initialize();

    const saved = await storage.save(
      'logos/b1.png',
      new Uint8Array([137, 80, 78, 71]),
      { name: 'b1.png', mimeType: 'image/png' },
    );
    expect(saved.status).toBe('UPLOADED');
    expect(saved.bucket).toBe('public-assets');
    expect(saved.remoteUrl).toBe(
      'https://api.example.com/storage/files/public-assets/logos/b1.png',
    );
  });
});
