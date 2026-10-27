import { BlobRecord, RemoteStorageUploader, RemoteStorageUploadResult } from './types.js';

export interface FirebaseStorageModule {
  ref?: (storage: any, path: string) => any;
  uploadBytes?: (ref: any, data: Uint8Array | Blob | ArrayBuffer, metadata?: any) => Promise<any>;
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
  customMetadata?: Record<string, string> | ((blob: BlobRecord) => Record<string, string>);

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
 * Creates a RemoteStorageUploader that syncs binary files to Firebase Cloud Storage.
 * Supports both Firebase v9+ modular SDK and v8/compat SDKs.
 */
export function createFirebaseStorageUploader(
  storageOrApp: any,
  options: FirebaseStorageUploaderOptions = {}
): FirebaseStorageUploaderInstance {
  if (!storageOrApp) {
    throw new Error('Firebase Storage instance, app, or modular client must be provided.');
  }

  // Determine storage instance
  let storageInstance = storageOrApp;
  if (typeof storageOrApp.storage === 'function') {
    // FirebaseApp compat
    storageInstance = storageOrApp.storage(options.bucket);
  }

  const mod = options.storageModule || {};

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

  const getRef = (path: string) => {
    // 1. Modular SDK ref(storage, path)
    if (typeof mod.ref === 'function') {
      return mod.ref(storageInstance, path);
    }
    // 2. Storage instance ref(path) method
    if (typeof storageInstance.ref === 'function') {
      return storageInstance.ref(path);
    }
    // 3. Storage instance from bucket
    if (typeof storageInstance.bucket === 'function') {
      const b = storageInstance.bucket(options.bucket);
      return typeof b.file === 'function' ? b.file(path) : b;
    }
    throw new Error(
      'Cannot resolve Firebase Storage reference. Pass storageModule ({ ref, uploadBytes, getDownloadURL }) or a FirebaseStorage instance.'
    );
  };

  return {
    async upload(blob: BlobRecord, data: Uint8Array): Promise<RemoteStorageUploadResult> {
      const remotePath = resolveRemotePath(blob.key, blob);
      const fileRef = getRef(remotePath);

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

      // Method A: Modular SDK uploadBytes
      if (typeof mod.uploadBytes === 'function') {
        await mod.uploadBytes(fileRef, data, metadata);
        let remoteUrl = remotePath;
        if (typeof mod.getDownloadURL === 'function') {
          remoteUrl = await mod.getDownloadURL(fileRef);
        }
        return { remoteUrl, metadata };
      }

      // Method B: Compat put() or upload()
      if (typeof fileRef.put === 'function') {
        const snapshot = await fileRef.put(data, metadata);
        let remoteUrl: string;
        if (typeof snapshot?.ref?.getDownloadURL === 'function') {
          remoteUrl = await snapshot.ref.getDownloadURL();
        } else if (typeof fileRef.getDownloadURL === 'function') {
          remoteUrl = await fileRef.getDownloadURL();
        } else {
          remoteUrl = remotePath;
        }
        return { remoteUrl, metadata };
      }

      // Method C: GCS admin save()
      if (typeof fileRef.save === 'function') {
        await fileRef.save(Buffer.isBuffer(data) ? data : Buffer.from(data), {
          contentType: metadata.contentType,
          metadata: metadata.customMetadata,
        });
        let remoteUrl = remotePath;
        if (typeof fileRef.getSignedUrl === 'function') {
          const [url] = await fileRef.getSignedUrl({
            action: 'read',
            expires: Date.now() + 86400 * 1000,
          });
          remoteUrl = url;
        }
        return { remoteUrl, metadata };
      }

      throw new Error('Unsupported Firebase Storage client: missing uploadBytes, put, or save method.');
    },

    async getDownloadUrl(keyOrPath: string): Promise<string> {
      const remotePath = resolveRemotePath(keyOrPath);
      const fileRef = getRef(remotePath);

      if (typeof mod.getDownloadURL === 'function') {
        return await mod.getDownloadURL(fileRef);
      }
      if (typeof fileRef.getDownloadURL === 'function') {
        return await fileRef.getDownloadURL();
      }
      if (typeof fileRef.getSignedUrl === 'function') {
        const [url] = await fileRef.getSignedUrl({
          action: 'read',
          expires: Date.now() + 86400 * 1000,
        });
        return url;
      }
      return remotePath;
    },

    async delete(keyOrPath: string): Promise<void> {
      const remotePath = resolveRemotePath(keyOrPath);
      const fileRef = getRef(remotePath);

      if (typeof mod.deleteObject === 'function') {
        await mod.deleteObject(fileRef);
        return;
      }
      if (typeof fileRef.delete === 'function') {
        await fileRef.delete();
        return;
      }
    },
  };
}
