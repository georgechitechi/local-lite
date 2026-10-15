import { ScrollView, StyleSheet } from 'react-native';
import { BackupModals } from '@/features/backup/components/BackupModals';
import { BackupOptionsCard } from '@/features/backup/components/BackupOptionsCard';
import { CloudStorageCard } from '@/features/backup/components/CloudStorageCard';
import { DisasterRecoveryCard } from '@/features/backup/components/DisasterRecoveryCard';
import { useBackupFlow } from '@/features/backup/hooks/useBackupFlow';

export default function BackupRestoreComponent() {
  const flow = useBackupFlow();

  return (
    <ScrollView style={[styles.container, { backgroundColor: flow.colors.background }]}>
      <BackupOptionsCard flow={flow} />
      {flow.isCloudSyncEnabled && <DisasterRecoveryCard flow={flow} />}
      {flow.isCloudSyncEnabled && <CloudStorageCard flow={flow} />}
      <BackupModals flow={flow} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
});
