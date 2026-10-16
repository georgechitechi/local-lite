import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { useTheme } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { type ReportType, sendReport } from '@/features/reports/utils';
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
import { getAllScheduledReminders } from '@/shared/services/notifications';
import { secureStorage } from '@/shared/services/secureStorage';
import { supabase } from '@/shared/services/supabase';
import { EMPTY_ARRAY, generateUUID, snakeCaseToTitleCase } from '@/shared/utils/helper';
import { isActiveScheduleStatus } from '@/shared/utils/statusHelper';
import type { Schedule } from '@/stores/types';

interface BackupForm {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  time: string;
  emails: string[];
}

interface ReportForm {
  schedule_type: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  emails: string[];
  time: string;
  status: 'active' | 'paused';
}

interface ReportTypeOption {
  value: string;
  label: string;
  icon: string;
}

export function useSchedulesFlow() {
  const { user, session } = useAuth();

  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const theme = useTheme();
  const { checkOnline } = useOfflineCheck();
  const { requireCloudSync } = useLocalSync();
  const { showSnackbar } = useSnackbar();

  const allBackupSchedules = useBackupSchedules(selectedBusiness?.id);
  const allReportSchedules = useReportSchedules(selectedBusiness?.id);
  const { insert, update, delete: deleteRecord, client } = useCoreMutations();

  const [loading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  // UI states
  const [showBackupDialog, setShowBackupDialog] = useState<boolean>(false);
  const [showReportDialog, setShowReportDialog] = useState<boolean>(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<boolean>(false);
  const [showEmailSelector, setShowEmailSelector] = useState<boolean>(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [deletingSchedule, setDeletingSchedule] = useState<Schedule | null>(null);
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [showReportTypeDropdown, setShowReportTypeDropdown] = useState<boolean>(false);
  const [showEmailReminderDialog, setShowEmailReminderDialog] = useState<boolean>(false);
  const [showCronStatusDialog, setShowCronStatusDialog] = useState<boolean>(false);
  const [showSelectionDialog, setShowSelectionDialog] = useState<boolean>(false);
  const [availableJobs, setAvailableJobs] = useState<any[]>([]);
  const [loadingJob, setLoadingJob] = useState<string | null>(null);
  const [fetchingCrons, setFetchingCrons] = useState<boolean>(false);
  const [runningAllReports, setRunningAllReports] = useState<boolean>(false);
  const [backingUp, setBackingUp] = useState<boolean>(false);
  const [cronJobResults] = useState<CronJobResult[]>([]);
  const [showQueueModal, setShowQueueModal] = useState<boolean>(false);
  const [loadingQueues, setLoadingQueues] = useState<boolean>(false);
  const [activeQueuesData, setActiveQueuesData] = useState<any[]>([]);
  const [openQueueMenuId, setOpenQueueMenuId] = useState<number | null>(null);
  const [previewPayload, setPreviewPayload] = useState<any>(null);
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

  // Form states
  const [backupForm, setBackupForm] = useState<BackupForm>({
    enabled: false,
    frequency: 'daily',
    time: '04:00:00',
    emails: [],
  });

  const [emailReminderForm, setEmailReminderForm] = useState({
    title: 'Rent Payment Reminder',
    body: 'Time to send rent payment reminders to tenants!',
    date: new Date(),
    time: '09:00:00',
    repeatDaily: true,
  });

  const [reportForm, setReportForm] = useState<ReportForm>({
    schedule_type: '',
    frequency: 'daily',
    emails: [],
    time: '03:00:00',
    status: 'active',
  });

  // Available report types
  const allReportTypes: ReportTypeOption[] = [
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

  // Get available report types (filter out existing ones)
  const getAvailableReportTypes = (): ReportTypeOption[] => {
    const existingTypes = reportSchedules.map(schedule => schedule.schedule_type);
    return allReportTypes.filter(type => !existingTypes.includes(type.value));
  };

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

  useEffect(() => {
    if (selectedBusiness?.id && backupSchedule) {
      setBackupForm({
        enabled: isActiveScheduleStatus(backupSchedule),
        frequency: (backupSchedule.schedule as any)?.frequency || 'daily',
        time: (backupSchedule.schedule as any)?.time || '04:00:00',
        emails: (backupSchedule.emails as any) || [],
      });
    }
  }, [backupSchedule, selectedBusiness?.id]);

  const fetchActiveQueues = async () => {
    if (!checkOnline('View Active Queues') || !requireCloudSync('View Active Queues'))
      return;
    try {
      setLoadingQueues(true);
      setShowQueueModal(true);

      const { data: messagesData, error: messagesError } = await supabase.rpc(
        'get_pending_queue_jobs',
        {
          queue_name: 'bulk_messages',
        },
      );
      if (messagesError) throw messagesError;

      const combined = (messagesData || [])
        .map((msg: any) => ({
          ...msg,
          type: msg.message?.channel === 'sms' ? 'SMS' : 'Email',
        }))
        .sort(
          (a: any, b: any) =>
            new Date(b.enqueued_at).getTime() - new Date(a.enqueued_at).getTime(),
        );

      setActiveQueuesData(combined);
    } catch (error: any) {
      console.error('Error fetching active queues:', error);
      showSnackbar('Failed to fetch active queues', 'error');
      setShowQueueModal(false);
    } finally {
      setLoadingQueues(false);
    }
  };

  const handleManageQueueJob = async (
    msgId: number,
    actionType: 'archive' | 'process_now',
  ) => {
    try {
      setLoadingQueues(true);
      const { error } = await supabase.rpc('manage_queue_job', {
        queue_name: 'bulk_messages',
        message_id: msgId,
        action_type: actionType,
      });
      if (error) throw error;

      if (actionType === 'process_now') {
        const token = session?.access_token;
        await supabase.functions.invoke('process-messages', {
          body: { action: 'process_queue' },
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        showSnackbar('Message processed successfully', 'success');
      } else {
        showSnackbar('Message archived successfully', 'success');
      }
      await fetchActiveQueues();
    } catch (e: any) {
      console.error('Failed to manage queue job:', e);
      showSnackbar(e?.message ?? `Failed to ${actionType} message`, 'error');
      setLoadingQueues(false);
    }
  };

  const handleDownloadAttachment = async (attachment: any) => {
    try {
      let content = attachment.content;
      if (!content) {
        showSnackbar('Attachment has no content', 'error');
        return;
      }
      if (content.includes('base64,')) {
        content = content.split('base64,')[1];
      }

      const file = new File(Paths.document, attachment.filename || 'attachment.pdf');
      file.write(content, { encoding: 'base64' });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri);
      } else {
        showSnackbar(`Saved to ${file.uri}`, 'success');
      }
    } catch (e: any) {
      console.error(e);
      showSnackbar('Failed to download attachment', 'error');
    }
  };

  const checkCronJobStatus = async (): Promise<void> => {
    if (!selectedBusiness?.id) return;
    try {
      const supabaseUrl = (await secureStorage.getItem('supabase_custom_url')) as string;
      const cronManager = createCronJobManager(supabase, supabaseUrl);
      // Check master backup scheduler job status
      await cronManager.getJob('backup_scheduler');
    } catch (error) {
      console.error('Error checking cron job status:', error);
    }
  };

  const handleSaveBackup = async (): Promise<void> => {
    if (!selectedBusiness?.id) return;
    if (!checkOnline('Save Backup Schedule') || !requireCloudSync('Save Backup Schedule'))
      return;

    setSaving(true);
    try {
      if (!user) throw new Error('User not authenticated');

      // Ensure time format is clean (HH:MM or HH:MM:SS)
      let cleanTime = backupForm.time;
      if (cleanTime && !cleanTime.match(/^\d{2}:\d{2}(:\d{2})?$/)) {
        const timeMatch = cleanTime.match(/^(\d{2}):(\d{2})/);
        if (timeMatch) {
          cleanTime = timeMatch[0];
        } else {
          cleanTime = '04:00'; // fallback
        }
      }

      const scheduleData = {
        business_id: selectedBusiness.id,
        user_id: user.id,
        schedule_type: 'system_backup',
        status: backupForm.enabled ? 'active' : 'paused',
        schedule: {
          frequency: backupForm.frequency,
          time: cleanTime,
        },
        emails: backupForm.emails,
      };

      if (backupSchedule) {
        if (update) {
          await update('schedules', backupSchedule.id, scheduleData);
        }
      } else {
        const newId = generateUUID();
        if (insert) {
          await insert('schedules', {
            ...scheduleData,
            id: newId,
            last_run: new Date().toISOString(),
            next_run: new Date().toISOString(),
          });
        }
      }

      // Sync master backup cron job
      try {
        const supabaseUrl = (await secureStorage.getItem(
          'supabase_custom_url',
        )) as string;
        const cronManager = createCronJobManager(supabase, supabaseUrl);

        if (backupForm.enabled) {
        } else {
          // Schedule is disabled, check if any active backup schedules remain
          let hasActive = false;
          if (client) {
            const rows = await client.findMany('schedules', {
              where: { schedule_type: 'system_backup', status: 'active' },
            }).catch(() => []);
            hasActive = (rows || []).some((r: any) => !r.deleted && r.id !== backupSchedule?.id);
          } else if (supabase) {
            const { data: enabledSchedules } = await supabase
              .from('schedules')
              .select('id')
              .eq('schedule_type', 'system_backup')
              .eq('status', 'active')
              .limit(1);
            hasActive = !!enabledSchedules && enabledSchedules.length > 0;
          }

          if (!hasActive && supabase) {
            // No enabled schedules, remove the master cron job
            await cronManager.removeMasterBackupJob().catch(() => {});
            showSnackbar('Backup schedule disabled and cron job removed', 'success');
          } else {
            showSnackbar('Backup schedule disabled', 'success');
          }
        }

        // Refresh cron job status
        await checkCronJobStatus();
      } catch (cronError: any) {
        console.error('Master backup cron job sync error:', cronError);
        showSnackbar(
          `Backup schedule updated, but cron job sync failed: ${cronError.message}`,
          'warning',
        );
      }

      setShowBackupDialog(false);
    } catch (error: any) {
      console.error('Error saving backup schedule:', error);
      showSnackbar('Failed to save backup schedule', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openEditDialog = (schedule: Schedule): void => {
    setEditingSchedule(schedule);
    setIsCreatingNew(false);

    // Parse schedule time to Date object and sanitize time format
    let cleanTime = '09:00';

    const scheduleObj = schedule.schedule as any;
    if (scheduleObj?.time) {
      // Extract HH:MM:SS from various formats (including timestamps with microseconds/timezone)
      const timeMatch = String(scheduleObj.time).match(/^(\d{2}):(\d{2}):(\d{2})/);
      if (timeMatch) {
        const [, hours, minutes] = timeMatch;
        cleanTime = `${hours}:${minutes}`;
      }
    }

    setReportForm({
      schedule_type: schedule.schedule_type || '',
      frequency: scheduleObj?.frequency || 'daily',
      emails: (schedule.emails as any) || [],
      time: cleanTime,
      status: schedule.status === 'paused' ? 'paused' : 'active',
    });
    setShowReportDialog(true);
  };

  const openCreateDialog = (): void => {
    setEditingSchedule(null);
    setIsCreatingNew(true);
    setReportForm({
      schedule_type: '',
      frequency: 'daily',
      emails: [],
      time: '04:00:00',
      status: 'active',
    });
    setShowReportDialog(true);
  };

  const closeReportDialog = (): void => {
    setShowReportDialog(false);
    setEditingSchedule(null);
    setIsCreatingNew(false);
    setShowReportTypeDropdown(false);
    setReportForm({
      schedule_type: '',
      frequency: 'daily',
      emails: [],
      time: '04:00:00',
      status: 'active',
    });
  };

  const handleDeleteSchedule = async (): Promise<void> => {
    if (!deletingSchedule) return;

    setSaving(true);
    try {
      if (deleteRecord) {
        await deleteRecord('schedules', deletingSchedule.id);
      }

      showSnackbar('Report schedule deleted successfully', 'success');
      setShowDeleteDialog(false);
      setDeletingSchedule(null);
    } catch (error: any) {
      console.error('Error deleting report schedule:', error);
      showSnackbar('Failed to delete report schedule', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEmailsChange = (emails: string[]): void => {
    setReportForm(prev => ({ ...prev, emails }));
  };

  const saveReportSchedule = async (): Promise<void> => {
    if (!checkOnline('Save Report Schedule') || !requireCloudSync('Save Report Schedule'))
      return;

    if (isCreatingNew && !reportForm.schedule_type) {
      showSnackbar('Please select a report type', 'error');
      return;
    }

    if (!isCreatingNew && !editingSchedule) {
      showSnackbar('No schedule selected for editing', 'error');
      return;
    }

    setSaving(true);
    try {
      // Get current user for user_id

      if (!user) {
        throw new Error('User not authenticated');
      }

      // Ensure time format is clean (HH:MM or HH:MM:SS)
      let cleanTime = reportForm.time;
      if (cleanTime && !cleanTime.match(/^\d{2}:\d{2}(:\d{2})?$/)) {
        // Extract HH:MM from any format
        const timeMatch = cleanTime.match(/^(\d{2}):(\d{2})/);
        if (timeMatch) {
          cleanTime = timeMatch[0];
        } else {
          cleanTime = '09:00'; // fallback
        }
      }

      if (!selectedBusiness?.id) return;
      const scheduleData = {
        business_id: selectedBusiness.id,
        user_id: user.id,
        schedule_type: isCreatingNew
          ? reportForm.schedule_type
          : editingSchedule?.schedule_type,
        schedule: {
          frequency: reportForm.frequency,
          time: cleanTime,
        },
        emails: reportForm.emails,
        status: reportForm.status,
      };

      if (isCreatingNew) {
        const newId = generateUUID();
        if (insert) {
          await insert('schedules', {
            ...scheduleData,
            id: newId,
            last_run: null,
            next_run: new Date().toISOString(),
          });
        }
      } else if (editingSchedule?.id) {
        if (update) {
          await update('schedules', editingSchedule.id, scheduleData);
        }
      }

      // Sync master report cron job based on schedule status
      try {
        const supabaseUrl = (await secureStorage.getItem(
          'supabase_custom_url',
        )) as string;
        const cronManager = createCronJobManager(supabase, supabaseUrl);

        if (isActiveScheduleStatus(reportForm)) {
          // Check if there are any active report schedules across all businesses
          const { data: activeSchedules } = await supabase
            .from('schedules')
            .select('id')
            .neq('schedule_type', 'system_backup')
            .eq('status', 'active')
            .limit(1);

          if (activeSchedules && activeSchedules.length > 0) {
            // Ensure master report job exists and runs hourly
            const cronResult = await cronManager.syncMasterReportJob('0 * * * *'); // Every hour
            if (!cronResult.success) {
              console.warn('Master report cron job sync warning:', cronResult.error);
            }
          }
        } else {
          // Schedule is inactive, check if any active schedules remain
          const { data: activeSchedules } = await supabase
            .from('schedules')
            .select('id')
            .neq('schedule_type', 'system_backup')
            .eq('status', 'active')
            .limit(1);

          if (!activeSchedules || activeSchedules.length === 0) {
            // No active schedules, remove the master cron job
            await cronManager.removeMasterReportJob();
          }
        }
      } catch (cronError: any) {
        console.error('Master report cron job sync error:', cronError);
      }

      showSnackbar(
        `Report schedule ${isCreatingNew ? 'created' : 'updated'} successfully`,
        'success',
      );
      closeReportDialog();
    } catch (error: any) {
      console.error('Error saving report schedule:', error);
      showSnackbar('Failed to save report schedule', 'error');
    } finally {
      setSaving(false);
    }
  };

  const triggerManualBackup = async (): Promise<void> => {
    if (!selectedBusiness?.id) return;
    if (!checkOnline('Manual Backup') || !requireCloudSync('Manual Backup')) return;
    try {
      setBackingUp(true);

      if (backupSchedule?.id) {
        // Set to 5 minutes ago to ensure backend cron picks it up
        const targetTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        // Update local store for UI and sync queue
        if (update) {
          await update('schedules', backupSchedule.id, { next_run: targetTime });
        }

        // Direct remote sync if online
        try {
          await supabase
            .from('schedules')
            .update({ next_run: targetTime })
            .eq('id', backupSchedule.id);
        } catch {
          // Handled via local-lite outbox sync
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
  return {
    user,
    session,
    colors,
    selectedBusiness,
    theme,
    checkOnline,
    requireCloudSync,
    showSnackbar,
    allBackupSchedules,
    allReportSchedules,
    loading,
    saving,
    setSaving,
    showBackupDialog,
    setShowBackupDialog,
    showReportDialog,
    setShowReportDialog,
    showDeleteDialog,
    setShowDeleteDialog,
    showEmailSelector,
    setShowEmailSelector,
    editingSchedule,
    setEditingSchedule,
    deletingSchedule,
    setDeletingSchedule,
    menuVisible,
    setMenuVisible,
    isCreatingNew,
    setIsCreatingNew,
    showReportTypeDropdown,
    setShowReportTypeDropdown,
    showEmailReminderDialog,
    setShowEmailReminderDialog,
    showCronStatusDialog,
    setShowCronStatusDialog,
    showSelectionDialog,
    setShowSelectionDialog,
    availableJobs,
    setAvailableJobs,
    loadingJob,
    setLoadingJob,
    fetchingCrons,
    setFetchingCrons,
    runningAllReports,
    setRunningAllReports,
    backingUp,
    setBackingUp,
    cronJobResults,
    showQueueModal,
    setShowQueueModal,
    loadingQueues,
    setLoadingQueues,
    activeQueuesData,
    setActiveQueuesData,
    openQueueMenuId,
    setOpenQueueMenuId,
    previewPayload,
    setPreviewPayload,
    localReminders,
    setLocalReminders,
    backupSchedule,
    reportSchedules,
    backupForm,
    setBackupForm,
    emailReminderForm,
    setEmailReminderForm,
    reportForm,
    setReportForm,
    allReportTypes,
    getAvailableReportTypes,
    getSortedReportSchedules,
    fetchActiveQueues,
    handleManageQueueJob,
    handleDownloadAttachment,
    checkCronJobStatus,
    handleSaveBackup,
    openEditDialog,
    openCreateDialog,
    closeReportDialog,
    handleDeleteSchedule,
    handleEmailsChange,
    saveReportSchedule,
    triggerManualBackup,
    triggerManualReport,
    sendPDFNow,
    runAllScheduledReports,
    loadLocalReminders,
    store: null,
  };
}
