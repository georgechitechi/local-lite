import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, SegmentedButtons, Switch, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import EmailSelector from '@/shared/components/EmailSelector';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useCoreMutations } from '@/shared/hooks/useStore';
import { createCronJobManager } from '@/shared/services/cronJobManager';
import { secureStorage } from '@/shared/services/secureStorage';
import { supabase } from '@/shared/services/supabase';
import { getSyncClientSync } from '@/shared/services/sync/client';
import { generateUUID } from '@/shared/utils/helper';
import { isActiveScheduleStatus } from '@/shared/utils/statusHelper';
import type { Schedule } from '@/stores/types';

interface BackupForm {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  time: string;
  emails: string[];
}

interface BackupScheduleModalProps {
  visible: boolean;
  onDismiss: () => void;
  backupSchedule: Schedule | null;
  store?: any;
  onSuccess?: () => void;
}

export default function BackupScheduleModal({
  visible,
  onDismiss,
  backupSchedule,
  store,
  onSuccess,
}: BackupScheduleModalProps) {
  const { user } = useAuth();
  const { selectedBusiness } = useBusiness();
  const { insert, update } = useCoreMutations();
  const { showSnackbar } = useSnackbar();
  const { checkOnline } = useOfflineCheck();
  const { requireCloudSync } = useLocalSync();

  const [saving, setSaving] = useState(false);
  const [showEmailSelector, setShowEmailSelector] = useState(false);

  const [backupForm, setBackupForm] = useState<BackupForm>({
    enabled: false,
    frequency: 'daily',
    time: '04:00:00',
    emails: [],
  });

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

  const checkCronJobStatus = async (): Promise<void> => {
    if (!selectedBusiness?.id) return;
    try {
      const supabaseUrl = (await secureStorage.getItem('supabase_custom_url')) as string;
      const cronManager = createCronJobManager(supabase, supabaseUrl);
      await cronManager.getJob('backup_scheduler');
    } catch (error) {
      console.error('Error checking cron job status:', error);
    }
  };

  const handleSaveBackup = async (): Promise<void> => {
    if (!selectedBusiness?.id || !store) return;
    if (!checkOnline('Save Backup Schedule') || !requireCloudSync('Save Backup Schedule'))
      return;

    setSaving(true);
    try {
      if (!user) throw new Error('User not authenticated');

      let cleanTime = backupForm.time;
      if (cleanTime && !cleanTime.match(/^\d{2}:\d{2}(:\d{2})?$/)) {
        const timeMatch = cleanTime.match(/^(\d{2}):(\d{2})/);
        if (timeMatch) {
          cleanTime = timeMatch[0];
        } else {
          cleanTime = '04:00';
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

      try {
        const supabaseUrl = (await secureStorage.getItem(
          'supabase_custom_url',
        )) as string;
        const cronManager = createCronJobManager(supabase, supabaseUrl);

        if (!backupForm.enabled) {
          let hasActive = false;
          const client = getSyncClientSync();
          if (client) {
            const rows = await client
              .findMany('schedules', {
                where: { schedule_type: 'system_backup', status: 'active' },
              })
              .catch(() => []);
            hasActive = (rows || []).some((r: any) => r.id !== backupSchedule?.id);
          } else if (supabase) {
            const { data: enabledSchedules } = await supabase
              .from('schedules')
              .select('id')
              .eq('schedule_type', 'system_backup')
              .eq('status', 'active')
              .limit(1);
            hasActive = !!enabledSchedules && enabledSchedules.length > 0;
          }

          if (!hasActive) {
            await cronManager.removeMasterBackupJob();
            showSnackbar('Backup schedule disabled and cron job removed', 'success');
          } else {
            showSnackbar('Backup schedule disabled', 'success');
          }
        } else {
          showSnackbar('Backup schedule saved', 'success');
        }

        await checkCronJobStatus();
      } catch (cronError: any) {
        console.error('Master backup cron job sync error:', cronError);
        showSnackbar(
          `Backup schedule updated, but cron job sync failed: ${cronError.message}`,
          'warning',
        );
      }

      onSuccess?.();
      onDismiss();
    } catch (error: any) {
      console.error('Error saving backup schedule:', error);
      showSnackbar('Failed to save backup schedule', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title="Configure Backup Schedule"
        subtitle="Manage your properties"
        actions={[
          {
            label: 'Cancel',
            mode: 'outlined',
            onPress: onDismiss,
          },
          {
            label: 'Save',
            mode: 'contained',
            onPress: handleSaveBackup,
            loading: saving,
            icon: 'content-save',
          },
        ]}
      >
        <View style={styles.dialogContent}>
          <View style={styles.switchRow}>
            <Text>Enable automated backups</Text>
            <Switch
              value={backupForm.enabled}
              onValueChange={value =>
                setBackupForm(prev => ({ ...prev, enabled: value }))
              }
            />
          </View>

          <View style={styles.formGroup}>
            <Text variant="bodyMedium" style={styles.formLabel}>
              Frequency
            </Text>
            <SegmentedButtons
              value={backupForm.frequency}
              onValueChange={value =>
                setBackupForm(prev => ({
                  ...prev,
                  frequency: value as 'daily' | 'weekly' | 'monthly',
                }))
              }
              buttons={[
                { value: 'daily', label: 'Daily', icon: 'calendar-today' },
                { value: 'weekly', label: 'Weekly', icon: 'calendar-week' },
                { value: 'monthly', label: 'Monthly', icon: 'calendar-month' },
              ]}
              style={styles.segmentedButtons}
            />
          </View>

          <View style={styles.formGroup}>
            <DatePicker
              label="Backup Time"
              value={backupForm.time}
              onChange={time =>
                setBackupForm(prev => ({ ...prev, time: time || '04:00:00' }))
              }
              mode="time"
            />
          </View>

          <View style={styles.formGroup}>
            <Text variant="bodyMedium" style={styles.formLabel}>
              Email Recipients
            </Text>
            <Button
              mode="outlined"
              onPress={() => setShowEmailSelector(true)}
              icon="email"
              style={styles.emailSelectorButton}
              contentStyle={styles.emailSelectorContent}
            >
              {backupForm.emails.length > 0
                ? `${backupForm.emails.length} recipient${backupForm.emails.length > 1 ? 's' : ''} selected`
                : 'Select Recipients'}
            </Button>
          </View>
        </View>
      </BaseModal>

      {showEmailSelector && (
        <EmailSelector
          visible={true}
          onDismiss={() => setShowEmailSelector(false)}
          selectedEmails={backupForm.emails}
          onEmailsChange={(emails: string[]) =>
            setBackupForm(prev => ({ ...prev, emails }))
          }
          allowCustomEmails={true}
          showBusinessEmail={true}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  dialogContent: {
    gap: 12,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  formGroup: {
    marginBottom: 2,
    marginHorizontal: 16,
  },
  formLabel: {
    fontWeight: '600',
    marginBottom: 8,
  },
  segmentedButtons: {
    marginBottom: 8,
  },
  emailSelectorButton: {
    borderWidth: 2,
    borderRadius: 8,
  },
  emailSelectorContent: {
    paddingHorizontal: 12,
  },
});
