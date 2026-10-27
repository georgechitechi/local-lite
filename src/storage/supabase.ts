import type { SupabaseClient } from '@supabase/supabase-js';
import { BlobRecord, RemoteStorageUploader, RemoteStorageUploadResult } from './types.js';

export interface SupabaseStorageUploaderOptions {
  /**
   * Supabase Storage bucket name (e.g. 'avatars', 'property-photos', 'documents').
   */
  bucket: string;

  /**
   * Whether to overwrite existing files on Supabase with the same path/key.
   * Default: true
   */
  upsert?: boolean;

  /**
   * Custom path transformation function from local blob key to Supabase Storage path.
   * By default, returns `key.replace(/^\/+/, '')`.
   */
  pathTransform?: (key: string, blob?: BlobRecord) => string;

  /**
   * URL format to store in metadata:
   * - 'public': Uses `supabase.storage.from(bucket).getPublicUrl(path)`
   * - 'signed': Uses `supabase.storage.from(bucket).createSignedUrl(path, expiresIn)`
   * Default: 'public'
   */
  urlType?: 'public' | 'signed';

  /**
   * Expiration duration in seconds when generating signed URLs.
   * Default: 86400 (24 hours)
   */
  signedUrlExpiresIn?: number;

  /**
   * Cache control HTTP header for uploaded assets (e.g. '3600').
   */
  cacheControl?: string;
}

export interface SupabaseStorageUploaderInstance extends RemoteStorageUploader {
  getPublicUrl(keyOrPath: string): string;
  createSignedUrl(keyOrPath: string, expiresIn?: number): Promise<string>;
  getDownloadUrl(keyOrPath: string): Promise<string> | string;
  delete(keyOrPath: string): Promise<void>;
}

/**
 * Creates a RemoteStorageUploader that syncs binary files to Supabase Storage buckets.
 */
export function createSupabaseStorageUploader(
  supabase: SupabaseClient | any,
  options: SupabaseStorageUploaderOptions
): SupabaseStorageUploaderInstance {
  const bucketName = options.bucket;

  const getBucket = () => {
    if (typeof supabase.storage?.from === 'function') {
      return supabase.storage.from(bucketName);
    }
    if (typeof supabase.from === 'function') {
      return supabase.from(bucketName);
    }
    throw new Error('Supabase client does not have storage.from() available.');
  };

  const resolveRemotePath = (key: string, blob?: BlobRecord): string => {
    if (options.pathTransform) {
      return options.pathTransform(key, blob);
    }
    return key.replace(/^\/+/, '');
  };

  return {
    async upload(blob: BlobRecord, data: Uint8Array): Promise<RemoteStorageUploadResult> {
      const bucket = getBucket();
      const remotePath = resolveRemotePath(blob.key, blob);

      const uploadOptions: Record<string, any> = {
        contentType: blob.mimeType || 'application/octet-stream',
        upsert: options.upsert !== false,
      };
      if (options.cacheControl) {
        uploadOptions.cacheControl = options.cacheControl;
      }

      // Supabase Storage accepts Uint8Array, Buffer, or ArrayBuffer
      const { error } = await bucket.upload(remotePath, data, uploadOptions);
      if (error) {
        throw new Error(
          `Supabase Storage upload failed for "${remotePath}": ${error.message || JSON.stringify(error)}`
        );
      }

      if (options.urlType === 'signed') {
        const expiresIn = options.signedUrlExpiresIn ?? 86400;
        const { data: signedData, error: signedErr } = await bucket.createSignedUrl(
          remotePath,
          expiresIn
        );
        if (signedErr || !signedData?.signedUrl) {
          throw new Error(
            `Failed to create signed URL for "${remotePath}": ${signedErr?.message || 'unknown error'}`
          );
        }
        return { remoteUrl: signedData.signedUrl };
      }

      const { data: publicData } = bucket.getPublicUrl(remotePath);
      return { remoteUrl: publicData.publicUrl };
    },

    getPublicUrl(keyOrPath: string): string {
      const bucket = getBucket();
      const remotePath = resolveRemotePath(keyOrPath);
      const { data } = bucket.getPublicUrl(remotePath);
      return data.publicUrl;
    },

    async createSignedUrl(keyOrPath: string, expiresIn: number = 86400): Promise<string> {
      const bucket = getBucket();
      const remotePath = resolveRemotePath(keyOrPath);
      const { data, error } = await bucket.createSignedUrl(remotePath, expiresIn);
      if (error || !data?.signedUrl) {
        throw new Error(
          `Failed to create signed URL for "${remotePath}": ${error?.message || 'unknown error'}`
        );
      }
      return data.signedUrl;
    },

    getDownloadUrl(keyOrPath: string): Promise<string> | string {
      if (options.urlType === 'signed') {
        return this.createSignedUrl(keyOrPath, options.signedUrlExpiresIn);
      }
      return this.getPublicUrl(keyOrPath);
    },

    async delete(keyOrPath: string): Promise<void> {
      const bucket = getBucket();
      const remotePath = resolveRemotePath(keyOrPath);
      if (typeof bucket.remove === 'function') {
        const { error } = await bucket.remove([remotePath]);
        if (error) {
          throw new Error(`Failed to delete "${remotePath}" from Supabase Storage: ${error.message}`);
        }
      }
    },
  };
}
