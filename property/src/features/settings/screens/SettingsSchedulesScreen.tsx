import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Chip,
  IconButton,
  Menu,
  Text,
  useTheme,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { type ReportType, sendReport } from '@/features/reports/utils';
import {
  ActiveQueuesModal,
  BackupScheduleModal,
  CronJobStatusModal,
  CronJobsModal,
  DeleteScheduleModal,
  EmailReminderModal,
  ReportScheduleModal,
} from '@/features/settings/components/schedules';
import { useAuth } from '@/providers/AuthProvider';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import {
  useBackupSchedules,
  useCoreMutations,
  useReportSchedules,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import {
  type CronJobResult,
  createCronJobManager,
} from '@/shared/services/cronJobManager';
import {
  cancelScheduledReminder,
  getAllScheduledReminders,
} from '@/shared/services/notifications';
import { secureStorage } from '@/shared/services/secureStorage';
import { supabase } from '@/shared/services/supabase';
import { formatDateTime } from '@/shared/utils/formatters';
import { EMPTY_ARRAY, properCase, snakeCaseToTitleCase } from '@/shared/utils/helper';
import { isActiveScheduleStatus } from '@/shared/utils/statusHelper';
import type { Schedule } from '@/stores/types';

export default function ScheduleManagement() {
  const { session } = useAuth();

  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const theme = useTheme();
  const { checkOnline } = useOfflineCheck();
  const { requireCloudSync } = useLocalSync();
  const { showSnackbar } = useSnackbar();

  const allBackupSchedules = useBackupSchedules(selectedBusiness?.id);
  const allReportSchedules = useReportSchedules(selectedBusiness?.id);
  const { update } = useCoreMutations();

  const [loading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  // UI states
  const [showBackupDialog, setShowBackupDialog] = useState<boolean>(false);
  const [showReportDialog, setShowReportDialog] = useState<boolean>(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<boolean>(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [deletingSchedule, setDeletingSchedule] = useState<Schedule | null>(null);
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [showEmailReminderDialog, setShowEmailReminderDialog] = useState<boolean>(false);
  const [showCronStatusDialog, setShowCronStatusDialog] = useState<boolean>(false);
  const [showSelectionDialog, setShowSelectionDialog] = useState<boolean>(false);
  const [availableJobs, setAvailableJobs] = useState<any[]>([]);
  const [fetchingCrons, setFetchingCrons] = useState<boolean>(false);
  const [runningAllReports, setRunningAllReports] = useState<boolean>(false);
  const [backingUp, setBackingUp] = useState<boolean>(false);
  const [cronJobResults] = useState<CronJobResult[]>([]);
  const [showQueueModal, setShowQueueModal] = useState<boolean>(false);
  const [loadingQueues, setLoadingQueues] = useState<boolean>(false);
  const [activeQueuesData, setActiveQueuesData] = useState<any[]>([]);
  const [localReminders, setLocalReminders] = useState<any[]>([]);

  const loadLocalReminders = useCallback(async () => {
    const reminders = await getAllScheduledReminders();
    setLocalReminders(reminders);
  }, []);

  useEffect(() => {
    loadLocalReminders();
  }, [loadLocalReminders]);

  // Get current backup schedule from store
  const backupSchedule = allBackupSchedules[0] as unknown as Schedule | null;
  const reportSchedules = allReportSchedules as unknown as Schedule[];

  // Available report types
  const allReportTypes = [
    { value: 'properties', label: 'Properties Report', icon: 'home-group' },
    { value: 'houses', label: 'Houses Report', icon: 'home' },
    { value: 'receipts', label: 'Receipts Report', icon: 'cash-multiple' },
    { value: 'expenses', label: 'Expenses Report', icon: 'cash-remove' },
    {
      value: 'pending_rent',
      label: 'Pending Rent Report',
      icon: 'cash-remove',
    },
    { value: 'tenants', label: 'Tenants Report', icon: 'account-group' },
    { value: 'contracts', label: 'Contracts Report', icon: 'file-document' },
    {
      value: 'vacant_rooms',
      label: 'Vacant Rooms Report',
      icon: 'home-outline',
    },
  ];

  // Sort report schedules by schedule_type
  const getSortedReportSchedules = (): Schedule[] => {
    return [...reportSchedules].sort((a, b) => {
      const typeA =
        allReportTypes.find(type => type.value === a.schedule_type)?.label ||
        a.schedule_type;
      const typeB =
        allReportTypes.find(type => type.value === b.schedule_type)?.label ||
        b.schedule_type;
      return typeA.localeCompare(typeB);
    });
  };
  const openEditDialog = (schedule: Schedule): void => {
    setEditingSchedule(schedule);
    setIsCreatingNew(false);
    setShowReportDialog(true);
  };

  const openCreateDialog = (): void => {
    setEditingSchedule(null);
    setIsCreatingNew(true);
    setShowReportDialog(true);
  };

  const closeReportDialog = (): void => {
    setShowReportDialog(false);
    setEditingSchedule(null);
    setIsCreatingNew(false);
  };

  const triggerManualBackup = async (): Promise<void> => {
    if (!selectedBusiness?.id) return;
    if (!checkOnline('Manual Backup') || !requireCloudSync('Manual Backup')) return;
    try {
      setBackingUp(true);

      if (backupSchedule?.id) {
        // Set to 5 minutes ago to ensure backend cron picks it up
        const targetTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        if (update) {
          await update('schedules', backupSchedule.id, { next_run: targetTime });
        }
      }

      const token = session?.access_token;

      const { error } = await supabase.functions.invoke('backup-scheduler', {
        body: {
          manual_trigger: true,
          manual_business_ids: [selectedBusiness.id],
        },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (error) throw error;

      showSnackbar('Backup triggered successfully', 'success');
    } catch (error: any) {
      console.error('Error triggering backup:', error);
      showSnackbar('Failed to trigger backup', 'error');
    } finally {
      setBackingUp(false);
    }
  };

  const triggerManualReport = async (reportType: string): Promise<void> => {
    if (!checkOnline('Manual Report') || !requireCloudSync('Manual Report')) return;
    try {
      setSaving(true);

      const schedule = reportSchedules.find(
        s => s.schedule_type === reportType && isActiveScheduleStatus(s),
      );

      if (!schedule) {
        showSnackbar(`No active schedule found for ${reportType} report`, 'error');
        setSaving(false);
        return;
      }

      const token = session?.access_token;

      const { error } = await supabase.functions.invoke('reports', {
        body: {
          scheduleId: schedule.id,
        },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (error) throw error;

      showSnackbar(`${reportType} report triggered successfully`, 'success');
    } catch (error: any) {
      console.error('Error triggering report:', error);
      showSnackbar('Failed to trigger report', 'error');
    } finally {
      setSaving(false);
    }
  };

  const sendPDFNow = async (schedule: Schedule): Promise<void> => {
    if (!selectedBusiness?.id) return;
    if (!checkOnline('Send PDF') || !requireCloudSync('Send PDF')) return;
    try {
      setSaving(true);

      const result = await sendReport(
        selectedBusiness.id,
        schedule.schedule_type as ReportType,
        (schedule.emails as any) || [],
      );

      showSnackbar(
        `${snakeCaseToTitleCase(schedule.schedule_type)} PDF sent successfully to ${result.recipientCount} recipient(s)`,
        'success',
      );
    } catch (error: any) {
      console.error('Error sending PDF:', error);
      showSnackbar('Failed to send PDF report', 'error');
    } finally {
      setSaving(false);
    }
  };

  const runAllScheduledReports = async (): Promise<void> => {
    if (reportSchedules.length === 0) {
      showSnackbar('No scheduled reports to run', 'info');
      setRunningAllReports(false);
      return;
    }

    if (!checkOnline('Run All Reports') || !requireCloudSync('Run All Reports')) return;

    try {
      setRunningAllReports(true);

      // Get all active schedules
      const activeSchedules = reportSchedules.filter(schedule =>
        isActiveScheduleStatus(schedule),
      );

      if (activeSchedules.length === 0) {
        showSnackbar('No active scheduled reports to run', 'info');
        setRunningAllReports(false);
        return;
      }

      const token = session?.access_token;

      // Trigger all active schedules in parallel using their schedule IDs
      const reportPromises = activeSchedules.map(schedule =>
        supabase.functions.invoke('reports', {
          body: {
            scheduleId: schedule.id,
          },
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }),
      );

      const results = await Promise.allSettled(reportPromises);

      // Count successful and failed reports
      const successful = results.filter(result => result.status === 'fulfilled').length;
      const failed = results.filter(result => result.status === 'rejected').length;

      if (failed === 0) {
        showSnackbar(
          `All ${successful} scheduled reports triggered successfully`,
          'success',
        );
      } else if (successful === 0) {
        showSnackbar(`Failed to trigger all ${failed} scheduled reports`, 'error');
      } else {
        showSnackbar(
          `${successful} reports triggered successfully, ${failed} failed`,
          'warning',
        );
      }
    } catch (error: any) {
      console.error('Error running all scheduled reports:', error);
      showSnackbar('Failed to run scheduled reports', 'error');
    } finally {
      setRunningAllReports(false);
    }
  };
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading schedules...</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <Text variant="headlineSmall" style={styles.title}>
            Schedule Management
          </Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            Manage automated tasks and scheduled operations
          </Text>

          {/* System Maintenance Card */}
          <Card style={styles.card}>
            <Card.Content>
              <View style={styles.cardHeader}>
                <Text variant="titleMedium">System Automations</Text>
                <Chip
                  icon="cog-refresh"
                  mode="flat"
                  textStyle={{ color: theme.colors.primary }}
                >
                  Setup
                </Chip>
              </View>

              <View style={styles.scheduleInfo}>
                <Text variant="bodySmall">
                  Ensure all system scheduled tasks (cron jobs, queues, etc) are correctly
                  configured and active.
                </Text>
              </View>

              <View style={styles.backupActions}>
                <Button
                  mode="outlined"
                  icon="clock-check-outline"
                  style={styles.backupButton}
                  disabled={fetchingCrons || backingUp || runningAllReports || saving}
                  loading={fetchingCrons}
                  onPress={async () => {
                    if (
                      !checkOnline('Cron Job Setup') ||
                      !requireCloudSync('Cron Job Setup')
                    )
                      return;
                    try {
                      setFetchingCrons(true);
                      const supabaseUrl = (await secureStorage.getItem(
                        'supabase_custom_url',
                      )) as string;
                      const cronManager = createCronJobManager(supabase, supabaseUrl);

                      // Fetch live statuses
                      const jobsWithStatus = await cronManager.getSystemJobStatuses();
                      setAvailableJobs(jobsWithStatus);

                      setShowSelectionDialog(true);
                    } catch (error) {
                      console.error('Error fetching jobs:', error);
                      showSnackbar('Failed to fetch cron jobs', 'error');
                    } finally {
                      setFetchingCrons(false);
                    }
                  }}
                >
                  Setup Cron Jobs
                </Button>
                <Button
                  mode="outlined"
                  icon="format-list-bulleted"
                  style={[styles.backupButton, { marginTop: 10 }]}
                  onPress={() => setShowQueueModal(true)}
                  disabled={saving || fetchingCrons || backingUp || runningAllReports}
                >
                  View Active Queues
                </Button>
              </View>
            </Card.Content>
          </Card>

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
                    {properCase((backupSchedule.schedule as any)?.frequency || 'weekly')}{' '}
                    at {(backupSchedule.schedule as any)?.time || '02:00:00'}
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
                  {getSortedReportSchedules().map(schedule => (
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
                          {properCase((schedule as any).schedule?.frequency || 'daily')}{' '}
                          at {(schedule as any).schedule?.time}
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

          {/* Email Reminders Card */}
          <Card style={styles.card}>
            <Card.Content>
              <View style={styles.cardHeader}>
                <Text variant="titleMedium">Local Email Reminders</Text>
                <IconButton
                  icon="plus"
                  onPress={() => setShowEmailReminderDialog(true)}
                  disabled={saving}
                  size={24}
                />
              </View>

              <View style={styles.scheduleInfo}>
                <Text variant="bodySmall">
                  Schedule offline notifications to remind you to send emails or follow up
                  on tasks.
                </Text>

                {localReminders.length > 0 && (
                  <View style={{ marginTop: 16 }}>
                    <Text variant="titleSmall" style={{ marginBottom: 8 }}>
                      Active Reminders
                    </Text>
                    {localReminders.map(reminder => (
                      <View
                        key={reminder.identifier}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          backgroundColor: colors.surfaceVariant,
                          padding: 12,
                          borderRadius: 8,
                          marginBottom: 8,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text variant="bodyMedium" numberOfLines={1}>
                            {reminder.content.title}
                          </Text>
                          <Text
                            variant="bodySmall"
                            style={{ color: colors.onSurfaceVariant }}
                          >
                            {reminder.trigger?.type === 'daily'
                              ? `Repeats Daily at ${reminder.trigger.hour?.toString().padStart(2, '0')}:${reminder.trigger.minute?.toString().padStart(2, '0')}`
                              : 'One-time reminder'}
                          </Text>
                        </View>
                        <IconButton
                          icon="delete-outline"
                          iconColor={colors.error}
                          size={20}
                          onPress={async () => {
                            await cancelScheduledReminder(reminder.identifier);
                            loadLocalReminders();
                            showSnackbar('Reminder cancelled.', 'info');
                          }}
                        />
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </Card.Content>
          </Card>
        </View>
      </ScrollView>

      <BackupScheduleModal
        visible={showBackupDialog}
        onDismiss={() => setShowBackupDialog(false)}
        backupSchedule={backupSchedule}
      />

      <EmailReminderModal
        visible={showEmailReminderDialog}
        onDismiss={() => setShowEmailReminderDialog(false)}
        onSuccess={loadLocalReminders}
      />

      <ReportScheduleModal
        visible={showReportDialog}
        onDismiss={closeReportDialog}
        editingSchedule={editingSchedule}
        isCreatingNew={isCreatingNew}
        reportSchedules={reportSchedules}
      />

      <DeleteScheduleModal
        visible={showDeleteDialog}
        onDismiss={() => setShowDeleteDialog(false)}
        deletingSchedule={deletingSchedule}
      />

      <CronJobsModal
        visible={showSelectionDialog}
        onDismiss={() => setShowSelectionDialog(false)}
        availableJobs={availableJobs}
        setAvailableJobs={setAvailableJobs}
      />

      <CronJobStatusModal
        visible={showCronStatusDialog}
        onDismiss={() => setShowCronStatusDialog(false)}
        cronJobResults={cronJobResults}
      />

      <ActiveQueuesModal
        visible={showQueueModal}
        onDismiss={() => setShowQueueModal(false)}
        activeQueuesData={activeQueuesData}
        setActiveQueuesData={setActiveQueuesData}
        loadingQueues={loadingQueues}
        setLoadingQueues={setLoadingQueues}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
  },
  title: {
    marginBottom: 8,
  },
  subtitle: {
    marginBottom: 24,
    opacity: 0.7,
  },
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
  runAllContainer: {
    marginVertical: 8,
  },
  runAllButton: {
    width: '100%',
  },
});
