import type { StorageFile, StorageFolder } from '@/features/backup/services/backupUtils';
import { downloadToDirectory } from '@/shared/services/fileDownload';
import { supabase } from '@/shared/services/supabase';

interface ListStorageFilesResult {
  folders: StorageFolder[];
  files: StorageFile[];
}

export async function listStorageFiles(
  path: string = 'backups',
): Promise<ListStorageFilesResult> {
  const { data: files, error } = await supabase.storage
    .from('private-assets')
    .list(path, {
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' },
    });

  if (error) {
    console.error('Storage List Error:', error);
    throw error;
  }

  const folders = (files || []).filter(
    (item: any) => !item.id,
  ) as unknown as StorageFolder[];
  const backupFiles = (files || []).filter(
    (item: any) => item.id && item.name.endsWith('.json'),
  ) as StorageFile[];

  return {
    folders,
    files: backupFiles,
  };
}

export async function getStoragePublicUrl(filePath: string): Promise<string> {
  // Try to create a signed URL since private-assets is not public
  const { data, error } = await supabase.storage
    .from('private-assets')
    .createSignedUrl(filePath, 60 * 60 * 24); // 24 hours

  if (error || !data?.signedUrl) {
    throw new Error('Could not generate signed URL for backup file');
  }

  return data.signedUrl;
}

export async function downloadStorageFile(
  filePath: string,
  fileName: string,
): Promise<void> {
  const publicUrl = await getStoragePublicUrl(filePath);
  await downloadToDirectory(publicUrl, fileName, {
    mimeType: 'application/json',
  });
}
