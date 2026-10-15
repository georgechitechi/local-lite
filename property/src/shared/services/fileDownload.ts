import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Linking, Platform } from 'react-native';

export interface DownloadProgress {
  written: number;
  total: number;
  progress: number;
}

export interface DownloadOptions {
  mimeType?: string;
  directoryKey?: string;
  onProgress?: (progress: DownloadProgress) => void;
}

export interface DownloadResult {
  uri: string;
  localUri?: string;
  directoryUri?: string;
  displayPath?: string;
  folderName?: string;
  fileName: string;
}

const MIME_MAP: Record<string, string> = {
  apk: 'application/vnd.android.package-archive',
  json: 'application/json',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  csv: 'text/csv',
  txt: 'text/plain',
  zip: 'application/zip',
};

/**
 * Guesses MIME type from file extension.
 */
export function guessMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return MIME_MAP[ext] || 'application/octet-stream';
}

/**
 * Formats a clean human-friendly path for display.
 */
export function getFriendlyPath(
  uri: string,
  fileName: string,
  folderName?: string,
): string {
  if (folderName) return `${folderName}/${fileName}`;
  if (uri.startsWith('file://')) return uri.replace('file://', '');
  return fileName;
}

/**
 * Retrieves the user's saved folder name on Android.
 */
export async function getSavedDirectoryName(
  directoryKey: string = 'backupDirectoryUri',
): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  const uri = await SecureStore.getItemAsync(directoryKey);
  if (!uri) return null;
  try {
    const dir = new Directory(uri);
    return dir.name || null;
  } catch {
    return null;
  }
}

/**
 * Prompts user to pick a new destination directory on Android.
 */
export async function changeDirectory(
  directoryKey: string = 'backupDirectoryUri',
): Promise<Directory | null> {
  const dir = await Directory.pickDirectoryAsync();
  if (dir?.uri) {
    await SecureStore.setItemAsync(directoryKey, dir.uri);
    return dir;
  }
  return null;
}

/**
 * Attempts to open a directory in the device's file manager / Files app.
 */
export async function openDirectory(
  dirUri?: string | null,
  directoryKey: string = 'backupDirectoryUri',
): Promise<boolean> {
  const targetUri = dirUri || (await SecureStore.getItemAsync(directoryKey));

  if (Platform.OS === 'android') {
    if (targetUri) {
      // 1. If it's a SAF tree URI, try document URI conversion for DocumentsUI
      if (targetUri.includes('/tree/')) {
        try {
          const docUri = targetUri.replace('/tree/', '/document/');
          await Linking.openURL(docUri);
          return true;
        } catch {}
      }

      // 2. Try directory URI directly
      try {
        await Linking.openURL(targetUri);
        return true;
      } catch {}
    }

    // 3. Try opening Downloads screen via system intent
    try {
      await Linking.sendIntent('android.intent.action.VIEW_DOWNLOADS');
      return true;
    } catch {}

    // 4. Fallback to external storage root in DocumentsUI
    try {
      await Linking.openURL(
        'content://com.android.externalstorage.documents/root/primary',
      );
      return true;
    } catch {}
  }

  if (Platform.OS === 'ios') {
    try {
      await Linking.openURL('shareddocuments://');
      return true;
    } catch {}
  }

  return false;
}

/**
 * Resolves or prompts user for a destination Directory on Android.
 */
export async function getOrPickDirectory(
  directoryKey: string = 'backupDirectoryUri',
): Promise<Directory> {
  const directoryUri = await SecureStore.getItemAsync(directoryKey);

  if (directoryUri) {
    try {
      const dir = new Directory(directoryUri);
      if (dir.exists) return dir;
    } catch {}
  }

  const picked = await Directory.pickDirectoryAsync();
  if (!picked?.uri) {
    throw new Error('Unable to proceed without selecting a folder.');
  }

  await SecureStore.setItemAsync(directoryKey, picked.uri);
  return picked;
}

/**
 * Downloads a file directly to local cache (or browser downloads on web).
 */
export async function downloadFile(
  url: string,
  fileName: string,
  options?: DownloadOptions,
): Promise<DownloadResult> {
  if (Platform.OS === 'web') {
    if (
      typeof globalThis !== 'undefined' &&
      'fetch' in globalThis &&
      'document' in globalThis
    ) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = (globalThis as any).document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(objectUrl);
      options?.onProgress?.({ written: blob.size, total: blob.size, progress: 1 });
      return { uri: objectUrl, localUri: objectUrl, fileName };
    }
    throw new Error('Unable to download file in this web environment.');
  }

  const tempFile = new File(Paths.cache, fileName);
  const downloadedFile = await File.downloadFileAsync(url, tempFile, {
    idempotent: true,
    onProgress: progressData => {
      const total = progressData.totalBytes;
      const written = progressData.bytesWritten;
      const progress = total > 0 ? written / total : 0;
      options?.onProgress?.({ written, total, progress });
    },
  });

  if (!downloadedFile?.uri) {
    throw new Error('Download completed without file destination.');
  }

  options?.onProgress?.({
    written: downloadedFile.size || 0,
    total: downloadedFile.size || 0,
    progress: 1,
  });

  return {
    uri: downloadedFile.uri,
    localUri: downloadedFile.uri,
    fileName,
  };
}

/**
 * Downloads a file and saves it into the user's selected directory (SAF on Android, Documents on iOS).
 */
export async function downloadToDirectory(
  url: string,
  fileName: string,
  options?: DownloadOptions,
): Promise<DownloadResult> {
  const directoryKey = options?.directoryKey || 'backupDirectoryUri';
  const mimeType = options?.mimeType || guessMimeType(fileName);

  // 1. Download to cache first
  const localResult = await downloadFile(url, fileName, options);

  // 2. Android: Copy to user's selected SAF directory
  if (Platform.OS === 'android') {
    const dir = await getOrPickDirectory(directoryKey);
    const cachedFile = new File(localResult.uri);

    // Delete existing duplicate file with same name if present
    try {
      const existing = dir
        .list()
        .find(item => item instanceof File && item.name === fileName);
      if (existing) {
        (existing as File).delete();
      }
    } catch {}

    let destUri = dir.uri;
    try {
      await cachedFile.copy(dir, { overwrite: true });
    } catch {
      const targetFile = dir.createFile(fileName, mimeType);
      await cachedFile.copy(targetFile, { overwrite: true });
      destUri = targetFile.uri;
    }

    const folderName = dir.name || 'Selected Folder';
    const displayPath = getFriendlyPath(destUri, fileName, folderName);

    return {
      uri: destUri,
      localUri: localResult.uri,
      directoryUri: dir.uri,
      displayPath,
      folderName,
      fileName,
    };
  }

  // 3. iOS: Copy to Documents
  if (Platform.OS === 'ios') {
    const docFile = new File(Paths.document, fileName);
    const cachedFile = new File(localResult.uri);
    try {
      await cachedFile.copy(docFile, { overwrite: true });
    } catch {}
    return {
      uri: docFile.uri,
      localUri: localResult.uri,
      directoryUri: docFile.uri,
      displayPath: `Documents/${fileName}`,
      folderName: 'Documents',
      fileName,
    };
  }

  return {
    ...localResult,
    displayPath: fileName,
  };
}
