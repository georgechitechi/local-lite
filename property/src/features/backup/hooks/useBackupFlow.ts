import { Directory } from 'expo-file-system';
import { useFocusEffect, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import {
  clearSavedBackupDirectory,
  fetchAllData,
  saveOrShareBackup,
} from '@/features/backup/services/backupEngine';
import {
  type BackupOptions,
  createBackupFileContent,
  type PreviewData,
  type RestoreModalData,
  type StorageFile,
  type StorageFolder,
  type SuccessModalData,
} from '@/features/backup/services/backupUtils';
import {
  loadBackupPreviewFromDocumentPicker,
  replicateToReplica,
  restoreBackupFromFileUri,
  restoreBackupFromUrl,
  restoreFromReplica,
} from '@/features/backup/services/restoreEngine';
import { BACKUP_PROJECT_STORAGE_KEY } from '@/features/settings/components/cloudsync/types';
import { useIdleLock } from '@/providers/LockScreenProvider';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useBackupSchedules } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { secureStorage } from '@/shared/services/secureStorage';
import {
  getStoragePublicUrl,
  listStorageFiles as listStorageFilesService,
} from '@/shared/services/storageService';
import { supabase } from '@/shared/services/supabase';
import { EMPTY_ARRAY } from '@/shared/utils/helper';

