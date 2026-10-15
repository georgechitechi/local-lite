import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Divider,
  List,
  Portal,
  ProgressBar,
  RadioButton,
  Text,
} from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { getTableColumns } from '@/features/backup/services/backupUtils';
import { useIdleLock } from '@/providers/LockScreenProvider';
import BaseModal from '@/shared/components/BaseModal';
import { supabase } from '@/shared/services/supabase';
import { formatDateTime } from '@/shared/utils/formatters';
import { clearAllPersistence } from '@/stores/syncHelper';

export function BackupModals({ flow }: { flow: any }) {
  const { showSnackbar } = useSnackbar();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();

  const {
    progress,
    backupStatus,
    executeBackup,
    backupProjectRef,
    setShowReplicateDialog,
    progressOperationType,
    currentStoragePath,
    listStorageFiles,
    colors,
    showBackupDialog,
    setShowBackupDialog,
    backupOptions,
    setBackupOptions,
    showCleanupDialog,
    setShowCleanupDialog,
    selectedBusiness,
    checkForStaleBackups,
    executeReplication,
    showPreviewDialog,
    setShowPreviewDialog,
    previewData,
    confirmRestore,
    expandedTables,
    toggleTable,
    showRestoreModal,
    setShowRestoreModal,
    restoreModalData,
    showRestoreProgressModal,
    setShowRestoreProgressModal,
    showSuccessModal,
    setShowSuccessModal,
    successModalData,
    setLoading,
    setProgress,
    setBackupStatus,
    setSuccessModalData,
    showReplicateDialog,
    setRestoreModalData,
  } = flow;

  return (
    <Portal>
      <BaseModal
        visible={showBackupDialog}
        onDismiss={() => {
          setShowBackupDialog(false);
          setLoading(false);
          setProgress(0);
          setBackupStatus('');
        }}
        title="Backup Options"
        subtitle="Manage your properties"
        actions={[
          {
            label: 'Cancel',
            mode: 'outlined',
            onPress: () => {
              setShowBackupDialog(false);
              setLoading(false);
              setProgress(0);
              setBackupStatus('');
            },
            style: { flex: 1 },
          },
          {
            label: 'Proceed',
            mode: 'contained',
            onPress: executeBackup,
            style: { flex: 1 },
          },
        ]}
      >
        <Text variant="titleMedium" style={styles.dialogSectionTitle}>
          Action
        </Text>
        <RadioButton.Group
          onValueChange={value =>
            setBackupOptions((prev: any) => ({
              ...prev,
              action: value as 'share' | 'save',
            }))
          }
          value={backupOptions.action}
        >
          <RadioButton.Item label="Share Backup" value="share" />
          <RadioButton.Item label="Save to Device" value="save" />
        </RadioButton.Group>
      </BaseModal>

      <BaseModal
        mode="confirm"
        visible={showCleanupDialog}
        onDismiss={() => setShowCleanupDialog(false)}
        onConfirm={async () => {
          try {
            setShowCleanupDialog(false);
            setLoading(true);
            pauseAutoLock();
            setBackupStatus('Cleaning up old backups...');
            setProgress(0.1);

            const { data: cleanupResult, error: cleanupError } =
              await supabase.functions.invoke('data-cleanup', {
                body: {
                  action: 'backups',
                  business_id: selectedBusiness?.id,
                },
              });

            if (cleanupError) {
              throw new Error(
                cleanupError.message || 'Failed to invoke cleanup function',
              );
            }

            setProgress(0.8);
            setBackupStatus('Cleanup completed');

            if (cleanupResult.success) {
              showSnackbar(
                `Successfully cleaned up ${cleanupResult.cleaned_count} files.`,
                'success',
              );
              await listStorageFiles(currentStoragePath);
              await checkForStaleBackups(true);
            } else {
              showSnackbar(cleanupResult.error || 'Cleanup Failed', 'error');
            }
          } catch (error: any) {
            console.error('Cleanup error:', error);
            showSnackbar(`Failed to cleanup backups: ${error.message}`, 'error');
          } finally {
            setLoading(false);
            setProgress(0);
            setBackupStatus('');
            resumeAutoLock();
          }
        }}
        title="Clean Old Backups"
        message="This will delete old backup files based on your retention policy. This action cannot be undone. Continue?"
        confirmText="Clean Up"
        destructive={true}
      />

      <BaseModal
        mode="confirm"
        visible={showReplicateDialog}
        onDismiss={() => setShowReplicateDialog(false)}
        title="Replicate Database"
        message={`Are you sure you want to replicate all active database tables to your external replica project (${backupProjectRef || 'Replica'})? Your replica database will be updated with your current data.`}
        confirmText="Replicate Now"
        onConfirm={executeReplication}
      />

      <BaseModal
        visible={showPreviewDialog}
        onDismiss={() => {
          setShowPreviewDialog(false);
          setLoading(false);
          setProgress(0);
          setBackupStatus('');
          resumeAutoLock();
        }}
        title="Backup Preview"
        subtitle="Manage your properties"
        maxHeight="85%"
        actions={[
          {
            label: 'Cancel Restore',
            mode: 'outlined',
            onPress: () => {
              setShowPreviewDialog(false);
              setLoading(false);
              setProgress(0);
              setBackupStatus('');
              resumeAutoLock();
            },
          },
          {
            label: 'Fresh Installation',
            mode: 'contained',
            buttonColor: colors.error,
            textColor: 'white',
            onPress: confirmRestore,
          },
        ]}
      >
        <Text variant="bodyMedium" style={[styles.previewText, { marginVertical: 8 }]}>
          Version: {previewData?.version}
        </Text>
        <Text variant="bodyMedium" style={styles.previewText}>
          Date:{' '}
          {previewData?.timestamp
            ? formatDateTime(new Date(previewData.timestamp))
            : 'Unknown'}
        </Text>
        <Divider style={styles.divider} />
        <ScrollView style={styles.previewScrollView} showsVerticalScrollIndicator={true}>
          <Text variant="titleMedium" style={styles.previewTitle}>
            Tables to Restore:
          </Text>
          {previewData?.tables.map((table: any) => (
            <List.Accordion
              key={table.name}
              title={table.name}
              description={`${table.count} records`}
              left={props => <List.Icon {...props} icon="table" />}
              expanded={expandedTables[table.name]}
              onPress={() => toggleTable(table.name)}
            >
              <List.Section>
                {getTableColumns(previewData.data[table.name]?.[0]).map(column => (
                  <List.Item
                    key={column.name}
                    title={column.name}
                    description={`Type: ${column.type}`}
                    left={props => <List.Icon {...props} icon="view-column" />}
                    style={styles.columnItem}
                  />
                ))}
              </List.Section>
            </List.Accordion>
          ))}
        </ScrollView>
      </BaseModal>

      <BaseModal
        visible={showRestoreModal}
        onDismiss={() => {
          setShowRestoreModal(false);
          setRestoreModalData(null);
          setLoading(false);
          setProgress(0);
          setBackupStatus('');
        }}
        title="Complete Database Wipe"
        subtitle="Manage your properties"
        actions={[
          {
            label: 'Cancel Restore',
            mode: 'outlined',
            onPress: restoreModalData?.onCancel || (() => {}),
          },
          {
            label: 'Fresh Installation',
            mode: 'contained',
            buttonColor: colors.error,
            textColor: 'white',
            onPress: restoreModalData?.onConfirm || (async () => {}),
          },
        ]}
      >
        <View style={styles.modalContent}>
          <Text variant="bodyMedium" style={styles.warningText}>
            This will DELETE ALL DATA in the entire database and restore from backup as a
            FRESH INSTALLATION.
          </Text>
          <Text variant="bodyMedium" style={styles.warningText}>
            This action CANNOT be undone. The restore will create a completely new setup
            with no existing data preserved.
          </Text>
          <Text variant="bodyMedium" style={[styles.warningText, styles.boldText]}>
            Are you absolutely sure you want to continue?
          </Text>
          {restoreModalData?.fileName && (
            <Text variant="bodySmall" style={styles.fileNameText}>
              File: {restoreModalData.fileName}
            </Text>
          )}

          <MaterialCommunityIcons
            name="alert"
            size={80}
            color={(colors as any).error}
            style={styles.warningIcon}
          />
        </View>
      </BaseModal>

      <BaseModal
        visible={showRestoreProgressModal}
        onDismiss={() => {
          if (backupStatus.includes('Error') || backupStatus.includes('Failed')) {
            setShowRestoreProgressModal(false);
            setLoading(false);
            setProgress(0);
            setBackupStatus('');
          }
        }}
        title={
          progressOperationType === 'replicate'
            ? 'Replicating Database'
            : 'Restoring Backup'
        }
        subtitle={
          progressOperationType === 'replicate'
            ? 'Exporting data to replica'
            : 'Restoring your data'
        }
        actions={
          backupStatus.includes('Error') || backupStatus.includes('Failed')
            ? [
                {
                  label: 'Close',
                  mode: 'contained',
                  buttonColor: colors.error,
                  onPress: () => {
                    setShowRestoreProgressModal(false);
                    setLoading(false);
                    setProgress(0);
                    setBackupStatus('');
                  },
                },
              ]
            : []
        }
      >
        <View style={styles.progressModalContent}>
          <MaterialCommunityIcons
            name={
              progressOperationType === 'replicate' ? 'database-export' : 'database-sync'
            }
            size={60}
            color={colors.primary}
            style={styles.progressIcon}
          />

          <Text variant="titleMedium" style={styles.progressTitle}>
            {progressOperationType === 'replicate'
              ? 'Replicating Database'
              : 'Restoring your data...'}
          </Text>

          <Text variant="bodyMedium" style={styles.progressDescription}>
            {progressOperationType === 'replicate'
              ? 'Exporting active records and synchronizing to replica.'
              : 'This may take a few minutes. Please do not close this window.'}
          </Text>

          <View style={styles.restoreProgressContainer}>
            <Text variant="bodySmall" style={styles.progressStatusText}>
              {backupStatus || 'Preparing...'}
            </Text>
            <ProgressBar
              progress={progress}
              color={colors.primary}
              style={styles.restoreProgressBar}
            />
            <Text variant="bodySmall" style={styles.progressPercentageText}>
              {Math.round(progress * 100)}%
            </Text>
          </View>

          <Text variant="bodySmall" style={styles.progressNote}>
            {progressOperationType === 'replicate'
              ? 'Safe operation: Your active database remains untouched. Data is copied directly to your external replica.'
              : 'Your database is being completely wiped and restored from backup.'}
          </Text>
        </View>
      </BaseModal>

      <BaseModal
        visible={showSuccessModal}
        onDismiss={() => {
          setShowSuccessModal(false);
          setSuccessModalData(null);
        }}
        title={successModalData?.title || 'Success'}
        subtitle="Manage your properties"
        actions={[
          {
            label: 'OK',
            mode: 'contained',
            buttonColor:
              successModalData?.type === 'success'
                ? colors.success
                : successModalData?.type === 'error'
                  ? colors.error
                  : colors.warning,
            style: { width: '100%' },
            onPress: async () => {
              const isError = successModalData?.type === 'error';
              const isReplication = successModalData?.title === 'Replication Complete';
              setShowSuccessModal(false);
              setSuccessModalData(null);
              if (!isError && !isReplication) {
                await clearAllPersistence();
              }
            },
          },
        ]}
      >
        <ScrollView
          style={styles.successModalScrollView}
          showsVerticalScrollIndicator={true}
        >
          <View style={styles.successModalContent}>
            <MaterialCommunityIcons
              name={
                successModalData?.type === 'success'
                  ? 'check-circle'
                  : successModalData?.type === 'error'
                    ? 'close-circle'
                    : 'alert-circle'
              }
              size={60}
              color={
                successModalData?.type === 'success'
                  ? colors.success
                  : successModalData?.type === 'error'
                    ? colors.error
                    : colors.warning
              }
              style={styles.successIcon}
            />

            <Text variant="titleMedium" style={styles.successTitle}>
              {successModalData?.message}
            </Text>

            {successModalData?.details && (
              <View style={styles.successDetails}>
                {successModalData.details.map((detail: string, index: number) => (
                  <Text key={index} variant="bodyMedium" style={styles.successDetailItem}>
                    • {detail}
                  </Text>
                ))}
              </View>
            )}

            {successModalData?.failedTables && (
              <View style={styles.failedTablesContainer}>
                <Text variant="titleSmall" style={styles.failedTablesTitle}>
                  Failed Tables:
                </Text>
                <Text variant="bodySmall" style={styles.failedTablesText}>
                  {successModalData.failedTables}
                </Text>
              </View>
            )}

            {successModalData?.warning && (
              <View style={styles.warningContainer}>
                <Text variant="bodySmall" style={styles.warningText}>
                  {successModalData.warning}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </BaseModal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  divider: {
    marginVertical: 8,
  },
  previewText: {
    marginBottom: 8,
  },
  previewTitle: {
    marginTop: 16,
    marginBottom: 8,
  },
  previewScrollView: {
    flex: 1,
    paddingBottom: 0,
  },
  columnItem: {
    paddingLeft: 10,
  },
  modalContent: {
    paddingVertical: 16,
  },
  warningText: {
    marginBottom: 12,
    lineHeight: 20,
  },
  boldText: {
    fontWeight: 'bold',
  },
  fileNameText: {
    marginTop: 8,
    fontStyle: 'italic',
  },
  warningIcon: {
    marginTop: 16,
    alignSelf: 'center',
  },
  restoreProgressContainer: {
    width: '100%',
    marginTop: 16,
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  progressStatusText: {
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '500',
  },
  restoreProgressBar: {
    height: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  progressPercentageText: {
    textAlign: 'center',
    fontSize: 12,
  },
  progressModalContent: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  progressIcon: {
    marginBottom: 16,
  },
  progressTitle: {
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '600',
  },
  progressDescription: {
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  progressNote: {
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
  },
  successModalScrollView: {
    maxHeight: '100%',
    paddingHorizontal: 16,
  },
  successModalContent: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  successIcon: {
    marginBottom: 16,
  },
  successTitle: {
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '600',
  },
  successDetails: {
    width: '100%',
    marginBottom: 16,
  },
  successDetailItem: {
    marginBottom: 4,
  },
  failedTablesContainer: {
    width: '100%',
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  failedTablesTitle: {
    fontWeight: '600',
    marginBottom: 8,
  },
  failedTablesText: {
    fontFamily: 'monospace',
  },
  warningContainer: {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  dialogSectionTitle: {
    marginBottom: 8,
  },
});
