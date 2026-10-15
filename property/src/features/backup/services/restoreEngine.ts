import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { supabase } from '@/shared/services/supabase';
import { getAuthStateSnapshot } from '@/stores/authStore';
import { buildBackupPreview, isValidBackupFile, type PreviewData } from './backupUtils';

interface ProgressCallbacks {
  setProgress: (value: number) => void;
  setBackupStatus: (status: string) => void;
}

interface RestoreInvocationOptions extends ProgressCallbacks {
  baseProgress: number;
  progressScale: number;
}

function normalizeBroadcastPayload(payload: any) {
  return payload?.payload ?? payload ?? {};
}

function createProgressSubscription(userId: string, callbacks: RestoreInvocationOptions) {
  let broadcastResult: any = null;
  const channel = supabase.channel(`restoration_progress:${userId}`);

  const completionPromise = new Promise<{ data: any; error: any }>(resolve => {
    channel
      .on('broadcast', { event: 'progress' }, (payload: any) => {
        const payloadData = normalizeBroadcastPayload(payload);
        if (typeof payloadData.percentage === 'number') {
          callbacks.setProgress(
            Math.min(
              1.0,
              callbacks.baseProgress + payloadData.percentage * callbacks.progressScale,
            ),
          );
        }

        if (payloadData.status) {
          callbacks.setBackupStatus(payloadData.status);
        }

        const isFinished =
          payloadData.completed === true ||
          (typeof payloadData.percentage === 'number' &&
            payloadData.percentage >= 1.0 &&
            (payloadData.status?.toLowerCase().includes('complete') ||
              payloadData.status?.toLowerCase().includes('success')));

        if (isFinished && !broadcastResult) {
          broadcastResult = payloadData;
          resolve({ data: payloadData, error: null });
        }
      })
      .subscribe();
  });

  return {
    channel,
    completionPromise,
    unsubscribe: () => {
      try {
        supabase.removeChannel(channel);
      } catch (error) {
        console.warn('Unable to remove restore channel', error);
      }
    },
  };
}

async function invokeRestoreFunction(
  functionName: string,
  body: Record<string, any>,
  options: RestoreInvocationOptions,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    throw new Error('Unable to identify current user for restore operations');
  }

  const subscription = createProgressSubscription(user.id, options);

  try {
    const invokePromise = supabase.functions.invoke(functionName, {
      headers: getAuthStateSnapshot().session
        ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
        : undefined,
      body,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Restore operation timed out after 30 minutes')),
        30 * 60 * 1000,
      ),
    );

    const result = await Promise.race([
      subscription.completionPromise,
      invokePromise,
      timeoutPromise,
    ]);

    let restoreResult = result?.data;
    const restoreError = result?.error;

    if (restoreResult?.restore_results === 'too_many_to_broadcast') {
      try {
        const invokeRes: any = await Promise.race([
          invokePromise,
          new Promise(resolve => setTimeout(() => resolve(null), 3000)),
        ]);
        if (invokeRes && !invokeRes.error && invokeRes.data) {
          restoreResult = { ...restoreResult, ...invokeRes.data };
        }
      } catch {
        // Fall back to broadcast data without hanging
      }
    }

    if (restoreError) {
      throw new Error(restoreError.message || 'Failed to invoke restore function');
    }

    return restoreResult;
  } finally {
    subscription.unsubscribe();
  }
}

export async function loadBackupPreviewFromDocumentPicker(): Promise<PreviewData | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json'],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.length) {
    return null;
  }

  const selectedFile = result.assets[0];
  const file = new File(selectedFile.uri);
  const fileContent = await file.text();
  let backup;
  try {
    backup = JSON.parse(fileContent);
  } catch {
    throw new Error('Invalid backup file format');
  }

  if (!isValidBackupFile(backup)) {
    throw new Error('Invalid backup file structure');
  }

  return buildBackupPreview(backup, selectedFile.uri);
}

export async function restoreBackupFromFileUri(
  uri: string,
  options: RestoreInvocationOptions,
): Promise<any> {
  const file = new File(uri);
  const fileContent = await file.text();

  return invokeRestoreFunction(
    'backup-management',
    { action: 'restore', backup_content: fileContent },
    options,
  );
}

export async function restoreBackupFromUrl(
  backupUrl: string,
  options: RestoreInvocationOptions,
): Promise<any> {
  return invokeRestoreFunction(
    'backup-management',
    { action: 'restore', backup_url: backupUrl },
    options,
  );
}

export async function restoreFromReplica(
  options: RestoreInvocationOptions,
): Promise<any> {
  return invokeRestoreFunction('database-replication', { action: 'restore' }, options);
}

export async function replicateToReplica(
  options: RestoreInvocationOptions,
): Promise<any> {
  const wrappedOptions: RestoreInvocationOptions = {
    ...options,
    baseProgress: options.baseProgress ?? 0,
    progressScale: options.progressScale ?? 1,
    setBackupStatus: (status: string) => {
      let displayStatus = status;
      if (displayStatus.startsWith('Restoring ')) {
        displayStatus = `${displayStatus.replace(/^Restoring /, 'Syncing ')} to replica...`;
      } else if (displayStatus.startsWith('Exporting ')) {
        displayStatus = `${displayStatus.replace(/^Exporting /, 'Reading ')} from active database...`;
      } else if (displayStatus.includes('Clearing existing data')) {
        displayStatus = 'Preparing replica database...';
      }
      options.setBackupStatus?.(displayStatus);
    },
  };

  return invokeRestoreFunction(
    'database-replication',
    { action: 'replicate', full_replication: true },
    wrappedOptions,
  );
}
