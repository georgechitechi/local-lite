import {
  BlobRecord,
  RemoteStorageUploader,
  RemoteStorageUploadResult,
} from './types.js';

export interface FirebaseStorageModule {
  ref?: (storage: any, path: string) => any;
  uploadBytes?: (
    ref: any,
    data: Uint8Array | Blob | ArrayBuffer,
    metadata?: any,
  ) => Promise<any>;
  getDownloadURL?: (ref: any) => Promise<string>;
  deleteObject?: (ref: any) => Promise<void>;
}

export interface FirebaseStorageUploaderOptions {
  /**
   * Optional bucket name or gs:// bucket URL.
   */
  bucket?: string;

  /**
   * Base folder or path prefix in Firebase Storage (e.g. 'media/').
   */
  basePath?: string;

  /**
   * Custom path transformation function.
   * Default: `${basePath}/${key}`
   */
  pathTransform?: (key: string, blob?: BlobRecord) => string;

  /**
   * Optional reference to modular `firebase/storage` functions
   * (e.g. `import * as storageModule from 'firebase/storage'`).
   */
  storageModule?: FirebaseStorageModule;

  /**
   * Optional custom metadata attached to uploaded blobs.
   */
  customMetadata?:
    Record<string, string> | ((blob: BlobRecord) => Record<string, string>);

  /**
   * Cache control HTTP header (e.g. 'public, max-age=31536000').
   */
  cacheControl?: string;
}

export interface FirebaseStorageUploaderInstance extends RemoteStorageUploader {
  getDownloadUrl(keyOrPath: string): Promise<string>;
  delete(keyOrPath: string): Promise<void>;
}

/**
 * Creates a RemoteStorageUploader that syncs binary files to Firebase Cloud Storage
 * using the Firebase v11+ modular SDK (`firebase/storage`).
 */
export function createFirebaseStorageUploader(
  storage: any,
  options: FirebaseStorageUploaderOptions = {},
): FirebaseStorageUploaderInstance {
  if (!storage) {
    throw new Error('FirebaseStorage instance must be provided.');
  }

  let cachedMod: FirebaseStorageModule | null = options.storageModule ?? null;
  const getMod = async (): Promise<FirebaseStorageModule> => {
    if (cachedMod) return cachedMod;
    try {
      const modName = 'firebase/storage';
      cachedMod = (await import(
        /* @vite-ignore */ modName
      )) as FirebaseStorageModule;
      return cachedMod;
    } catch {
      throw new Error(
        'Modular firebase/storage SDK is required. Install firebase >=11 or pass options.storageModule.',
      );
    }
  };

  const resolveRemotePath = (key: string, blob?: BlobRecord): string => {
    if (options.pathTransform) {
      return options.pathTransform(key, blob);
    }
    const cleanKey = key.replace(/^\/+/, '');
    if (options.basePath) {
      const cleanBase = options.basePath.replace(/^\/+|\/+$/g, '');
      return `${cleanBase}/${cleanKey}`;
    }
    return cleanKey;
  };

  return {
    async upload(
      blob: BlobRecord,
      data: Uint8Array,
    ): Promise<RemoteStorageUploadResult> {
      const mod = await getMod();
      if (
        typeof mod.ref !== 'function' ||
        typeof mod.uploadBytes !== 'function'
      ) {
        throw new Error(
          'Modular firebase/storage functions (ref, uploadBytes) are required.',
        );
      }

      const remotePath = resolveRemotePath(blob.key, blob);
      const fileRef = mod.ref(storage, remotePath);

      const metadata: Record<string, any> = {
        contentType: blob.mimeType || 'application/octet-stream',
      };
      if (options.cacheControl) {
        metadata.cacheControl = options.cacheControl;
      }
      if (options.customMetadata) {
        const extra =
          typeof options.customMetadata === 'function'
            ? options.customMetadata(blob)
            : options.customMetadata;
        metadata.customMetadata = extra;
      }

      await mod.uploadBytes(fileRef, data, metadata);
      const remoteUrl =
        typeof mod.getDownloadURL === 'function'
          ? await mod.getDownloadURL(fileRef)
          : remotePath;
      return { remoteUrl, metadata };
    },

    async getDownloadUrl(keyOrPath: string): Promise<string> {
      const mod = await getMod();
      if (
        typeof mod.ref !== 'function' ||
        typeof mod.getDownloadURL !== 'function'
      ) {
        throw new Error(
          'Modular firebase/storage functions (ref, getDownloadURL) are required.',
        );
      }
      const remotePath = resolveRemotePath(keyOrPath);
      const fileRef = mod.ref(storage, remotePath);
      return await mod.getDownloadURL(fileRef);
    },

    async delete(keyOrPath: string): Promise<void> {
      const mod = await getMod();
      if (
        typeof mod.ref !== 'function' ||
        typeof mod.deleteObject !== 'function'
      ) {
        throw new Error(
          'Modular firebase/storage functions (ref, deleteObject) are required.',
        );
      }
      const remotePath = resolveRemotePath(keyOrPath);
      const fileRef = mod.ref(storage, remotePath);
      await mod.deleteObject(fileRef);
    },
  };
}
