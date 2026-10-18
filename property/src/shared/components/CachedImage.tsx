import { fetch } from 'expo/fetch';
import { Directory, File, Paths } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import type React from 'react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  Image,
  type ImageProps,
  type ImageSourcePropType,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import { useNetworkStatus } from '@/shared/hooks/useNetworkStatus';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { secureStorage } from '@/shared/services/secureStorage';
import { supabase } from '@/shared/services/supabase';
import type * as T from '@/shared/types/types';
import { generateUUID } from '@/shared/utils/helper';

type PendingUpload = T.PendingUpload;

// ==========================================
// 1. UPLOAD QUEUE & STATE MANAGEMENT
// ==========================================

let pendingUploads: Record<string, PendingUpload> = {};
let pendingUploadsByUrl: Record<string, PendingUpload> = {};
const uploadListeners = new Set<() => void>();

const rebuildUrlIndex = () => {
  const index: Record<string, PendingUpload> = {};
  for (const upload of Object.values(pendingUploads)) {
    if (upload?.publicUrl) {
      index[upload.publicUrl] = upload;
    }
  }
  pendingUploadsByUrl = index;
};

// Initialize from SQLite KV Store
Storage.getItem('pendingUploads').then(data => {
  if (data) {
    try {
      pendingUploads = JSON.parse(data);
      rebuildUrlIndex();
      uploadListeners.forEach(cb => {
        cb();
      });
    } catch {
      // ignore
    }
  }
});

const savePendingUploads = () => {
  rebuildUrlIndex();
  Storage.setItem('pendingUploads', JSON.stringify(pendingUploads)).catch(() => {});
  uploadListeners.forEach(cb => {
    cb();
  });
};

export const subscribeUploads = (cb: () => void) => {
  uploadListeners.add(cb);
  return () => {
    uploadListeners.delete(cb);
  };
};

export const getPendingUploadsByUrl = (): Record<string, PendingUpload> =>
  pendingUploadsByUrl;

let isProcessing = false;
let imagesDirCache: any = null;
const cachePromises = new Map<string, Promise<string | null>>();

const getImagesDir = async (): Promise<Directory> => {
  if (!imagesDirCache) {
    imagesDirCache = new Directory(Paths.cache, 'images');
    if (!imagesDirCache.exists) {
      try {
        imagesDirCache.create();
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch {
        // Ignore if created concurrently
      }
    }
  }
  return imagesDirCache;
};

export const queueImageUpload = async (
  imageAsset: { uri: string; mimeType?: string },
  bucket: string,
  folder: string,
  entityId: string,
): Promise<{ localUri: string; uploadId: string; publicUrl: string }> => {
  const uploadId = generateUUID();
  const fileExt = imageAsset.uri.split('.').pop() || 'jpg';
  const fileName = `${entityId}/${Date.now()}.${fileExt}`;
  const remotePath = folder ? `${folder}/${fileName}` : fileName;

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(remotePath);

  try {
    const dir = await getImagesDir();
    const safeLocalName = `upload_${uploadId}.${fileExt}`;
    const localFile = dir.createFile(safeLocalName, imageAsset.mimeType || 'image/jpeg');

    const tempFile = new File(imageAsset.uri);
    await localFile.write(await tempFile.bytes());

    pendingUploads[uploadId] = {
      id: uploadId,
      localUri: localFile.uri,
      remotePath,
      bucket,
      folder,
      entityId,
      status: 'pending',
      publicUrl,
      mimeType: imageAsset.mimeType || 'image/jpeg',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    };
    savePendingUploads();

    processUploadQueue().catch(error => {
      console.error('Error processing upload queue:', error);
    });

    return { localUri: localFile.uri, uploadId, publicUrl };
  } catch (error) {
    console.error('Error safely caching image for upload:', error);
    pendingUploads[uploadId] = {
      id: uploadId,
      localUri: imageAsset.uri,
      remotePath,
      bucket,
      folder,
      entityId,
      status: 'pending',
      publicUrl,
      mimeType: imageAsset.mimeType || 'image/jpeg',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    };
    savePendingUploads();

    processUploadQueue().catch(() => {});
    return { localUri: imageAsset.uri, uploadId, publicUrl };
  }
};

const processUploadQueue = async (): Promise<void> => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const pending = Object.values(pendingUploads).filter(
      upload =>
        upload.status === 'pending' ||
        (upload.status === 'failed' && upload.retryCount < 3),
    );

    if (pending.length === 0) return;

    for (const upload of pending) {
      try {
        if (pendingUploads[upload.id]) {
          pendingUploads[upload.id].status = 'uploading';
          savePendingUploads();
        }

        const fileObj = new File(upload.localUri);
        if (!fileObj.exists) {
          throw new Error('Local file no longer exists');
        }

        const url = (await secureStorage.getItem('supabase_custom_url')) as string | null;
        const key = (await secureStorage.getItem('supabase_custom_key')) as string | null;

        if (!url || !key) {
          throw new Error('Supabase URL or Key is missing from secure storage');
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();
        const uploadUrl = `${url.trim()}/storage/v1/object/${upload.bucket}/${upload.remotePath}`;

        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session?.access_token || key.trim()}`,
            apikey: key.trim(),
            'Content-Type': upload.mimeType || 'image/jpeg',
            'Cache-Control': '3600',
          },
          body: fileObj as any,
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Upload failed: ${response.status} ${errText}`);
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from(upload.bucket).getPublicUrl(upload.remotePath);

        if (pendingUploads[upload.id]) {
          pendingUploads[upload.id].status = 'uploaded';
          pendingUploads[upload.id].publicUrl = publicUrl;
          savePendingUploads();
        }

        try {
          await fileObj.delete();
        } catch (deleteError) {
          console.warn(
            'Could not delete local file after successful upload:',
            deleteError,
          );
        }
      } catch (error) {
        const willRetry = upload.retryCount + 1 < 3;
        const errMsg = (error as Error).message || String(error);
        if (willRetry) {
          console.warn(
            `⚠️ Upload attempt ${upload.retryCount + 1} failed for ${upload.id}, will retry automatically. Error: ${errMsg}`,
          );
        } else {
          console.error(
            `❌ Upload failed permanently after ${upload.retryCount + 1} attempts: ${upload.id}. Error: ${errMsg}`,
          );
        }

        if (pendingUploads[upload.id]) {
          pendingUploads[upload.id].status = 'failed';
          pendingUploads[upload.id].retryCount = upload.retryCount + 1;
          pendingUploads[upload.id].error = (error as Error).message;
          savePendingUploads();
        }

        if (upload.retryCount + 1 >= 3) {
          delete pendingUploads[upload.id];
          savePendingUploads();
          try {
            const fileObj = new File(upload.localUri);
            if (fileObj.exists) {
              await fileObj.delete();
            }
          } catch (deleteError) {
            console.warn('Could not delete local file for failed upload:', deleteError);
          }
        }
      }
    }
  } finally {
    isProcessing = false;
  }
};

