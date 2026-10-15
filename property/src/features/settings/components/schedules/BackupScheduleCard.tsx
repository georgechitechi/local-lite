import { StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Text } from 'react-native-paper';
import { formatDateTime } from '@/shared/utils/formatters';
import { properCase } from '@/shared/utils/helper';
import { isActiveScheduleStatus } from '@/shared/utils/statusHelper';

export function BackupScheduleCard({ flow }: { flow: any }) {
  const {
    theme,
    saving,
    setShowBackupDialog,
    fetchingCrons,
    runningAllReports,
    backingUp,
    backupSchedule,
    triggerManualBackup,
  } = flow;

  return (
    <>
      {/* Backup Schedule Card */}
      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.cardHeader}>
            <Text variant="titleMedium">Automated Backups</Text>
            <Chip
              icon={isActiveScheduleStatus(backupSchedule) ? 'check' : 'close'}
              mode={isActiveScheduleStatus(backupSchedule) ? 'flat' : 'outlined'}
              textStyle={{
                color: isActiveScheduleStatus(backupSchedule)
                  ? theme.colors.primary
                  : theme.colors.outline,
              }}
            >
              {isActiveScheduleStatus(backupSchedule) ? 'Enabled' : 'Disabled'}
            </Chip>
          </View>

          <View style={styles.scheduleInfo}>
            <Text variant="bodySmall">
              Configure automated backups to securely store your data in the cloud.
            </Text>
          </View>

          {backupSchedule && (
            <View style={styles.scheduleInfo}>
              <Text variant="bodySmall">
                Frequency:{' '}
                {properCase((backupSchedule.schedule as any)?.frequency || 'weekly')} at{' '}
                {(backupSchedule.schedule as any)?.time || '02:00:00'}
              </Text>

              <Text variant="bodySmall">
                Last Backup:{' '}
                {(backupSchedule as any).last_run
                  ? formatDateTime((backupSchedule as any).last_run)
                  : 'Never'}
              </Text>
              <Text variant="bodySmall">
                Next Backup:{' '}
                {(backupSchedule as any).next_run
                  ? formatDateTime((backupSchedule as any).next_run)
                  : 'Not scheduled'}
              </Text>
              {(backupSchedule as any)?.emails?.length > 0 && (
                <View style={styles.emailContainer}>
                  <View style={styles.emailHeader}>
                    <Text variant="bodySmall" style={styles.emailLabel}>
                      📧 {(backupSchedule as any).emails.length} recipient
                      {(backupSchedule as any).emails.length > 1 ? 's' : ''}
                    </Text>
                  </View>
                  <Text variant="bodySmall" style={styles.emailText}>
                    {(backupSchedule as any).emails.join(',\n')}
                  </Text>
                </View>
              )}
            </View>
          )}

          <View style={styles.backupActions}>
            <View style={styles.backupButtons}>
              <Button
                mode="outlined"
                onPress={() => setShowBackupDialog(true)}
                icon="cog"
                style={styles.backupButton}
                disabled={saving}
              >
                Configure
              </Button>
              <Button
                mode="contained"
                onPress={triggerManualBackup}
                icon="play"
                style={styles.backupButton}
                disabled={backingUp || fetchingCrons || runningAllReports || saving}
                loading={backingUp}
              >
                Backup Now
              </Button>
            </View>
          </View>
        </Card.Content>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  scheduleInfo: {
    flex: 1,
    marginRight: 16,
  },
  emailContainer: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
  },
  emailHeader: {
    marginBottom: 4,
  },
  emailLabel: {
    fontWeight: '600',
    fontSize: 12,
  },
  emailText: {
    fontSize: 11,
    lineHeight: 14,
  },
  backupActions: {
    marginTop: 16,
  },
  backupButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  backupButton: {
    flex: 1,
  },
});
