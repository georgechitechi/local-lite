import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Menu, SegmentedButtons, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import EmailSelector from '@/shared/components/EmailSelector';
import { useCoreMutations } from '@/shared/hooks/useStore';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { createCronJobManager } from '@/shared/services/cronJobManager';
import { secureStorage } from '@/shared/services/secureStorage';
import { supabase } from '@/shared/services/supabase';
import { getSyncClientSync } from '@/shared/services/sync/client';
import { generateUUID } from '@/shared/utils/helper';
import { isActiveScheduleStatus } from '@/shared/utils/statusHelper';
import type { Schedule } from '@/stores/types';

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

const allReportTypes: ReportTypeOption[] = [
  { value: 'properties', label: 'Properties Report', icon: 'home-group' },
  { value: 'houses', label: 'Houses Report', icon: 'home' },
  { value: 'receipts', label: 'Receipts Report', icon: 'cash-multiple' },
  { value: 'expenses', label: 'Expenses Report', icon: 'cash-remove' },
  { value: 'pending_rent', label: 'Pending Rent Report', icon: 'cash-remove' },
  { value: 'tenants', label: 'Tenants Report', icon: 'account-group' },
  { value: 'contracts', label: 'Contracts Report', icon: 'file-document' },
  { value: 'vacant_rooms', label: 'Vacant Rooms Report', icon: 'home-outline' },
];

interface ReportScheduleModalProps {
  visible: boolean;
  onDismiss: () => void;
  editingSchedule: Schedule | null;
  isCreatingNew: boolean;
  store?: any;
  reportSchedules: Schedule[];
  onSuccess?: () => void;
}

