import { StyleSheet, View } from 'react-native';
import { Card, IconButton, Text } from 'react-native-paper';
import { cancelScheduledReminder } from '@/shared/services/notifications';

export function RemindersCard({ flow }: { flow: any }) {
  const {
    colors,
    showSnackbar,
    saving,
    setShowEmailReminderDialog,
    localReminders,
    loadLocalReminders,
  } = flow;

  return (
    <>
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
              Schedule offline notifications to remind you to send emails or follow up on
              tasks.
            </Text>

            {localReminders.length > 0 && (
              <View style={{ marginTop: 16 }}>
                <Text variant="titleSmall" style={{ marginBottom: 8 }}>
                  Active Reminders
                </Text>
                {localReminders.map((reminder: any) => (
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
});
