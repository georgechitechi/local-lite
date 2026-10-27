import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BlobStorageManager,
  MemoryFileDriver,
  createSupabaseStorageUploader,
  createConvexStorageUploader,
  createFirebaseStorageUploader,
  createStorageUploader,
} from '../src/storage/index.js';
import { SupabaseAdapter } from '../src/adapters/remote/supabase.js';
import { ConvexRemoteAdapter } from '../src/adapters/remote/convex.js';
import { FirestoreAdapter } from '../src/adapters/remote/firestore.js';
import { LocalFirstClient } from '../src/core/client.js';
import { MockDB } from './helpers/mock-db.js';

describe('Multi-Cloud Storage Providers (Supabase, Convex, Firebase)', () => {
  let db: MockDB;
  let driver: MemoryFileDriver;

  beforeEach(() => {
    db = new MockDB();
    driver = new MemoryFileDriver();
  });

  describe('Supabase Storage Uploader', () => {
    it('uploads files, returns public URL, and supports deletion', async () => {
      const uploadedFiles = new Map<string, any>();
      const mockSupabase = {
        storage: {
          from: vi.fn((bucket: string) => ({
            upload: vi.fn(async (path: string, data: any, opts: any) => {
              uploadedFiles.set(`${bucket}/${path}`, { data, opts });
              return { data: { path }, error: null };
            }),
            getPublicUrl: vi.fn((path: string) => ({
              data: { publicUrl: `https://xyz.supabase.co/storage/v1/object/public/${bucket}/${path}` },
            })),
            createSignedUrl: vi.fn(async (path: string, exp: number) => ({
              data: { signedUrl: `https://xyz.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=abc&expires=${exp}` },
              error: null,
            })),
            remove: vi.fn(async (paths: string[]) => {
              for (const p of paths) {
                uploadedFiles.delete(`${bucket}/${p}`);
              }
              return { data: paths, error: null };
            }),
          })),
        },
      };

      const uploader = createSupabaseStorageUploader(mockSupabase, {
        bucket: 'media',
      });

      const blobRecord: any = {
        id: 'blob-1',
        key: 'photos/avatar.jpg',
        name: 'avatar.jpg',
        mimeType: 'image/jpeg',
      };
      const testBytes = new Uint8Array([10, 20, 30]);

      // Upload
      const result = await uploader.upload(blobRecord, testBytes);
      expect(result.remoteUrl).toBe('https://xyz.supabase.co/storage/v1/object/public/media/photos/avatar.jpg');
      expect(uploadedFiles.has('media/photos/avatar.jpg')).toBe(true);

      // getDownloadUrl
      const dlUrl = await uploader.getDownloadUrl('photos/avatar.jpg');
      expect(dlUrl).toBe('https://xyz.supabase.co/storage/v1/object/public/media/photos/avatar.jpg');

      // Delete
      await uploader.delete('photos/avatar.jpg');
      expect(uploadedFiles.has('media/photos/avatar.jpg')).toBe(false);
    });

    it('supports signed URLs when configured with urlType: signed', async () => {
      const mockSupabase = {
        storage: {
          from: () => ({
            upload: async () => ({ data: { path: 'contracts/lease.pdf' }, error: null }),
            createSignedUrl: async (path: string) => ({
              data: { signedUrl: `https://xyz.supabase.co/storage/v1/object/sign/docs/${path}?token=xyz` },
              error: null,
            }),
          }),
        },
      };

      const uploader = createSupabaseStorageUploader(mockSupabase, {
        bucket: 'docs',
        urlType: 'signed',
        signedUrlExpiresIn: 3600,
      });

      const res = await uploader.upload({ id: '1', key: 'contracts/lease.pdf' } as any, new Uint8Array([1]));
      expect(res.remoteUrl).toContain('https://xyz.supabase.co/storage/v1/object/sign/docs/contracts/lease.pdf?token=xyz');
    });
  });

  describe('Convex File Storage Uploader', () => {
    it('generates upload URL, POSTs payload, receives storageId, and resolves serving URL', async () => {
      const fileRegistry = new Map<string, Uint8Array>();
      let generateCalled = false;
      let saveMutationPayload: any = null;

      const mockConvexClient = {
        mutation: vi.fn(async (mutationName: any, args: any) => {
          if (mutationName === 'sync:generateUploadUrl' || mutationName === 'generateUploadUrl') {
            generateCalled = true;
            return 'https://convex.cloud/api/upload/url-123';
          }
          if (mutationName === 'saveFileRecord') {
            saveMutationPayload = args;
            return 'doc-1';
          }
          if (mutationName === 'deleteFile') {
            fileRegistry.delete(args.storageId);
            return true;
          }
        }),
        query: vi.fn(async (queryName: any, args: any) => {
          if (queryName === 'getUrl') {
            return `https://convex.cloud/api/storage/${args.storageId}`;
          }
          return null;
        }),
      };

      // Mock fetch
      const mockFetch = vi.fn(async (url: string, init: any) => {
        expect(url).toBe('https://convex.cloud/api/upload/url-123');
        expect(init.method).toBe('POST');
        fileRegistry.set('storage-id-999', init.body);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ storageId: 'storage-id-999' }),
        };
      }) as any;

      const uploader = createConvexStorageUploader(mockConvexClient, {
        uploadMutation: 'generateUploadUrl',
        getUrlQuery: 'getUrl',
        saveFileMutation: 'saveFileRecord',
        deleteMutation: 'deleteFile',
        fetchFn: mockFetch,
      });

      const blobRecord: any = {
        id: 'blob-cvx-1',
        key: 'documents/spec.pdf',
        name: 'spec.pdf',
        mimeType: 'application/pdf',
        size: 50,
      };
      const testBytes = new Uint8Array([1, 2, 3, 4, 5]);

      const result = await uploader.upload(blobRecord, testBytes);
      expect(generateCalled).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
      expect(result.storageId).toBe('storage-id-999');
      expect(result.remoteUrl).toBe('https://convex.cloud/api/storage/storage-id-999');
      expect(saveMutationPayload).not.toBeNull();
      expect(saveMutationPayload.storageId).toBe('storage-id-999');

      // Test getDownloadUrl
      const dlUrl = await uploader.getDownloadUrl('documents/spec.pdf');
      expect(dlUrl).toBe('https://convex.cloud/api/storage/storage-id-999');

      // Test deletion
      await uploader.delete('storage-id-999');
      expect(mockConvexClient.mutation).toHaveBeenCalledWith('deleteFile', { storageId: 'storage-id-999' });
    });
  });

  describe('Firebase Cloud Storage Uploader', () => {
    it('supports modular Firebase SDK (uploadBytes and getDownloadURL)', async () => {
      const storageBucket = new Map<string, any>();

      const mockModularStorage = {
        ref: vi.fn((storage: any, path: string) => ({ path, storage })),
        uploadBytes: vi.fn(async (fileRef: any, data: any, metadata: any) => {
          storageBucket.set(fileRef.path, { data, metadata });
          return { ref: fileRef };
        }),
        getDownloadURL: vi.fn(async (fileRef: any) => {
          return `https://firebasestorage.googleapis.com/v0/b/my-app.appspot.com/o/${encodeURIComponent(fileRef.path)}?alt=media`;
        }),
        deleteObject: vi.fn(async (fileRef: any) => {
          storageBucket.delete(fileRef.path);
        }),
      };

      const mockApp = { name: '[DEFAULT]' };

      const uploader = createFirebaseStorageUploader(mockApp, {
        basePath: 'uploads',
        storageModule: mockModularStorage,
        customMetadata: { appVersion: '1.0' },
        cacheControl: 'public, max-age=3600',
      });

      const blobRecord: any = {
        id: 'blob-fb-1',
        key: 'inspections/hallway.jpg',
        name: 'hallway.jpg',
        mimeType: 'image/jpeg',
      };
      const testBytes = new Uint8Array([7, 8, 9]);

      const result = await uploader.upload(blobRecord, testBytes);
      expect(mockModularStorage.uploadBytes).toHaveBeenCalled();
      expect(storageBucket.has('uploads/inspections/hallway.jpg')).toBe(true);
      expect(result.remoteUrl).toContain('https://firebasestorage.googleapis.com/v0/b/my-app.appspot.com/o/uploads%2Finspections%2Fhallway.jpg');

      const dlUrl = await uploader.getDownloadUrl('inspections/hallway.jpg');
      expect(dlUrl).toContain('uploads%2Finspections%2Fhallway.jpg');

      // Delete
      await uploader.delete('inspections/hallway.jpg');
      expect(storageBucket.has('uploads/inspections/hallway.jpg')).toBe(false);
    });

    it('supports compat Firebase Storage instances (ref, put, getDownloadURL)', async () => {
      const storageBucket = new Map<string, any>();

      const mockStorageInstance = {
        ref: vi.fn((path: string) => ({
          path,
          put: vi.fn(async (data: any, meta: any) => {
            storageBucket.set(path, { data, meta });
            return {
              ref: {
                getDownloadURL: async () => `https://storage.googleapis.com/compat/${path}`,
              },
            };
          }),
          getDownloadURL: vi.fn(async () => `https://storage.googleapis.com/compat/${path}`),
          delete: vi.fn(async () => {
            storageBucket.delete(path);
          }),
        })),
      };

      const uploader = createFirebaseStorageUploader(mockStorageInstance);

      const blobRecord: any = {
        id: 'compat-1',
        key: 'avatars/admin.png',
        mimeType: 'image/png',
      };
      const result = await uploader.upload(blobRecord, new Uint8Array([5, 5, 5]));
      expect(result.remoteUrl).toBe('https://storage.googleapis.com/compat/avatars/admin.png');
      expect(storageBucket.has('avatars/admin.png')).toBe(true);

      await uploader.delete('avatars/admin.png');
      expect(storageBucket.has('avatars/admin.png')).toBe(false);
    });
  });

  describe('createStorageUploader Unified Factory', () => {
    it('creates correct uploader instance for each provider', () => {
      const mockSupabase = { storage: { from: () => ({ upload: () => {} }) } };
      const mockConvex = { mutation: () => {} };
      const mockFirebase = { ref: () => {} };

      const u1 = createStorageUploader('supabase', mockSupabase, { bucket: 'b' });
      expect(typeof u1.upload).toBe('function');

      const u2 = createStorageUploader('convex', mockConvex, { uploadMutation: 'gen' });
      expect(typeof u2.upload).toBe('function');

      const u3 = createStorageUploader('firebase', mockFirebase);
      expect(typeof u3.upload).toBe('function');

      expect(() => createStorageUploader('invalid' as any, {})).toThrow('Unsupported storage provider');
    });
  });

  describe('Remote Adapter Shortcuts & LocalFirstClient Auto-Wiring', () => {
    it('ConvexRemoteAdapter exposes createStorageUploader', () => {
      const mockClient = { mutation: vi.fn(), query: vi.fn() };
      const adapter = new ConvexRemoteAdapter(mockClient, { tables: ['posts'] });
      const uploader = adapter.createStorageUploader({ uploadMutation: 'gen' });

      expect(typeof uploader.upload).toBe('function');
      expect(typeof uploader.getUrl).toBe('function');
    });

    it('FirestoreAdapter exposes createStorageUploader', () => {
      const mockDb = { app: { name: 'app' }, collection: () => {} };
      const adapter = new FirestoreAdapter(mockDb, { tables: ['items'] });

      const mockStorageModule = {
        ref: vi.fn(),
        uploadBytes: vi.fn(),
        getDownloadURL: vi.fn(),
      };
      const uploader = adapter.createStorageUploader({ storageModule: mockStorageModule });
      expect(typeof uploader.upload).toBe('function');
    });

    it('LocalFirstClient auto-wires storage uploader from remote adapter', async () => {
      const mockChannel: any = {
        on: vi.fn(() => mockChannel),
        subscribe: vi.fn((cb: any) => {
          if (typeof cb === 'function') cb('SUBSCRIBED');
          return mockChannel;
        }),
      };
      const mockSupabaseClient = {
        from: () => ({ select: () => ({ data: [] }) }),
        channel: () => mockChannel,
        storage: {
          from: vi.fn((bucket: string) => ({
            upload: vi.fn(async (path: string) => ({ data: { path }, error: null })),
            getPublicUrl: vi.fn((path: string) => ({
              data: { publicUrl: `https://supabase.co/${bucket}/${path}` },
            })),
          })),
        },
      };

      const remote = new SupabaseAdapter(mockSupabaseClient, { tables: ['items'] });
      const client = new LocalFirstClient({
        local: db,
        remote,
        storage: {
          driver,
          bucket: 'my-bucket', // Triggers autoRemote
        },
      });

      await client.initialize();

      const blob = await client.storage.save('test.txt', 'Hello Auto Storage!');
      expect(blob.status).toBe('UPLOADED');
      expect(blob.remoteUrl).toBe('https://supabase.co/my-bucket/test.txt');

      client.stop();
    });
  });
});
