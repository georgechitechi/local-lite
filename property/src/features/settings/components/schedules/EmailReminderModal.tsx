import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Switch, Text, TextInput } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import {
  areNotificationsEnabled,
  scheduleDailyReminder,
  scheduleReminderNotification,
} from '@/shared/services/notifications';
import { formatDateForDB, parseLocalDate } from '@/shared/utils/formatters';

interface EmailReminderModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSuccess: () => void;
}

export default function EmailReminderModal({
  visible,
  onDismiss,
  onSuccess,
}: EmailReminderModalProps) {
  const { showSnackbar } = useSnackbar();

  const [emailReminderForm, setEmailReminderForm] = useState({
    title: 'Rent Payment Reminder',
    body: 'Time to send rent payment reminders to tenants!',
    date: new Date(),
    time: '09:00:00',
    repeatDaily: true,
  });

  const handleSchedule = async () => {
    const parts = emailReminderForm.time.split(':');
    const d = new Date(emailReminderForm.date);
    d.setHours(parseInt(parts[0] || '9', 10), parseInt(parts[1] || '0', 10), 0, 0);

    if (!emailReminderForm.repeatDaily && d.getTime() <= Date.now()) {
      showSnackbar('Cannot schedule a one-time reminder in the past.', 'error');
      return;
    }

    const notificationsEnabled = await areNotificationsEnabled();
    if (!notificationsEnabled) {
      showSnackbar('Please enable notifications in app settings first.', 'error');
      return;
    }

    let id;
    if (emailReminderForm.repeatDaily) {
      id = await scheduleDailyReminder(
        emailReminderForm.title,
        emailReminderForm.body,
        parseInt(parts[0] || '9', 10),
        parseInt(parts[1] || '0', 10),
        { type: 'email_reminder' },
      );
    } else {
      id = await scheduleReminderNotification(
        emailReminderForm.title,
        emailReminderForm.body,
        d,
        { type: 'email_reminder' },
      );
    }

    if (id) {
      showSnackbar('Reminder scheduled successfully!', 'success');
      onSuccess();
      onDismiss();
    } else {
      showSnackbar('Failed to schedule reminder.', 'error');
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Schedule Email Reminder"
      subtitle="Set a local alarm"
      actions={[
        {
          label: 'Cancel',
          mode: 'outlined',
          onPress: onDismiss,
        },
        {
          label: 'Schedule',
          mode: 'contained',
          onPress: handleSchedule,
          icon: 'clock-check',
        },
      ]}
    >
      <View style={styles.dialogContent}>
        <View style={styles.formGroup}>
          <TextInput
            label="Reminder Title"
            value={emailReminderForm.title}
            onChangeText={text =>
              setEmailReminderForm(prev => ({ ...prev, title: text }))
            }
            mode="outlined"
            style={styles.textInput}
          />
        </View>
        <View style={styles.formGroup}>
          <TextInput
            label="Reminder Message"
            value={emailReminderForm.body}
            onChangeText={text => setEmailReminderForm(prev => ({ ...prev, body: text }))}
            mode="outlined"
            multiline
            numberOfLines={3}
            style={styles.textInput}
          />
        </View>
        <View style={styles.formGroup}>
          <DatePicker
            label="Reminder Date"
            value={formatDateForDB(emailReminderForm.date)}
            onChange={dateStr =>
              setEmailReminderForm(prev => ({
                ...prev,
                date: dateStr ? parseLocalDate(dateStr) : new Date(),
              }))
            }
            mode="date"
          />
        </View>
        <View style={styles.formGroup}>
          <DatePicker
            label="Reminder Time"
            value={emailReminderForm.time}
            onChange={time =>
              setEmailReminderForm(prev => ({ ...prev, time: time || '09:00:00' }))
            }
            mode="time"
          />
        </View>
        <View
          style={[
            styles.formGroup,
            {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            },
          ]}
        >
          <Text variant="bodyLarge">Repeat Daily</Text>
          <Switch
            value={emailReminderForm.repeatDaily}
            onValueChange={value =>
              setEmailReminderForm(prev => ({ ...prev, repeatDaily: value }))
            }
          />
        </View>
      </View>
    </BaseModal>
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
  textInput: {
    backgroundColor: 'transparent',
  },
});
