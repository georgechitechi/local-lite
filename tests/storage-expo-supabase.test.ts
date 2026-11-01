import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ExpoFileDriver,
  createSupabaseStorageUploader,
  BlobStorageManager,
} from '../src/storage/index.js';
import { SupabaseAdapter } from '../src/adapters/remote/supabase.js';
import { MockDB } from './helpers/mock-db.js';

describe('ExpoFileDriver & Supabase Storage Integration', () => {
  const mockFileStore = new Map<string, Uint8Array>();

  class MockDirectory {
    exists = true;
    uri: string;

    constructor(...parts: any[]) {
      this.uri = parts.reduce((path, part) => {
        const segment = typeof part === 'object' && part ? part.uri : String(part);
        return path ? `${path.replace(/\/+$/, '')}/${segment.replace(/^\/+/, '')}` : segment;
      }, '');
    }

    create() {
      this.exists = true;
    }
  }

  class MockFile {
    uri: string;
    parentDirectory: MockDirectory;

    constructor(...parts: any[]) {
      this.uri = parts.reduce((path, part) => {
        const segment = typeof part === 'object' && part ? part.uri : String(part);
        return path ? `${path.replace(/\/+$/, '')}/${segment.replace(/^\/+/, '')}` : segment;
      }, '');
      const lastSlash = this.uri.lastIndexOf('/');
      this.parentDirectory = new MockDirectory(
        lastSlash === -1 ? 'file:///' : this.uri.substring(0, lastSlash)
      );
    }

    get exists(): boolean {
      return mockFileStore.has(this.uri);
    }

    get size(): number {
      return mockFileStore.get(this.uri)?.byteLength ?? 0;
    }

    async write(content: Uint8Array) {
      mockFileStore.set(this.uri, new Uint8Array(content));
    }

    async bytes(): Promise<Uint8Array> {
      return new Uint8Array(mockFileStore.get(this.uri) ?? []);
    }

    delete() {
      mockFileStore.delete(this.uri);
    }

    async copy(destination: MockFile) {
      const data = mockFileStore.get(this.uri);
      if (data) mockFileStore.set(destination.uri, new Uint8Array(data));
    }

    static async downloadFileAsync(_url: string, file: MockFile) {
      await file.write(new Uint8Array([10, 20, 30]));
    }
  }

  const mockPaths = {
    document: new MockDirectory('file:///data/user/0/com.app/files'),
    cache: new MockDirectory('file:///data/user/0/com.app/cache'),
  };

  let driver: ExpoFileDriver;

  beforeEach(() => {
    mockFileStore.clear();
    driver = new ExpoFileDriver({
      File: MockFile,
      Directory: MockDirectory,
      Paths: mockPaths,
    });
  });

  it('rejects the removed legacy FileSystem module option', () => {
    expect(() => new ExpoFileDriver({ fileSystem: {} } as any)).toThrow(
      'ExpoFileDriver no longer accepts fileSystem'
    );
  });

  describe('ExpoFileDriver', () => {
    it('writes and reads binary data using the Expo File API', async () => {
      const originalBytes = new Uint8Array([0, 1, 2, 255, 128, 64, 32]);
      const fileUri = await driver.write('photos/room.jpg', originalBytes);

      expect(fileUri).toBe('file:///data/user/0/com.app/files/local-lite-blobs/photos/room.jpg');
      const exists = await driver.exists('photos/room.jpg');
      expect(exists).toBe(true);

      const readBytes = await driver.read('photos/room.jpg');
      expect(readBytes).not.toBeNull();
      expect(readBytes).toEqual(originalBytes);
    });

    it('returns null when reading non-existent file', async () => {
      const result = await driver.read('does_not_exist.png');
      expect(result).toBeNull();
    });

    it('deletes file correctly', async () => {
      await driver.write('temp.txt', new Uint8Array([1, 2, 3]));
      expect(await driver.exists('temp.txt')).toBe(true);

      await driver.delete('temp.txt');
      expect(await driver.exists('temp.txt')).toBe(false);
    });

    it('copies local file directly via copyFrom', async () => {
      const sourceUri = 'file:///data/user/0/com.app/cache/camera-picker.jpg';
      mockFileStore.set(sourceUri, new Uint8Array([1, 2, 3]));

      const destUri = await driver.copyFrom(sourceUri, 'avatars/profile.jpg');
      expect(destUri).toBe('file:///data/user/0/com.app/files/local-lite-blobs/avatars/profile.jpg');
      expect(mockFileStore.get(destUri)).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('downloads remote file directly via downloadFrom', async () => {
      const remoteUrl = 'https://example.com/cdn/file.pdf';
      const destUri = await driver.downloadFrom(remoteUrl, 'docs/contract.pdf');

      expect(destUri).toBe('file:///data/user/0/com.app/files/local-lite-blobs/docs/contract.pdf');
      expect(mockFileStore.get(destUri)).toEqual(new Uint8Array([10, 20, 30]));
    });

    it('resolves URI without reading bytes', async () => {
      const uri = await driver.getUri('gallery/thumb.png');
      expect(uri).toBe('file:///data/user/0/com.app/files/local-lite-blobs/gallery/thumb.png');
    });
  });

  describe('Expo SDK 58+ File API', () => {
    it('writes and reads binary directly via File.write and File.bytes', async () => {
      const bytes = new Uint8Array([10, 20, 30, 40, 50]);
      const fileUri = await driver.write('documents/invoice.pdf', bytes);

      expect(fileUri).toContain('local-lite-blobs/documents/invoice.pdf');
      expect(await driver.exists('documents/invoice.pdf')).toBe(true);

      const readBytes = await driver.read('documents/invoice.pdf');
      expect(readBytes).toEqual(bytes);
      expect(await driver.getSize('documents/invoice.pdf')).toBe(5);
    });

    it('deletes modern file', async () => {
      await driver.write('test.log', new Uint8Array([1]));
      expect(await driver.exists('test.log')).toBe(true);

      await driver.delete('test.log');
      expect(await driver.exists('test.log')).toBe(false);
      expect(await driver.read('test.log')).toBeNull();
    });

    it('copies directly between File instances via copyFrom', async () => {
      const srcFile = new MockFile('file:///cache/picked-image.jpg');
      await srcFile.write(new Uint8Array([100, 200]));

      const destUri = await driver.copyFrom(srcFile.uri, 'avatars/me.jpg');
      expect(destUri).toContain('avatars/me.jpg');

      const read = await driver.read('avatars/me.jpg');
      expect(read).toEqual(new Uint8Array([100, 200]));
    });
  });

  describe('createSupabaseStorageUploader', () => {
    let mockSupabase: any;
    let mockBucket: any;

    beforeEach(() => {
      mockBucket = {
        upload: vi.fn(async (path: string, data: any, options: any) => ({
          data: { path },
          error: null,
        })),
        getPublicUrl: vi.fn((path: string) => ({
          data: { publicUrl: `https://xyz.supabase.co/storage/v1/object/public/properties/${path}` },
        })),
        createSignedUrl: vi.fn(async (path: string, expiresIn: number) => ({
          data: { signedUrl: `https://xyz.supabase.co/storage/v1/object/sign/properties/${path}?token=secret` },
          error: null,
        })),
      };

      mockSupabase = {
        storage: {
          from: vi.fn((bucketName: string) => mockBucket),
        },
      };
    });

    it('uploads file and returns public URL', async () => {
      const uploader = createSupabaseStorageUploader(mockSupabase, {
        bucket: 'properties',
      });

      const blobRecord = {
        id: 'blob-1',
        key: 'houses/101/main.jpg',
        name: 'main.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        localPath: 'file:///local/path',
        status: 'PENDING' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const data = new Uint8Array([10, 20, 30]);

      const result = await uploader.upload(blobRecord, data);
      expect(mockSupabase.storage.from).toHaveBeenCalledWith('properties');
      expect(mockBucket.upload).toHaveBeenCalledWith(
        'houses/101/main.jpg',
        data,
        expect.objectContaining({
          contentType: 'image/jpeg',
          upsert: true,
        })
      );
      expect(result.remoteUrl).toBe(
        'https://xyz.supabase.co/storage/v1/object/public/properties/houses/101/main.jpg'
      );
    });

    it('supports signed URLs for private buckets', async () => {
      const uploader = createSupabaseStorageUploader(mockSupabase, {
        bucket: 'properties',
        urlType: 'signed',
        signedUrlExpiresIn: 3600,
      });

      const blobRecord = {
        id: 'blob-2',
        key: 'leases/tenant_contract.pdf',
        name: 'tenant_contract.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        localPath: 'file:///local/path',
        status: 'PENDING' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = await uploader.upload(blobRecord, new Uint8Array([1, 2, 3]));
      expect(mockBucket.createSignedUrl).toHaveBeenCalledWith('leases/tenant_contract.pdf', 3600);
      expect(result.remoteUrl).toContain('token=secret');
    });

    it('throws descriptive error if Supabase upload fails', async () => {
      mockBucket.upload = vi.fn(async () => ({
        data: null,
        error: { message: 'Bucket not found' },
      }));

      const uploader = createSupabaseStorageUploader(mockSupabase, {
        bucket: 'properties',
      });

      const blobRecord = {
        id: 'blob-3',
        key: 'test.jpg',
        name: 'test.jpg',
        mimeType: 'image/jpeg',
        size: 100,
        localPath: 'file:///local/test.jpg',
        status: 'PENDING' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await expect(uploader.upload(blobRecord, new Uint8Array([1]))).rejects.toThrow(
        'Supabase Storage upload failed for "test.jpg": Bucket not found'
      );
    });
  });

  describe('BlobStorageManager with ExpoFileDriver & Supabase Adapter', () => {
    let db: MockDB;
    let mockSupabase: any;
    let mockBucket: any;
    let storage: BlobStorageManager;

    beforeEach(async () => {
      db = new MockDB();
      mockBucket = {
        upload: vi.fn(async (path: string) => ({ data: { path }, error: null })),
        getPublicUrl: vi.fn((path: string) => ({
          data: { publicUrl: `https://xyz.supabase.co/storage/v1/object/public/properties/${path}` },
        })),
      };
      mockSupabase = {
        storage: {
          from: vi.fn(() => mockBucket),
        },
      };

      const remoteAdapter = new SupabaseAdapter(mockSupabase, {
        tables: ['properties'],
      });
      const uploader = remoteAdapter.createStorageUploader({
        bucket: 'properties',
      });

      storage = new BlobStorageManager(db, {
        driver,
        uploader,
      });
      await storage.initialize();
    });

    it('saves file to Expo storage and immediately uploads to Supabase', async () => {
      const bytes = new TextEncoder().encode('Hello Expo + Supabase!');
      const record = await storage.save('listings/apartment.txt', bytes, {
        mimeType: 'text/plain',
      });

      expect(record.status).toBe('UPLOADED');
      expect(record.remoteUrl).toBe(
        'https://xyz.supabase.co/storage/v1/object/public/properties/listings/apartment.txt'
      );
      expect(record.localPath).toBe(
        'file:///data/user/0/com.app/files/local-lite-blobs/listings/apartment.txt'
      );

      // Verify file is saved locally in Expo
      const localUri = await storage.getLocalUri('listings/apartment.txt');
      expect(localUri).toBe(record.localPath);
      expect(await driver.exists('listings/apartment.txt')).toBe(true);
    });

    it('saves picked image via saveFromUri and uploads to Supabase', async () => {
      const cameraUri = 'file:///data/user/0/com.app/cache/camera.jpg';
      const sampleBytes = new Uint8Array([255, 216, 255, 224]); // JPEG magic header
      mockFileStore.set(cameraUri, sampleBytes);

      const record = await storage.saveFromUri('photos/house1.jpg', cameraUri, {
        name: 'house1.jpg',
        mimeType: 'image/jpeg',
      });

      expect(record.status).toBe('UPLOADED');
      expect(record.remoteUrl).toBe(
        'https://xyz.supabase.co/storage/v1/object/public/properties/photos/house1.jpg'
      );
      expect(mockFileStore.get(record.localPath)).toEqual(sampleBytes);
    });

    it('downloads remote asset to Expo storage and updates metadata', async () => {
      const record = await storage.download(
        'cached/online-photo.jpg',
        'https://xyz.supabase.co/storage/v1/object/public/properties/online-photo.jpg',
        { mimeType: 'image/jpeg' }
      );

      expect(record.status).toBe('UPLOADED');
      expect(record.remoteUrl).toBe(
        'https://xyz.supabase.co/storage/v1/object/public/properties/online-photo.jpg'
      );
      expect(await driver.exists('cached/online-photo.jpg')).toBe(true);
    });
  });
});
