import { StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Text } from 'react-native-paper';
import { createCronJobManager } from '@/shared/services/cronJobManager';
import { secureStorage } from '@/shared/services/secureStorage';
import { supabase } from '@/shared/services/supabase';

export function SystemAutomationsCard({ flow }: { flow: any }) {
  const {
    theme,
    checkOnline,
    requireCloudSync,
    showSnackbar,
    saving,
    setShowSelectionDialog,
    setAvailableJobs,
    fetchingCrons,
    setFetchingCrons,
    runningAllReports,
    backingUp,
    fetchActiveQueues,
  } = flow;

  return (
    <>
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
                if (!checkOnline('Cron Job Setup') || !requireCloudSync('Cron Job Setup'))
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
              onPress={fetchActiveQueues}
              disabled={saving || fetchingCrons || backingUp || runningAllReports}
            >
              View Active Queues
            </Button>
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
  backupActions: {
    marginTop: 16,
  },
  backupButton: {
    flex: 1,
  },
});
