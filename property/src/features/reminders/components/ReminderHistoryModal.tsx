import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import FormattedText from '@/shared/components/FormattedText';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { htmlToPlain } from '@/shared/services/templateService';
import type { ReminderCategoryType, ReminderLog } from '@/shared/types/types';

interface ReminderHistoryModalProps {
  tenant: { id: string; name?: string | null } | null;
  onDismiss: () => void;
  reminderLogs: ReminderLog[];
  selectedCategory: ReminderCategoryType | null;
  selectedDate: Date;
}

export default function ReminderHistoryModal({
  tenant,
  onDismiss,
  reminderLogs,
  selectedCategory,
  selectedDate,
}: ReminderHistoryModalProps) {
  const colors = useThemeColors();

  const logs = tenant
    ? reminderLogs.filter(l => {
        if (l.tenant_id !== tenant.id) return false;
        if (l.reminder_type !== selectedCategory) return false;
        if (l.status !== 'sent') return false;
        if (selectedCategory === 'payment') {
          const targetDate = (l.metadata as any)?.target_date;
          if (!targetDate) return false;
          const d = new Date(targetDate);
          return (
            d.getMonth() === selectedDate.getMonth() &&
            d.getFullYear() === selectedDate.getFullYear()
          );
        }
        return true;
      })
    : [];

  return (
    <BaseModal
      visible={!!tenant}
      onDismiss={onDismiss}
      title="Reminder History"
      subtitle={
        tenant
          ? `${tenant.name} — ${logs.length} reminder${logs.length !== 1 ? 's' : ''} sent`
          : ''
      }
      scrollable={true}
      actions={[
        {
          label: 'Close',
          onPress: onDismiss,
          mode: 'outlined',
        },
      ]}
    >
      {logs.length === 0 ? (
        <Text
          variant="bodyMedium"
          style={{ padding: 16, color: colors.onSurfaceVariant }}
        >
          No sent reminders found.
        </Text>
      ) : (
        logs.map((log, i) => {
          const plainMessage = log.message ? htmlToPlain(log.message) : null;
          return (
            <View
              key={log.id ?? i}
              style={[{ borderBottomColor: colors.outlineVariant }]}
            >
              {/* Header row */}
              <View style={styles.logHeader}>
                <MaterialCommunityIcons
                  name={
                    log.channel === 'email'
                      ? 'email-outline'
                      : log.channel === 'sms'
                        ? 'message-text-outline'
                        : 'whatsapp'
                  }
                  size={20}
                  color={colors.primary}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    variant="bodyMedium"
                    style={{ textTransform: 'capitalize', fontWeight: '500' }}
                  >
                    {log.channel}
                  </Text>
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    {log.sent_at
                      ? new Date(log.sent_at).toLocaleString()
                      : 'Unknown time'}
                  </Text>
                </View>
              </View>
              {/* Message content */}
              <View
                style={[styles.messageBox, { backgroundColor: colors.surfaceVariant }]}
              >
                <FormattedText
                  variant="bodySmall"
                  style={{ color: colors.onSurfaceVariant, lineHeight: 18 }}
                  text={plainMessage || '—'}
                />
              </View>
            </View>
          );
        })
      )}
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  messageBox: {
    borderRadius: 8,
    padding: 10,
  },
});
