import { BlobRecord, RemoteStorageUploader, RemoteStorageUploadResult } from './types.js';

export interface ConvexStorageUploaderOptions {
  /**
   * Name or function reference for Convex mutation that generates an upload URL.
   * Default: 'sync:generateUploadUrl' (or can be `api.files.generateUploadUrl`)
   */
  uploadMutation?: any;

  /**
   * Optional arguments passed to uploadMutation.
   */
  uploadMutationArgs?: Record<string, any> | ((blob: BlobRecord) => Record<string, any>);

  /**
   * Optional name or function reference for Convex query that gets a serving URL from a storageId.
   * e.g. `api.files.getUrl`
   */
  getUrlQuery?: any;

  /**
   * Optional name or function reference for Convex mutation called after file is uploaded,
   * allowing you to persist metadata or link the storageId to your Convex schema.
   */
  saveFileMutation?: any;

  /**
   * Optional name or function reference for Convex mutation called when a file is deleted.
   */
  deleteMutation?: any;

  /**
   * Custom path / metadata transformation.
   */
  pathTransform?: (key: string, blob?: BlobRecord) => string;

  /**
   * Custom fetch function (defaults to global fetch).
   */
  fetchFn?: typeof fetch;
}

export interface ConvexStorageUploaderInstance extends RemoteStorageUploader {
  getUrl(storageId: string): Promise<string | null>;
  getDownloadUrl(keyOrStorageId: string): Promise<string>;
  delete(storageIdOrKey: string): Promise<void>;
}

/**
 * Creates a RemoteStorageUploader that syncs binary files to Convex File Storage.
 */
export function createConvexStorageUploader(
  convex: any,
  options: ConvexStorageUploaderOptions = {}
): ConvexStorageUploaderInstance {
  const uploadMutation = options.uploadMutation ?? 'sync:generateUploadUrl';
  const fetchFn = options.fetchFn ?? (typeof fetch !== 'undefined' ? fetch : undefined);

  if (!convex) {
    throw new Error('Convex client must be provided to createConvexStorageUploader.');
  }

  // Cache of key/storageId mapping
  const storageIdMap = new Map<string, string>();

  return {
    async upload(blob: BlobRecord, data: Uint8Array): Promise<RemoteStorageUploadResult> {
      if (!fetchFn) {
        throw new Error('Fetch API is not available in the current environment.');
      }

      // 1. Generate upload URL via mutation
      const mutationArgs =
        typeof options.uploadMutationArgs === 'function'
          ? options.uploadMutationArgs(blob)
          : options.uploadMutationArgs || {};

      let postUrl: string;
      if (typeof convex.mutation === 'function') {
        postUrl = await convex.mutation(uploadMutation, mutationArgs);
      } else if (typeof convex === 'function') {
        postUrl = await convex(uploadMutation, mutationArgs);
      } else {
        throw new Error('Convex client must support .mutation() method.');
      }

      if (!postUrl || typeof postUrl !== 'string') {
        throw new Error(`Convex generateUploadUrl mutation did not return a valid URL: ${JSON.stringify(postUrl)}`);
      }

      // 2. POST binary data to upload URL
      const response = await fetchFn(postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': blob.mimeType || 'application/octet-stream',
        },
        body: data as any,
      });

      if (!response.ok) {
        throw new Error(`Convex file upload failed with status ${response.status}: ${response.statusText}`);
      }

      const jsonResult = await response.json();
      const storageId: string = jsonResult?.storageId || jsonResult?.id || jsonResult;

      if (!storageId) {
        throw new Error('Convex upload response did not contain a valid storageId.');
      }

      storageIdMap.set(blob.key, storageId);

      // 3. Optional: save file record in Convex schema
      if (options.saveFileMutation) {
        const filePayload = {
          storageId,
          key: blob.key,
          name: blob.name,
          mimeType: blob.mimeType,
          size: blob.size,
          sha256: blob.sha256,
          metadata: blob.metadata,
        };
        if (typeof convex.mutation === 'function') {
          await convex.mutation(options.saveFileMutation, filePayload);
        }
      }

      // 4. Resolve serving URL if query is provided
      let remoteUrl: string = storageId;
      if (options.getUrlQuery) {
        const resolved = await this.getUrl(storageId);
        if (resolved) {
          remoteUrl = resolved;
        }
      }

      return {
        remoteUrl,
        storageId,
        metadata: { storageId },
      };
    },

    async getUrl(storageId: string): Promise<string | null> {
      if (!options.getUrlQuery) {
        return null;
      }
      try {
        if (typeof convex.query === 'function') {
          return await convex.query(options.getUrlQuery, { storageId });
        }
        return null;
      } catch {
        return null;
      }
    },

    async getDownloadUrl(keyOrStorageId: string): Promise<string> {
      const storageId = storageIdMap.get(keyOrStorageId) || keyOrStorageId;
      const url = await this.getUrl(storageId);
      return url || storageId;
    },

    async delete(storageIdOrKey: string): Promise<void> {
      const storageId = storageIdMap.get(storageIdOrKey) || storageIdOrKey;
      storageIdMap.delete(storageIdOrKey);

      if (options.deleteMutation) {
        if (typeof convex.mutation === 'function') {
          await convex.mutation(options.deleteMutation, { storageId });
        }
      }
    },
  };
}
