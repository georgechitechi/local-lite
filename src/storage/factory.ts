import { RemoteStorageUploader, StorageProviderType } from './types.js';
import { createSupabaseStorageUploader, SupabaseStorageUploaderOptions } from './supabase.js';
import { createConvexStorageUploader, ConvexStorageUploaderOptions } from './convex.js';
import { createFirebaseStorageUploader, FirebaseStorageUploaderOptions } from './firebase.js';

export type UnifiedStorageOptions =
  | ({ provider: 'supabase' } & SupabaseStorageUploaderOptions)
  | ({ provider: 'convex' } & ConvexStorageUploaderOptions)
  | ({ provider: 'firebase' } & FirebaseStorageUploaderOptions);

/**
 * Universal factory function to create a remote storage uploader for any supported provider:
 * 'supabase', 'convex', or 'firebase'.
 */
export function createStorageUploader(
  provider: StorageProviderType,
  client: any,
  options: any = {}
): RemoteStorageUploader {
  switch (provider) {
    case 'supabase':
      return createSupabaseStorageUploader(client, options as SupabaseStorageUploaderOptions);
    case 'convex':
      return createConvexStorageUploader(client, options as ConvexStorageUploaderOptions);
    case 'firebase':
      return createFirebaseStorageUploader(client, options as FirebaseStorageUploaderOptions);
    default:
      throw new Error(`Unsupported storage provider "${provider}". Supported providers: "supabase", "convex", "firebase".`);
  }
}