// ==========================================
// 2. IMAGE DOWNLOAD & CACHING
// ==========================================

const cacheImage = async (remoteUrl: string): Promise<string | null> => {
  if (!remoteUrl) return null;

  const urlParts = remoteUrl.trim().split('://');
  if (urlParts.length === 2) {
    let path = urlParts[1];
    while (path.includes('//')) {
      path = path.replace('//', '/');
    }
    remoteUrl = `${urlParts[0]}://${path}`;
  }

  const existingPromise = cachePromises.get(remoteUrl);
  if (existingPromise) {
    return existingPromise;
  }

  const cachePromise = (async (): Promise<string | null> => {
    try {
      const fileName = remoteUrl.split('/').pop();
      if (!fileName) return null;

      const dir = await getImagesDir();
      const localFile = new File(dir, fileName);

      if (localFile.exists && (localFile.info().size as number) > 0) {
        return localFile.uri;
      }

      if (Platform.OS === 'web') {
        return remoteUrl;
      }

      await File.downloadFileAsync(remoteUrl, localFile, { idempotent: true });
      return localFile.uri;
    } catch (error) {
      console.warn(`Failed to cache image ${remoteUrl}:`, error);
      return null;
    } finally {
      cachePromises.delete(remoteUrl);
    }
  })();

  cachePromises.set(remoteUrl, cachePromise);
  return cachePromise;
};

export const preCacheGallery = async (images: any[]): Promise<void> => {
  if (!images || images.length === 0) return;

  const promises = images
    .filter(img => img?.url)
    .map(img =>
      cacheImage(img.url).catch(e =>
        console.log(`Failed to cache gallery image ${img.url}:`, e.message),
      ),
    );

  await Promise.allSettled(promises);
};

// ==========================================
// 3. REACT HOOKS & COMPONENTS
// ==========================================

export const useOfflineImageSync = (remoteUrl?: string) => {
  const isOnline = useNetworkStatus();
  const urlIndex = useSyncExternalStore(subscribeUploads, getPendingUploadsByUrl);

  useEffect(() => {
    if (isOnline) {
      processUploadQueue().catch(error => {
        console.error('Error processing upload queue:', error);
      });
    }
  }, [isOnline]);

  const localUri = useMemo(() => {
    if (!remoteUrl) return null;

    const pending = urlIndex[remoteUrl];
    if (pending?.localUri) return pending.localUri;

    try {
      const fileName = remoteUrl.split('/').pop();
      if (fileName) {
        const file = new File(Paths.cache, `images/${fileName}`);
        if (file.exists && (file.info().size as number) > 0) {
          return file.uri;
        }
      }
    } catch {
      // Ignore
    }

    return remoteUrl;
  }, [remoteUrl, urlIndex]);

  useEffect(() => {
    if (isOnline && localUri === remoteUrl && remoteUrl?.startsWith('http')) {
      cacheImage(remoteUrl).catch(e =>
        console.log(`Background cache skipped for ${remoteUrl}:`, e.message),
      );
    }
  }, [remoteUrl, isOnline, localUri]);

  return { localUri };
};

interface CachedImageProps extends Omit<ImageProps, 'source'> {
  uri: string | null | undefined;
  fallback?: ImageSourcePropType;
  showLoader?: boolean;
}

const CachedImage: React.FC<CachedImageProps> = ({
  uri,
  fallback,
  showLoader = false,
  style,
  ...props
}) => {
  const colors = useThemeColors();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const { localUri } = useOfflineImageSync(uri || undefined);

  const handleImageError = (e: any) => {
    console.warn('Image failed to load:', uri);
    setError(true);
    setLoading(false);
    if (props.onError) {
      props.onError(e);
    }
  };

  const handleLoadEnd = () => {
    setLoading(false);
    if (props.onLoadEnd) {
      props.onLoadEnd();
    }
  };

  const currentSource = error || !localUri ? fallback : { uri: localUri };

  return (
    <View style={[styles.container, style]}>
      {currentSource && (
        <Image
          {...props}
          source={currentSource}
          style={[StyleSheet.absoluteFill, style]}
          onError={handleImageError}
          onLoadEnd={handleLoadEnd}
        />
      )}

      {loading && showLoader && !error && (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.loaderContainer,
            { backgroundColor: colors.surfaceVariant },
          ]}
        >
          <ActivityIndicator size="small" />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  loaderContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
});

export default CachedImage;
