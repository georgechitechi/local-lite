import { StyleSheet, View } from 'react-native';
import { Button, Card, IconButton, Menu, Text } from 'react-native-paper';
import { formatDateTime } from '@/shared/utils/formatters';
import { properCase, snakeCaseToTitleCase } from '@/shared/utils/helper';
import { isActiveScheduleStatus } from '@/shared/utils/statusHelper';

export function ReportSchedulesCard({ flow }: { flow: any }) {
  const {
    colors,
    theme,
    saving,
    setShowDeleteDialog,
    setDeletingSchedule,
    menuVisible,
    setMenuVisible,
    fetchingCrons,
    runningAllReports,
    backingUp,
    reportSchedules,
    getSortedReportSchedules,
    openEditDialog,
    openCreateDialog,
    triggerManualReport,
    sendPDFNow,
    runAllScheduledReports,
  } = flow;

  return (
    <>
      {/* Report Schedules Card */}
      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.cardHeader}>
            <Text variant="titleMedium">Scheduled Reports</Text>
            <IconButton
              icon="plus"
              onPress={openCreateDialog}
              disabled={saving}
              size={24}
            />
          </View>
          {reportSchedules.length > 0 && (
            <View style={styles.runAllContainer}>
              <Button
                mode="outlined"
                onPress={runAllScheduledReports}
                icon="play-circle"
                disabled={runningAllReports || fetchingCrons || backingUp || saving}
                loading={runningAllReports}
                style={styles.runAllButton}
                compact
              >
                Run All Scheduled Reports
              </Button>
            </View>
          )}

          {reportSchedules.length === 0 ? (
            <Text variant="bodyMedium" style={styles.emptyText}>
              No report schedules configured
            </Text>
          ) : (
            <View style={styles.schedulesContainer}>
              {getSortedReportSchedules().map((schedule: any) => (
                <View
                  key={schedule.id}
                  style={[
                    styles.scheduleItem,
                    {
                      borderColor: theme.colors.outlineVariant,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                    },
                  ]}
                >
                  <View style={styles.scheduleInfo}>
                    <Text variant="bodyMedium">
                      {snakeCaseToTitleCase(schedule.schedule_type)}
                    </Text>
                    <Text variant="bodySmall">
                      Frequency:{' '}
                      {properCase((schedule as any).schedule?.frequency || 'daily')} at{' '}
                      {(schedule as any).schedule?.time}
                    </Text>
                    <Text variant="bodySmall">
                      Next: {formatDateTime(schedule.next_run || '')}
                    </Text>
                    <Text variant="bodySmall">
                      Status:{' '}
                      {schedule.status === 'paused'
                        ? 'Inactive'
                        : isActiveScheduleStatus(schedule)
                          ? 'Active'
                          : schedule.status || 'Active'}
                    </Text>
                    {(schedule.emails as any)?.length > 0 && (
                      <View style={styles.emailContainer}>
                        <View style={styles.emailHeader}>
                          <Text variant="bodySmall" style={styles.emailLabel}>
                            📧 {(schedule.emails as any).length} recipient
                            {(schedule.emails as any).length > 1 ? 's' : ''}
                          </Text>
                        </View>
                        <Text variant="bodySmall" style={styles.emailText}>
                          {(schedule.emails as any).join(',\n')}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.scheduleActions}>
                    <Menu
                      visible={menuVisible === schedule.id}
                      onDismiss={() => setMenuVisible(null)}
                      anchor={
                        <IconButton
                          icon="dots-vertical"
                          size={20}
                          onPress={() => setMenuVisible(schedule.id)}
                        />
                      }
                    >
                      <Menu.Item
                        onPress={() => {
                          setMenuVisible(null);
                          triggerManualReport(schedule.schedule_type);
                        }}
                        title="Run Schedule"
                        leadingIcon="play"
                      />
                      <Menu.Item
                        onPress={() => {
                          setMenuVisible(null);
                          sendPDFNow(schedule);
                        }}
                        title="Send PDF"
                        leadingIcon="email"
                      />
                      <Menu.Item
                        onPress={() => {
                          setMenuVisible(null);
                          openEditDialog(schedule);
                        }}
                        title="Edit Schedule"
                        leadingIcon="pencil"
                      />
                      <Menu.Item
                        onPress={() => {
                          setMenuVisible(null);
                          setDeletingSchedule(schedule);
                          setShowDeleteDialog(true);
                        }}
                        title="Delete Schedule"
                        leadingIcon="delete"
                        titleStyle={{ color: colors.error }}
                      />
                    </Menu>
                  </View>
                </View>
              ))}
            </View>
          )}
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
  schedulesContainer: {
    gap: 8,
  },
  scheduleInfo: {
    flex: 1,
    marginRight: 16,
  },
  scheduleItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginVertical: 4,
    borderRadius: 8,
    borderWidth: 0,
    elevation: 0,
  },
  scheduleActions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 4,
  },
  emailContainer: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
  },
  emptyText: {
    textAlign: 'center',
    opacity: 0.6,
    fontStyle: 'italic',
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
  runAllContainer: {
    marginVertical: 8,
  },
  runAllButton: {
    width: '100%',
  },
});