export function useBackupFlow() {
  const colors = useThemeColors();
  const router = useRouter();
  const { selectedBusiness, requireBusiness, clearSelectedBusiness } = useBusiness();
  const { isSyncActive: isCloudSyncEnabled, requireCloudSync } = useLocalSync();
  const { isOnline, checkOnline } = useOfflineCheck();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [backupStatus, setBackupStatus] = useState<string>('');
  const [showBackupDialog, setShowBackupDialog] = useState<boolean>(false);
  const [backupOptions, setBackupOptions] = useState<BackupOptions>({
    action: 'share',
    format: 'json',
  });

  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState<boolean>(false);
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});

  const [storageFiles, setStorageFiles] = useState<StorageFile[]>([]);
  const [loadingStorage, setLoadingStorage] = useState<boolean>(false);
  const [storageFolders, setStorageFolders] = useState<StorageFolder[]>([]);
  const [currentStoragePath, setCurrentStoragePath] = useState<string>('backups');
  const [downloadingFileName, setDownloadingFileName] = useState<string | null>(null);

  const [hasStaleBackups, setHasStaleBackups] = useState<boolean>(false);
  const [checkingStaleBackups, setCheckingStaleBackups] = useState<boolean>(false);

  const [showRestoreModal, setShowRestoreModal] = useState<boolean>(false);
  const [restoreModalData, setRestoreModalData] = useState<RestoreModalData | null>(null);

  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);
  const [successModalData, setSuccessModalData] = useState<SuccessModalData | null>(null);

  const [showRestoreProgressModal, setShowRestoreProgressModal] =
    useState<boolean>(false);
  const [progressOperationType, setProgressOperationType] = useState<
    'restore' | 'replicate'
  >('restore');
  const [showReplicateDialog, setShowReplicateDialog] = useState<boolean>(false);
  const [backupProjectRef, setBackupProjectRef] = useState<string | null>(null);

  const allBackupSchedules = useBackupSchedules(selectedBusiness?.id);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      secureStorage.getItem(BACKUP_PROJECT_STORAGE_KEY).then(stored => {
        if (!active) return;
        if (typeof stored === 'string' && stored.trim()) {
          setBackupProjectRef(stored.trim());
        } else {
          setBackupProjectRef(null);
        }
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const executeBackup = async (): Promise<void> => {
    try {
      setLoading(true);
      pauseAutoLock();
      setProgress(0);
      setBackupStatus('Starting backup...');
      setShowBackupDialog(false);

      if (isCloudSyncEnabled && !checkOnline('Backup')) {
        setBackupStatus('Offline mode: using local data for backup...');
      }

      setBackupStatus('Preparing to backup all tables...');
      setProgress(0.1);

      const data = await fetchAllData({
        store: null,
        setProgress,
        setBackupStatus,
      });

      const { fileName, content } = createBackupFileContent(data);
      await saveOrShareBackup({
        fileName,
        content,
        backupOptions,
        showSnackbar,
      });
    } catch (error: any) {
      console.error('Backup error:', error);
      showSnackbar(`Failed to create backup: ${error.message}`, 'error');
    } finally {
      setLoading(false);
      setProgress(0);
      setBackupStatus('');
      resumeAutoLock();
    }
  };

  const handleBackup = (): void => {
    setShowBackupDialog(true);
  };

  const handleChangeFolder = async (): Promise<void> => {
    try {
      if (Platform.OS !== 'android') {
        showSnackbar('Folder selection is only required on Android.', 'info');
        return;
      }
      await clearSavedBackupDirectory();
      const dir = await Directory.pickDirectoryAsync();
      if (dir?.uri) {
        await SecureStore.setItemAsync('backupDirectoryUri', dir.uri);
        showSnackbar('Backup folder updated successfully!', 'success');
      } else {
        showSnackbar('Folder selection cancelled.', 'info');
      }
    } catch (error: any) {
      console.error('Error changing backup folder:', error);
      showSnackbar(
        `Failed to change backup folder: ${error?.message || 'Unknown error'}`,
        'error',
      );
    }
  };

  const listStorageFiles = useCallback(
    async (path: string = 'backups'): Promise<void> => {
      if (!checkOnline('List Storage Files') || !requireCloudSync('List Storage Files'))
        return;

      try {
        setLoadingStorage(true);
        setCurrentStoragePath(path);

        const { folders, files } = await listStorageFilesService(path);
        setStorageFolders(folders);
        setStorageFiles(files);
      } catch (error: any) {
        console.error('Error listing storage files:', error);
        showSnackbar(`Failed to list storage files: ${error.message}`, 'error');
      } finally {
        setLoadingStorage(false);
      }
    },
    [checkOnline, requireCloudSync, showSnackbar],
  );

  const handleRestore = async (): Promise<void> => {
    if (!checkOnline('Restore Backup') || !requireCloudSync('Restore Backup')) return;

    try {
      setLoading(true);
      pauseAutoLock();
      setBackupStatus('Starting restore...');

      const preview = await loadBackupPreviewFromDocumentPicker();
      if (!preview) {
        setLoading(false);
        setBackupStatus('');
        resumeAutoLock();
        return;
      }
      setPreviewData(preview);
      setShowPreviewDialog(true);
      setLoading(false);
    } catch (error: any) {
      console.error('Restore error:', error);
      setSuccessModalData({
        title: 'Load Failed',
        type: 'error',
        message: 'Failed to load backup file',
        details: [error.message],
      });
      setShowSuccessModal(true);
      setLoading(false);
      resumeAutoLock();
    }
  };

  const showRestoreResults = (
    fileName: string,
    restoreResult: any,
    typeLabel: string,
  ) => {
    const rawResults =
      restoreResult?.details?.restore_results || restoreResult?.restore_results;
    const restoreResults = Array.isArray(rawResults) ? rawResults : [];
    const successCount = restoreResults.filter((r: any) => r.success).length;
    const failedCountFromResults = restoreResults.filter(
      (r: any) => !r.success && !r.skipped,
    ).length;
    const failedCount = restoreResult?.failed_tables ?? failedCountFromResults;
    const totalCount =
      restoreResults.length > 0 ? restoreResults.length : successCount + failedCount || 1;
    const totalRecords = restoreResult?.total_records_restored ?? 0;
    const businessesRestored =
      restoreResult?.businesses_restored ?? restoreResult?.businessesRestored ?? 1;
    const businessNames = Array.isArray(restoreResult?.business_names)
      ? restoreResult.business_names.join(', ')
      : Array.isArray(restoreResult?.businessNames)
        ? restoreResult.businessNames.join(', ')
        : restoreResult?.business_name || 'All Businesses';

    if (failedCount === 0) {
      setSuccessModalData({
        title: `Success - ${typeLabel}`,
        type: 'success',
        message: 'Successfully restored all data.',
        details: [
          `File: ${fileName}`,
          `Businesses restored: ${businessesRestored}`,
          `Business names: ${businessNames}`,
          `Total records: ${totalRecords}`,
          `Tables restored: ${successCount}/${totalCount}`,
          `Duration: ${restoreResult?.duration || 'N/A'} seconds`,
        ],
        warning:
          '⚠️ This is now a completely fresh installation. Please select a business to continue.',
      });
    } else {
      const failedTables = restoreResults
        .filter((r: any) => !r.success)
        .map((r: any) => `${r.table} (${r.error})`)
        .join('\n• ');

      setSuccessModalData({
        title: `Partial Success - ${typeLabel}`,
        type: 'warning',
        message: `Restoration completed with ${failedCount} issues.`,
        details: [
          `File: ${fileName}`,
          `Businesses restored: ${businessesRestored}`,
          `Business names: ${businessNames}`,
          `Total records: ${totalRecords}`,
          `Tables restored: ${successCount}/${totalCount}`,
          `Failed tables: ${failedCount}`,
          `Duration: ${restoreResult?.duration || 'N/A'} seconds`,
        ],
        failedTables,
        warning:
          '⚠️ This is now a completely fresh installation. You may need to reconfigure some settings.',
      });
    }

    setShowSuccessModal(true);
  };

  const confirmRestore = async (): Promise<void> => {
    if (!checkOnline('Restore Backup') || !requireCloudSync('Restore Backup')) return;
    if (!previewData) return;

    try {
      setLoading(true);
      pauseAutoLock();
      setShowPreviewDialog(false);

      const fileUri = previewData.uri;

      setRestoreModalData({
        type: 'file',
        fileName: fileUri,
        fileContent: undefined,
        onCancel: () => {
          setShowRestoreModal(false);
          setRestoreModalData(null);
          setLoading(false);
          setProgress(0);
          setBackupStatus('');
          resumeAutoLock();
        },
        onConfirm: async () => {
          try {
            setShowRestoreModal(false);
            setProgressOperationType('restore');
            setShowRestoreProgressModal(true);
            setBackupStatus('Starting restore process...');
            setProgress(0.05);
            await new Promise(resolve => setTimeout(resolve, 500));

            const restoreResult = await restoreBackupFromFileUri(fileUri, {
              setProgress,
              setBackupStatus,
              baseProgress: 0.35,
              progressScale: 0.65,
            });

            setProgress(1.0);
            setBackupStatus('Restore completed successfully!');
            await new Promise(resolve => setTimeout(resolve, 500));
            showRestoreResults(
              fileUri.split('/').pop() || 'backup.json',
              restoreResult,
              'Fresh Installation',
            );
          } catch (error: any) {
            console.error('Restore error:', error);
            setSuccessModalData({
              title: 'Restore Failed',
              type: 'error',
              message: 'Failed to restore backup',
              details: [error.message],
            });
            setShowSuccessModal(true);
          } finally {
            try {
              await clearSelectedBusiness();
            } catch (clearError) {
              console.warn('⚠️ Failed to clear selected business:', clearError);
            }
            setLoading(false);
            setProgress(0);
            setBackupStatus('');
            setPreviewData(null);
            setShowRestoreModal(false);
            setShowRestoreProgressModal(false);
            setRestoreModalData(null);
            resumeAutoLock();
          }
        },
      });

      setShowRestoreModal(true);
    } catch (error: any) {
      console.error('Restore error:', error);
      setSuccessModalData({
        title: 'Restore Failed',
        type: 'error',
        message: 'Failed to initiate restore',
        details: [error.message],
      });
      setShowSuccessModal(true);
      setLoading(false);
      setProgress(0);
      setBackupStatus('');
      setPreviewData(null);
      resumeAutoLock();
    }
  };

  const restoreFromStorageFile = async (
    filePath: string,
    fileName: string,
  ): Promise<void> => {
    if (!checkOnline('Restore Backup') || !requireCloudSync('Restore Backup')) return;

    try {
      setLoading(true);
      pauseAutoLock();
      setBackupStatus('Preparing storage restore...');

      const publicUrl = await getStoragePublicUrl(filePath);

      setRestoreModalData({
        type: 'storage',
        fileName,
        urlData: { publicUrl },
        onCancel: () => {
          setShowRestoreModal(false);
          setRestoreModalData(null);
          setLoading(false);
          setProgress(0);
          setBackupStatus('');
          resumeAutoLock();
        },
        onConfirm: async () => {
          try {
            setShowRestoreModal(false);
            setProgressOperationType('restore');
            setShowRestoreProgressModal(true);
            setBackupStatus('Starting fresh installation restore...');
            setProgress(0.05);
            await new Promise(resolve => setTimeout(resolve, 500));

            const restoreResult = await restoreBackupFromUrl(publicUrl, {
              setProgress,
              setBackupStatus,
              baseProgress: 0.35,
              progressScale: 0.65,
            });

            setProgress(1.0);
            setBackupStatus('Restoration Complete!');
            await new Promise(resolve => setTimeout(resolve, 500));
            showRestoreResults(fileName, restoreResult, 'Fresh Installation');
          } catch (error: any) {
            console.error('Storage restore error:', error);
            setSuccessModalData({
              title: 'Restore Failed',
              type: 'error',
              message: 'Failed to restore from storage',
              details: [error.message],
            });
            setShowSuccessModal(true);
          } finally {
            try {
              await clearSelectedBusiness();
            } catch (clearError) {
              console.warn('⚠️ Failed to clear selected business:', clearError);
            }
            setLoading(false);
            setShowRestoreModal(false);
            setShowRestoreProgressModal(false);
            setRestoreModalData(null);
            setBackupStatus('');
            setProgress(0);
            resumeAutoLock();
          }
        },
      });

      setShowRestoreModal(true);
    } catch (error: any) {
      console.error('Error preparing storage restore:', error);
      showSnackbar(`Failed to prepare storage restore: ${error.message}`, 'error');
      setLoading(false);
      setProgress(0);
      setBackupStatus('');
      resumeAutoLock();
    }
  };

  const executeReplication = async (): Promise<void> => {
    if (!checkOnline('Database Replication') || !requireCloudSync('Database Replication'))
      return;

    try {
      setShowReplicateDialog(false);
      setLoading(true);
      setProgressOperationType('replicate');
      setShowRestoreProgressModal(true);
      pauseAutoLock();
      setBackupStatus('Connecting to replica database...');
      setProgress(0.05);

      const result = await replicateToReplica({
        setProgress,
        setBackupStatus,
        baseProgress: 0,
        progressScale: 1,
      });

      setProgress(1.0);
      setBackupStatus('Replication Complete!');
      await new Promise(resolve => setTimeout(resolve, 500));

      const duration = result?.duration ?? 0;
      const records = result?.total_records_restored ?? 0;
      const businesses = result?.businesses_restored ?? 0;

      setSuccessModalData({
        title: 'Replication Complete',
        type: 'success',
        message: 'Data successfully replicated to your external replica project.',
        details: [
          `Target Replica: ${backupProjectRef || 'Configured Project'}`,
          `Records Replicated: ${records}`,
          `Businesses Replicated: ${businesses}`,
          `Duration: ${duration}s`,
        ],
      });
      setShowSuccessModal(true);
    } catch (error: any) {
      console.error('Replication error:', error);
      setShowRestoreProgressModal(false);
      setSuccessModalData({
        title: 'Replication Failed',
        type: 'error',
        message: 'Failed to replicate to replica database',
        details: [error.message || 'Unknown error'],
      });
      setShowSuccessModal(true);
    } finally {
      setLoading(false);
      setShowRestoreProgressModal(false);
      setProgress(0);
      setBackupStatus('');
      resumeAutoLock();
    }
  };

  const handleRestoreFromReplica = async (): Promise<void> => {
    if (!checkOnline('Restore from Replica') || !requireCloudSync('Restore from Replica'))
      return;

    setRestoreModalData({
      type: 'storage',
      fileName: 'External Replica Database',
      onCancel: () => {
        setShowRestoreModal(false);
        setRestoreModalData(null);
      },
      onConfirm: async () => {
        try {
          setShowRestoreModal(false);
          setProgressOperationType('restore');
          setShowRestoreProgressModal(true);
          pauseAutoLock();
          setBackupStatus('Connecting to replica database...');
          setProgress(0.05);

          const restoreResult = await restoreFromReplica({
            setProgress,
            setBackupStatus,
            baseProgress: 0.05,
            progressScale: 0.95,
          });

          setProgress(1.0);
          setBackupStatus('Restoration Complete!');
          await new Promise(resolve => setTimeout(resolve, 500));

          const failedCount =
            restoreResult?.details?.tables_failed ?? restoreResult?.tables_failed ?? 0;
          const restoredRecords = restoreResult?.total_records_restored ?? 0;
          const duration = restoreResult?.duration ?? 0;
          const successDetails = [
            `Restored Records: ${restoredRecords}`,
            `Duration: ${duration}s`,
          ];

          if (restoreResult?.details?.restore_results || restoreResult?.restore_results) {
            const restoreResults =
              restoreResult.details?.restore_results ||
              restoreResult.restore_results ||
              [];
            const successCount = restoreResults.filter((r: any) => r.success).length;
            const totalCount = restoreResults.length;
            successDetails.push(`Tables Restored: ${successCount}/${totalCount}`);
          }

          setSuccessModalData({
            title:
              failedCount === 0
                ? 'Restoration Complete'
                : 'Restoration Completed with Warnings',
            type: failedCount === 0 ? 'success' : 'warning',
            message:
              failedCount === 0
                ? 'Data successfully restored from replica.'
                : 'Data restored from replica with some issues.',
            details: successDetails,
            failedTables:
              failedCount > 0 &&
              (restoreResult?.details?.restore_results || restoreResult?.restore_results)
                ? (
                    restoreResult.details?.restore_results ||
                    restoreResult.restore_results
                  )
                    .filter((r: any) => !r.success)
                    .map((r: any) => `${r.table} - ${r.error}`)
                    .join('\n• ')
                : undefined,
            warning: '⚠️ This is a fresh installation from the replica.',
          });
          setShowSuccessModal(true);
        } catch (error: any) {
          console.error('Restore from replica error:', error);
          setShowRestoreProgressModal(false);
          setSuccessModalData({
            title: 'Restoration Failed',
            type: 'error',
            message: 'Failed to restore from replica',
            details: [error.message || 'Unknown error'],
          });
          setShowSuccessModal(true);
        } finally {
          setLoading(false);
          setShowRestoreProgressModal(false);
          try {
            await clearSelectedBusiness();
          } catch (e) {
            console.warn('Failed to clear business context', e);
          }
          resumeAutoLock();
        }
      },
    });

    setShowRestoreModal(true);
  };

  const toggleTable = (tableName: string): void => {
    setExpandedTables(prev => ({
      ...prev,
      [tableName]: !prev[tableName],
    }));
  };

  const checkForStaleBackups = useCallback(
    async (isManual: boolean = false): Promise<void> => {
      if (isManual) {
        if (
          !checkOnline('Check For Stale Backups') ||
          !requireCloudSync('Check For Stale Backups')
        )
          return;
      } else {
        if (!isOnline || !isCloudSyncEnabled) return;
      }

      if (!selectedBusiness?.id) return;

      try {
        setCheckingStaleBackups(true);

        const scheduleData = allBackupSchedules.find(
          (s: any) => s.business_id === selectedBusiness.id,
        );

        const schedule = scheduleData?.schedule || {};
        const frequency = (schedule as any).frequency || 'weekly';

        let retentionDays = 7;
        switch (frequency) {
          case 'daily':
            retentionDays = 3;
            break;
          case 'weekly':
            retentionDays = 7;
            break;
          case 'monthly':
            retentionDays = 30;
            break;
          default:
            retentionDays = 7;
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        const businessFolder = `backups/${selectedBusiness.name}`;
        const { data: folders } = await supabase.storage
          .from('private-assets')
          .list(businessFolder, { limit: 1000 });

        if (!folders) {
          setHasStaleBackups(false);
          return;
        }

        const staleFolders = folders.filter((folder: any) => {
          const dateMatch = folder.name.match(/^\d{4}-\d{2}-\d{2}$/);
          if (!dateMatch) return false;

          const folderDate = new Date(folder.name);
          if (Number.isNaN(folderDate.getTime())) return false;

          return folderDate < cutoffDate;
        });

        setHasStaleBackups(staleFolders.length > 0);
      } catch (error) {
        console.error('Error checking for stale backups:', error);
        setHasStaleBackups(false);
      } finally {
        setCheckingStaleBackups(false);
      }
    },
    [
      checkOnline,
      requireCloudSync,
      isOnline,
      isCloudSyncEnabled,
      selectedBusiness,
      allBackupSchedules,
    ],
  );

  const handleCleanupBackups = async (): Promise<void> => {
    if (!selectedBusiness?.id) {
      showSnackbar('No business selected', 'error');
      return;
    }

    setShowCleanupDialog(true);
  };

  const [showCleanupDialog, setShowCleanupDialog] = useState(false);

  useEffect(() => {
    if (requireBusiness()) {
      listStorageFiles();
      checkForStaleBackups();
    }
  }, [listStorageFiles, checkForStaleBackups, requireBusiness]);

  return {
    loading,
    setLoading,
    progress,
    setProgress,
    backupStatus,
    setBackupStatus,
    showBackupDialog,
    setShowBackupDialog,
    backupOptions,
    setBackupOptions,
    previewData,
    setPreviewData,
    showPreviewDialog,
    setShowPreviewDialog,
    expandedTables,
    setExpandedTables,
    storageFiles,
    setStorageFiles,
    loadingStorage,
    setLoadingStorage,
    storageFolders,
    setStorageFolders,
    currentStoragePath,
    setCurrentStoragePath,
    downloadingFileName,
    setDownloadingFileName,
    hasStaleBackups,
    setHasStaleBackups,
    checkingStaleBackups,
    setCheckingStaleBackups,
    showRestoreModal,
    setShowRestoreModal,
    restoreModalData,
    setRestoreModalData,
    showSuccessModal,
    setShowSuccessModal,
    successModalData,
    setSuccessModalData,
    showRestoreProgressModal,
    setShowRestoreProgressModal,
    progressOperationType,
    setProgressOperationType,
    showReplicateDialog,
    setShowReplicateDialog,
    backupProjectRef,
    setBackupProjectRef,
    isCloudSyncEnabled,
    executeBackup,
    handleBackup,
    handleChangeFolder,
    listStorageFiles,
    handleRestore,
    showRestoreResults,
    confirmRestore,
    restoreFromStorageFile,
    executeReplication,
    handleRestoreFromReplica,
    toggleTable,
    checkForStaleBackups,
    handleCleanupBackups,
    showCleanupDialog,
    setShowCleanupDialog,
    selectedBusiness,
    requireBusiness,
    colors,
    router,
    isOnline,
    showSnackbar,
  };
}
