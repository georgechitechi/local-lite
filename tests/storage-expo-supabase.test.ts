import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ExpoFileDriver,
  createSupabaseStorageUploader,
  BlobStorageManager,
  bytesToBase64,
  base64ToBytes,
} from '../src/storage/index.js';
import { SupabaseAdapter } from '../src/adapters/remote/supabase.js';
import { MockDB } from './helpers/mock-db.js';

describe('ExpoFileDriver & Supabase Storage Integration', () => {
  let mockFsStorage: Map<string, string>;
  let mockFs: any;
  let driver: ExpoFileDriver;

  beforeEach(() => {
    mockFsStorage = new Map<string, string>();
    mockFs = {
      documentDirectory: 'file:///data/user/0/com.app/files/',
      cacheDirectory: 'file:///data/user/0/com.app/cache/',
      EncodingType: {
        UTF8: 'utf8',
        Base64: 'base64',
      },
      getInfoAsync: vi.fn(async (uri: string) => {
        const exists = mockFsStorage.has(uri);
        return {
          exists,
          isDirectory: false,
          size: exists ? mockFsStorage.get(uri)!.length : 0,
          uri,
        };
      }),
      writeAsStringAsync: vi.fn(async (uri: string, contents: string) => {
        mockFsStorage.set(uri, contents);
      }),
      readAsStringAsync: vi.fn(async (uri: string) => {
        if (!mockFsStorage.has(uri)) {
          throw new Error('File not found');
        }
        return mockFsStorage.get(uri)!;
      }),
      makeDirectoryAsync: vi.fn(async () => {}),
      deleteAsync: vi.fn(async (uri: string) => {
        mockFsStorage.delete(uri);
      }),
      copyAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
        const content = mockFsStorage.get(from) || 'MOCK_IMAGE_DATA_BASE64';
        mockFsStorage.set(to, content);
      }),
      downloadAsync: vi.fn(async (url: string, fileUri: string) => {
        mockFsStorage.set(fileUri, 'DOWNLOADED_BINARY_BASE64');
        return { uri: fileUri, status: 200, headers: {} };
      }),
    };

    driver = new ExpoFileDriver({
      fileSystem: mockFs,
    });
  });

  describe('ExpoFileDriver', () => {
    it('correctly writes and reads binary data using base64 encoding', async () => {
      const originalBytes = new Uint8Array([0, 1, 2, 255, 128, 64, 32]);
      const fileUri = await driver.write('photos/room.jpg', originalBytes);

      expect(fileUri).toBe('file:///data/user/0/com.app/files/local-lite-blobs/photos/room.jpg');
      expect(mockFs.makeDirectoryAsync).toHaveBeenCalled();
      expect(mockFs.writeAsStringAsync).toHaveBeenCalledWith(
        fileUri,
        bytesToBase64(originalBytes),
        { encoding: 'base64' }
      );

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
      expect(mockFs.deleteAsync).toHaveBeenCalled();
      expect(await driver.exists('temp.txt')).toBe(false);
    });

    it('copies local file directly via copyFrom', async () => {
      const sourceUri = 'file:///data/user/0/com.app/cache/camera-picker.jpg';
      mockFsStorage.set(sourceUri, 'PICKED_IMAGE_BASE64');

      const destUri = await driver.copyFrom(sourceUri, 'avatars/profile.jpg');
      expect(destUri).toBe('file:///data/user/0/com.app/files/local-lite-blobs/avatars/profile.jpg');
      expect(mockFs.copyAsync).toHaveBeenCalledWith({ from: sourceUri, to: destUri });
      expect(mockFsStorage.get(destUri)).toBe('PICKED_IMAGE_BASE64');
    });

    it('downloads remote file directly via downloadFrom', async () => {
      const remoteUrl = 'https://example.com/cdn/file.pdf';
      const destUri = await driver.downloadFrom(remoteUrl, 'docs/contract.pdf');

      expect(destUri).toBe('file:///data/user/0/com.app/files/local-lite-blobs/docs/contract.pdf');
      expect(mockFs.downloadAsync).toHaveBeenCalledWith(remoteUrl, destUri);
    });

    it('resolves URI without reading bytes', async () => {
      const uri = await driver.getUri('gallery/thumb.png');
      expect(uri).toBe('file:///data/user/0/com.app/files/local-lite-blobs/gallery/thumb.png');
    });
  });

  describe('ExpoFileDriver with modern Expo File and Directory (SDK >57/58)', () => {
    const mockFileStore = new Map<string, Uint8Array>();

    class MockDirectory {
      exists = true;
      uri: string;
      constructor(...parts: any[]) {
        this.uri = parts
          .map((p) => (typeof p === 'object' && p ? p.uri : String(p)))
          .join('/')
          .replace(/\/+/g, '/');
      }
      create() {
        this.exists = true;
      }
    }

    class MockFile {
      uri: string;
      parentDirectory: MockDirectory;

      constructor(...parts: any[]) {
        this.uri = parts
          .map((p) => (typeof p === 'object' && p ? p.uri : String(p)))
          .join('/')
          .replace(/\/+/g, '/');
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
        const data = mockFileStore.get(this.uri);
        return data ? new Uint8Array(data) : new Uint8Array(0);
      }

      delete() {
        mockFileStore.delete(this.uri);
      }

      async copy(dest: MockFile) {
        const data = mockFileStore.get(this.uri);
        if (data) {
          mockFileStore.set(dest.uri, new Uint8Array(data));
        }
      }
    }

    const MockPaths = {
      document: new MockDirectory('file:///data/user/0/com.app/files'),
      cache: new MockDirectory('file:///data/user/0/com.app/cache'),
    };

    let modernDriver: ExpoFileDriver;

    beforeEach(() => {
      mockFileStore.clear();
      modernDriver = new ExpoFileDriver({
        File: MockFile,
        Directory: MockDirectory,
        Paths: MockPaths,
      });
    });

    it('writes and reads binary directly via File.write and File.bytes', async () => {
      const bytes = new Uint8Array([10, 20, 30, 40, 50]);
      const fileUri = await modernDriver.write('documents/invoice.pdf', bytes);

      expect(fileUri).toContain('local-lite-blobs/documents/invoice.pdf');
      expect(await modernDriver.exists('documents/invoice.pdf')).toBe(true);

      const readBytes = await modernDriver.read('documents/invoice.pdf');
      expect(readBytes).toEqual(bytes);
      expect(await modernDriver.getSize('documents/invoice.pdf')).toBe(5);
    });

    it('deletes modern file', async () => {
      await modernDriver.write('test.log', new Uint8Array([1]));
      expect(await modernDriver.exists('test.log')).toBe(true);

      await modernDriver.delete('test.log');
      expect(await modernDriver.exists('test.log')).toBe(false);
      expect(await modernDriver.read('test.log')).toBeNull();
    });

    it('copies directly between File instances via copyFrom', async () => {
      const srcFile = new MockFile('file:///cache/picked-image.jpg');
      await srcFile.write(new Uint8Array([100, 200]));

      const destUri = await modernDriver.copyFrom(srcFile.uri, 'avatars/me.jpg');
      expect(destUri).toContain('avatars/me.jpg');

      const read = await modernDriver.read('avatars/me.jpg');
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
      // Put base64 in cache
      const sampleBytes = new Uint8Array([255, 216, 255, 224]); // JPEG magic header
      mockFsStorage.set(cameraUri, bytesToBase64(sampleBytes));

      const record = await storage.saveFromUri('photos/house1.jpg', cameraUri, {
        name: 'house1.jpg',
        mimeType: 'image/jpeg',
      });

      expect(record.status).toBe('UPLOADED');
      expect(record.remoteUrl).toBe(
        'https://xyz.supabase.co/storage/v1/object/public/properties/photos/house1.jpg'
      );
      expect(mockFs.copyAsync).toHaveBeenCalled();
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
      expect(mockFs.downloadAsync).toHaveBeenCalled();
    });
  });
});
