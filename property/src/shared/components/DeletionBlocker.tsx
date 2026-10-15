import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Divider, Surface, Text } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import { useAccountDeletion } from '@/shared/hooks/useAccountDeletion';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDateTime } from '@/shared/utils/formatters';

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
}

const calculateTimeLeft = (targetDateStr: string): TimeLeft => {
  const difference = +new Date(targetDateStr) - Date.now();
  let timeLeft: TimeLeft = {
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    isExpired: true,
  };

  if (difference > 0) {
    timeLeft = {
      days: Math.floor(difference / (1000 * 60 * 60 * 24)),
      hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((difference / 1000 / 60) % 60),
      seconds: Math.floor((difference / 1000) % 60),
      isExpired: false,
    };
  }

  return timeLeft;
};

export default function DeletionBlocker() {
  const colors = useThemeColors();
  const { confirmSignOut } = useAuth();
  const { showSnackbar } = useSnackbar();
  const {
    scheduledDeletionAt,
    cancelDeletion,
    loading: hookLoading,
  } = useAccountDeletion();

  const [localLoading, setLocalLoading] = useState(false);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() =>
    calculateTimeLeft(scheduledDeletionAt || ''),
  );

  useEffect(() => {
    if (!scheduledDeletionAt) return;

    // Run immediately
    setTimeLeft(calculateTimeLeft(scheduledDeletionAt));

    const timer = setInterval(() => {
      const updatedTime = calculateTimeLeft(scheduledDeletionAt);
      setTimeLeft(updatedTime);
      if (updatedTime.isExpired) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [scheduledDeletionAt]);

  const handleCancelDeletion = () => {
    setCancelModalVisible(true);
  };

  const handleConfirmCancel = async () => {
    setCancelModalVisible(false);
    try {
      await cancelDeletion();
    } catch (_err: any) {
      // Error handled by hook and displayed via snackbar
    }
  };

  const handleSignOut = async () => {
    try {
      setLocalLoading(true);
      confirmSignOut();
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to sign out', 'error');
    } finally {
      setLocalLoading(false);
    }
  };

  const loading = hookLoading || localLoading;

  const formatDigit = (num: number) => {
    return num.toString().padStart(2, '0');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Surface style={styles.card} elevation={2}>
        <Text variant="headlineSmall" style={[styles.title, { color: colors.error }]}>
          You Requested Account Deletion
        </Text>

        <Text variant="bodyMedium" style={styles.description}>
          {
            "You have scheduled your account and all associated records to be permanently deleted. If this was a mistake, or if you've changed your mind, you can cancel this request at any time before the deletion is finalized to restore full access."
          }
        </Text>

        <View style={styles.countdownContainer}>
          <View style={styles.timeBox}>
            <Surface style={styles.digitSurface} elevation={1}>
              <Text variant="headlineMedium" style={styles.digitText}>
                {formatDigit(timeLeft.days)}
              </Text>
            </Surface>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              Days
            </Text>
          </View>

          <View style={styles.timeBox}>
            <Surface style={styles.digitSurface} elevation={1}>
              <Text variant="headlineMedium" style={styles.digitText}>
                {formatDigit(timeLeft.hours)}
              </Text>
            </Surface>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              Hours
            </Text>
          </View>

          <View style={styles.timeBox}>
            <Surface style={styles.digitSurface} elevation={1}>
              <Text variant="headlineMedium" style={styles.digitText}>
                {formatDigit(timeLeft.minutes)}
              </Text>
            </Surface>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              Mins
            </Text>
          </View>

          <View style={styles.timeBox}>
            <Surface style={styles.digitSurface} elevation={1}>
              <Text variant="headlineMedium" style={styles.digitText}>
                {formatDigit(timeLeft.seconds)}
              </Text>
            </Surface>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              Secs
            </Text>
          </View>
        </View>

        <Divider style={styles.divider} />

        <View style={styles.metaRow}>
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            Deletion date:
          </Text>
          <Text variant="bodyMedium" style={[styles.metaVal, { color: colors.error }]}>
            {formatDateTime(scheduledDeletionAt)}
          </Text>
        </View>

        <Divider style={styles.divider} />

        <Button
          mode="contained"
          onPress={handleCancelDeletion}
          loading={loading}
          disabled={loading}
          buttonColor={colors.primary}
          style={styles.button}
        >
          Cancel Deletion & Restore Access
        </Button>

        <Button
          mode="outlined"
          onPress={handleSignOut}
          disabled={loading}
          style={[styles.button, { marginTop: 12 }]}
        >
          Sign Out
        </Button>

        <BaseModal
          visible={cancelModalVisible}
          onDismiss={() => setCancelModalVisible(false)}
          mode="confirm"
          title="Restore Account Access"
          message="Are you sure you want to cancel the pending account deletion request and restore immediate access?"
          icon="help-circle-outline"
          confirmText="Restore Access"
          cancelText="No"
          onConfirm={handleConfirmCancel}
          onCancel={() => setCancelModalVisible(false)}
        />
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  title: {
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  countdownContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 16,
  },
  timeBox: {
    alignItems: 'center',
    flex: 1,
  },
  digitSurface: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    width: 60,
    alignItems: 'center',
    marginBottom: 6,
  },
  digitText: {
    fontWeight: 'bold',
  },
  divider: {
    width: '100%',
    marginVertical: 16,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    alignItems: 'center',
  },
  metaVal: {
    fontWeight: 'bold',
  },
  button: {
    width: '100%',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
  },
});
