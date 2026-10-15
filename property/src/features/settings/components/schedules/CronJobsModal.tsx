import { useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  ActivityIndicator,
  Button,
  IconButton,
  List,
  Switch,
  useTheme,
} from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import {
  type CronJobResult,
  createCronJobManager,
} from '@/shared/services/cronJobManager';
import { secureStorage } from '@/shared/services/secureStorage';
import { supabase } from '@/shared/services/supabase';
import { snakeCaseToTitleCase } from '@/shared/utils/helper';

interface CronJobsModalProps {
  visible: boolean;
  onDismiss: () => void;
  availableJobs: any[];
  setAvailableJobs: (jobs: any[]) => void;
}

export default function CronJobsModal({
  visible,
  onDismiss,
  availableJobs,
  setAvailableJobs,
}: CronJobsModalProps) {
  const theme = useTheme();
  const { showSnackbar } = useSnackbar();
  const { checkOnline } = useOfflineCheck();
  const { requireCloudSync } = useLocalSync();

  const [loadingJob, setLoadingJob] = useState<string | null>(null);

  const toggleJob = async (job: any, val: boolean) => {
    if (!checkOnline('Cron Job Toggle') || !requireCloudSync('Cron Job Toggle')) return;
    try {
      setLoadingJob(job.jobName);
      const supabaseUrl = (await secureStorage.getItem('supabase_custom_url')) as string;
      const cronManager = createCronJobManager(supabase, supabaseUrl);

      if (val) {
        await cronManager.ensureJob(job);
      } else {
        await cronManager.removeJob(job.jobName);
      }

      // Refresh status
      const updatedJobs = await cronManager.getSystemJobStatuses();
      setAvailableJobs(updatedJobs);
    } catch (error) {
      console.error('Error toggling job:', error);
      showSnackbar('Failed to update cron job', 'error');
    } finally {
      setLoadingJob(null);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Configure Cron Jobs"
      subtitle="Select which system jobs to setup"
      scrollable
      maxHeight="85%"
      actions={[
        {
          label: 'Close',
          onPress: onDismiss,
          mode: 'contained',
        },
      ]}
    >
      <List.Section style={{ marginTop: -8, marginBottom: 0 }}>
        {availableJobs.map((job, index) => (
          <List.Item
            key={index}
            title={snakeCaseToTitleCase(job.jobName)}
            titleStyle={{ fontSize: 14, fontWeight: '500', marginBottom: -2 }}
            description={`${job.description || job.schedule}\nStatus: ${job.lastStatus || (job.exists ? 'Active' : 'Not configured')}`}
            descriptionNumberOfLines={2}
            descriptionStyle={{ fontSize: 12, lineHeight: 16, marginTop: 2 }}
            style={{
              paddingVertical: 2,
              paddingHorizontal: 8,
              minHeight: 44,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: theme.colors.surfaceVariant,
            }}
            left={props => (
              <List.Icon
                {...props}
                icon={job.exists ? 'check-circle' : 'circle-outline'}
                color={job.exists ? theme.colors.primary : theme.colors.onSurfaceDisabled}
                style={[
                  props.style,
                  { marginRight: 8, marginVertical: 4, marginLeft: 0 },
                ]}
              />
            )}
            right={() =>
              loadingJob === job.jobName ? (
                <ActivityIndicator size="small" />
              ) : (
                <Switch
                  value={job.exists}
                  disabled={loadingJob !== null}
                  onValueChange={val => toggleJob(job, val)}
                />
              )
            }
          />
        ))}
      </List.Section>
    </BaseModal>
  );
}

export function CronJobStatusModal({
  visible,
  onDismiss,
  cronJobResults,
}: {
  visible: boolean;
  onDismiss: () => void;
  cronJobResults: CronJobResult[];
}) {
  const theme = useTheme();
  const { showSnackbar } = useSnackbar();

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Cron Job Status"
      subtitle="Result of system cron job setup"
      scrollable
    >
      <List.Section>
        {cronJobResults.map((job, index) => (
          <List.Item
            key={index}
            title={snakeCaseToTitleCase(job.job_name || 'Unknown Job')}
            description={
              job.success
                ? `Active • ${job.schedule}`
                : `Error: ${job.error || 'Unknown error'}`
            }
            left={props => (
              <List.Icon
                {...props}
                icon={job.success ? 'check-circle' : 'alert-circle'}
                color={job.success ? theme.colors.primary : theme.colors.error}
              />
            )}
            right={props =>
              job.command ? (
                <IconButton
                  {...props}
                  icon="code-braces"
                  onPress={() => showSnackbar(job.command || 'No command', 'info')}
                />
              ) : null
            }
          />
        ))}
      </List.Section>
      <Button mode="contained" onPress={onDismiss} style={{ marginTop: 16 }}>
        Close
      </Button>
    </BaseModal>
  );
}