export default function ReportScheduleModal({
  visible,
  onDismiss,
  editingSchedule,
  isCreatingNew,
  store,
  reportSchedules,
  onSuccess,
}: ReportScheduleModalProps) {
  const { user } = useAuth();
  const { selectedBusiness } = useBusiness();
  const { insert, update } = useCoreMutations();
  const { showSnackbar } = useSnackbar();
  const { checkOnline } = useOfflineCheck();
  const { requireCloudSync } = useLocalSync();
  const colors = useThemeColors();

  const [saving, setSaving] = useState(false);
  const [showEmailSelector, setShowEmailSelector] = useState(false);
  const [showReportTypeDropdown, setShowReportTypeDropdown] = useState(false);

  const [reportForm, setReportForm] = useState<ReportForm>({
    schedule_type: '',
    frequency: 'daily',
    emails: [],
    time: '04:00:00',
    status: 'active',
  });

  useEffect(() => {
    if (visible) {
      if (isCreatingNew) {
        setReportForm({
          schedule_type: '',
          frequency: 'daily',
          emails: [],
          time: '04:00:00',
          status: 'active',
        });
      } else if (editingSchedule) {
        let cleanTime = '09:00';
        const scheduleObj = editingSchedule.schedule as any;
        if (scheduleObj?.time) {
          const timeMatch = String(scheduleObj.time).match(/^(\d{2}):(\d{2}):(\d{2})/);
          if (timeMatch) {
            const [, hours, minutes] = timeMatch;
            cleanTime = `${hours}:${minutes}`;
          }
        }
        setReportForm({
          schedule_type: editingSchedule.schedule_type || '',
          frequency: scheduleObj?.frequency || 'daily',
          emails: (editingSchedule.emails as any) || [],
          time: cleanTime,
          status: editingSchedule.status === 'paused' ? 'paused' : 'active',
        });
      }
    }
  }, [visible, isCreatingNew, editingSchedule]);

  const getAvailableReportTypes = (): ReportTypeOption[] => {
    const existingTypes = reportSchedules
      .filter(s => isCreatingNew || s.id !== editingSchedule?.id)
      .map(s => s.schedule_type);
    return allReportTypes.filter(type => !existingTypes.includes(type.value));
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
      if (!user) throw new Error('User not authenticated');
      if (!selectedBusiness?.id || !store) throw new Error('Store or business not found');

      let cleanTime = reportForm.time;
      if (cleanTime && !cleanTime.match(/^\d{2}:\d{2}(:\d{2})?$/)) {
        const timeMatch = cleanTime.match(/^(\d{2}):(\d{2})/);
        if (timeMatch) {
          cleanTime = timeMatch[0];
        } else {
          cleanTime = '09:00';
        }
      }

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

      try {
        const supabaseUrl = (await secureStorage.getItem(
          'supabase_custom_url',
        )) as string;
        const cronManager = createCronJobManager(supabase, supabaseUrl);

        let activeCount = 0;
        const client = getSyncClientSync();
        if (client) {
          const rows = await client.db.execute(
            "SELECT COUNT(*) as count FROM schedules WHERE schedule_type != 'system_backup' AND status = 'active'"
          );
          activeCount = Number(rows?.[0]?.count ?? 0);
        } else {
          const { data: activeSchedules } = await supabase
            .from('schedules')
            .select('id')
            .neq('schedule_type', 'system_backup')
            .eq('status', 'active')
            .limit(1);
          activeCount = activeSchedules?.length ?? 0;
        }

        if (isActiveScheduleStatus(reportForm)) {
          if (activeCount > 0) {
            const cronResult = await cronManager.syncMasterReportJob('0 * * * *');
            if (!cronResult.success) {
              console.warn('Master report cron job sync warning:', cronResult.error);
            }
          }
        } else {
          if (activeCount === 0) {
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
      onSuccess?.();
      onDismiss();
    } catch (error: any) {
      console.error('Error saving report schedule:', error);
      showSnackbar('Failed to save report schedule', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title={
          isCreatingNew
            ? 'Create New Report Schedule'
            : `Edit ${editingSchedule?.schedule_type?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} Schedule`
        }
        subtitle="View property reports"
        scrollable={true}
        maxHeight="85%"
        actions={[
          { label: 'Cancel', mode: 'outlined', onPress: onDismiss, icon: 'close' },
          {
            label: isCreatingNew ? 'Create' : 'Update',
            mode: 'contained',
            onPress: saveReportSchedule,
            loading: saving,
            icon: 'content-save',
          },
        ]}
      >
        <View style={styles.dialogContent}>
          {isCreatingNew && (
            <View style={styles.formGroup}>
              <Text variant="bodyMedium" style={styles.formLabel}>
                Report Type
              </Text>
              <Menu
                visible={showReportTypeDropdown}
                onDismiss={() => setShowReportTypeDropdown(false)}
                anchor={
                  <Button
                    mode="outlined"
                    onPress={() => setShowReportTypeDropdown(true)}
                    icon="chevron-down"
                    style={styles.dropdownButton}
                    contentStyle={styles.dropdownButtonContent}
                  >
                    {reportForm.schedule_type
                      ? allReportTypes.find(
                          type => type.value === reportForm.schedule_type,
                        )?.label
                      : 'Select Report Type'}
                  </Button>
                }
              >
                {getAvailableReportTypes().map(type => (
                  <Menu.Item
                    key={type.value}
                    onPress={() => {
                      setReportForm(prev => ({ ...prev, schedule_type: type.value }));
                      setShowReportTypeDropdown(false);
                    }}
                    title={type.label}
                    leadingIcon={type.icon}
                  />
                ))}
              </Menu>
              {getAvailableReportTypes().length === 0 && (
                <Text
                  variant="bodySmall"
                  style={[styles.warningText, { color: colors.error }]}
                >
                  All report types already have schedules configured
                </Text>
              )}
            </View>
          )}

          <View style={styles.formGroup}>
            <Text variant="bodyMedium" style={styles.formLabel}>
              Status
            </Text>
            <SegmentedButtons
              value={reportForm.status}
              onValueChange={value =>
                setReportForm(prev => ({ ...prev, status: value as 'active' | 'paused' }))
              }
              buttons={[
                { value: 'active', label: 'Active', icon: 'check-circle' },
                { value: 'paused', label: 'Inactive', icon: 'pause-circle' },
              ]}
              style={styles.segmentedButtons}
            />
          </View>

          <View style={styles.formGroup}>
            <Text variant="bodyMedium" style={styles.formLabel}>
              Frequency
            </Text>
            <SegmentedButtons
              value={reportForm.frequency}
              onValueChange={value =>
                setReportForm(prev => ({
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
              label="Schedule Time"
              value={reportForm.time}
              onChange={time =>
                setReportForm(prev => ({ ...prev, time: time || '04:00:00' }))
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
              icon="email-outline"
              style={styles.emailSelectorButton}
              contentStyle={styles.emailSelectorContent}
            >
              {reportForm.emails.length > 0
                ? `${reportForm.emails.length} recipient${reportForm.emails.length > 1 ? 's' : ''} selected`
                : 'Select Recipients'}
            </Button>
          </View>
        </View>
      </BaseModal>

      {showEmailSelector && (
        <EmailSelector
          visible={true}
          onDismiss={() => setShowEmailSelector(false)}
          selectedEmails={reportForm.emails}
          onEmailsChange={(emails: string[]) =>
            setReportForm(prev => ({ ...prev, emails }))
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
  dropdownButton: {
    borderWidth: 2,
    borderRadius: 8,
    justifyContent: 'flex-start',
  },
  dropdownButtonContent: {
    paddingHorizontal: 12,
  },
  warningText: {
    fontStyle: 'italic',
    marginTop: 8,
  },
});
