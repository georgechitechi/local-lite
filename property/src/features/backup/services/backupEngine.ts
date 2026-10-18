import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { getSyncClient } from '@/shared/services/sync/client';
import { BUSINESS_COLLECTIONS } from '@/shared/services/sync/tables';
import type { BackupOptions } from './backupUtils';

interface FetchAllDataParams {
  store?: any;
  setProgress: (value: number) => void;
  setBackupStatus: (status: string) => void;
}

export async function fetchAllData({
  setProgress,
  setBackupStatus,
}: FetchAllDataParams): Promise<Record<string, any[]>> {
  const client = await getSyncClient().catch(() => null);
  const tableNames = BUSINESS_COLLECTIONS;
  const data: Record<string, any[]> = {};
  const excludedTables = ['schema_migrations', 'resumes'];
  const tablesToBackup = tableNames.filter(
    (table: string) => !excludedTables.includes(table),
  );

  const backupResults = {
    total: tablesToBackup.length,
    successful: 0,
    failed: 0,
    skipped: 0,
    failedTables: [] as {
      table: string;
      error: string;
      details?: string;
      hint?: string;
      code?: string;
      type?: string;
      stack?: string;
    }[],
    successfulTables: [] as { table: string; records: number }[],
    skippedTables: [] as string[],
  };

  for (let i = 0; i < tablesToBackup.length; i++) {
    const tableName = tablesToBackup[i];

    try {
      let tableData: any[] = [];

      if (client) {
        try {
          tableData = (await client.findMany(tableName)) || [];
        } catch {
          tableData = [];
        }
      }

      const recordCount = tableData.length;
      backupResults.successful++;
      backupResults.successfulTables.push({
        table: tableName,
        records: recordCount,
      });

      data[tableName] = tableData;
      setProgress((i + 1) / tablesToBackup.length);
      setBackupStatus(`Fetching ${tableName} (${data[tableName].length} records)...`);
    } catch (error: any) {
      console.error(`💥 Exception fetching data from table ${tableName}:`, error);

      backupResults.failed++;
      backupResults.failedTables.push({
        table: tableName,
        error: error.message,
        type: 'exception',
        stack: error.stack,
      });

      data[tableName] = [];
    }
  }

  (data as any)._backupResults = backupResults;
  return data;
}

interface SaveOrShareBackupParams {
  fileName: string;
  content: string;
  backupOptions: BackupOptions;
  showSnackbar: (message: string, type: 'success' | 'error') => void;
}

export async function clearSavedBackupDirectory(): Promise<void> {
  await SecureStore.deleteItemAsync('backupDirectoryUri');
}

export async function saveOrShareBackup({
  fileName,
  content,
  backupOptions,
  showSnackbar,
}: SaveOrShareBackupParams): Promise<void> {
  if (Platform.OS === 'web') {
    if (
      typeof globalThis !== 'undefined' &&
      'Blob' in globalThis &&
      'URL' in globalThis &&
      'document' in globalThis
    ) {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = (globalThis as any).document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    }

    showSnackbar('Backup file is being downloaded.', 'success');
    return;
  }

  if (backupOptions.action === 'save') {
    if (Platform.OS === 'android') {
      const directoryUri = await SecureStore.getItemAsync('backupDirectoryUri');
      let dir: Directory | null = null;
      let needToRequest = false;

      if (!directoryUri) {
        needToRequest = true;
      } else {
        try {
          dir = new Directory(directoryUri);
          if (!dir.exists) {
            needToRequest = true;
          } else {
            const file = dir.createFile(fileName, 'application/json');
            await file.write(content);
            showSnackbar('Backup saved successfully!', 'success');
            return;
          }
        } catch (err) {
          console.error('Failed to write to existing directory uri:', err);
          needToRequest = true;
        }
      }

      if (needToRequest) {
        try {
          dir = await Directory.pickDirectoryAsync();
          if (dir?.uri) {
            await SecureStore.setItemAsync('backupDirectoryUri', dir.uri);
            const file = dir.createFile(fileName, 'application/json');
            await file.write(content);
            showSnackbar('Backup saved successfully!', 'success');
            return;
          } else {
            showSnackbar('Unable to save backup without picking a directory.', 'error');
            return;
          }
        } catch (err) {
          console.error('Failed to pick directory or save backup:', err);
          showSnackbar('Unable to save backup without storage permission.', 'error');
          return;
        }
      }
    } else {
      const file = new File(Paths.document, fileName);
      await file.write(content);
      showSnackbar('Backup saved successfully!', 'success');
      return;
    }
  }

  const file = new File(Paths.cache, fileName);
  await file.write(content);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Share Backup File',
    UTI: 'public.json',
  });
}
