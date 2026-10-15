import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Button,
  Divider,
  HelperText,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import { useAccountDeletion } from '@/shared/hooks/useAccountDeletion';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDate } from '@/shared/utils/formatters';

export default function DeleteAccountScreen() {
  const colors = useThemeColors();
  const { user, signIn } = useAuth();
  const {
    isDeletionPending,
    deletionRequestedAt,
    scheduledDeletionAt,
    requestDeletion,
    cancelDeletion,
    loading,
    error: deletionError,
  } = useAccountDeletion();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [requestModalVisible, setRequestModalVisible] = useState(false);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);

  const handleRequestDeletionClick = async () => {
    if (!password) {
      setLocalError('Password is required');
      return;
    }
    setAuthLoading(true);
    setLocalError('');
    try {
      if (!user?.email) {
        throw new Error('User email not found. Please sign in again.');
      }
      const { error: authError } = await signIn({
        email: user.email,
        password: password,
      });

      if (authError) {
        throw new Error('Incorrect password');
      }

      // Password is correct, show the confirmation modal
      setRequestModalVisible(true);
    } catch (err: any) {
      setLocalError(err?.message || 'Verification failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleConfirmRequest = async () => {
    setRequestModalVisible(false);
    setLocalError('');
    try {
      await requestDeletion();
      setPassword('');
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to request account deletion');
    }
  };

  const handleCancelDeletionClick = () => {
    setCancelModalVisible(true);
  };

  const handleConfirmCancel = async () => {
    setCancelModalVisible(false);
    setLocalError('');
    try {
      await cancelDeletion();
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to cancel deletion request');
    }
  };

  const isActionLoading = loading || authLoading;
  const displayError = localError || deletionError;

  return (
    <KeyboardScroll
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {isDeletionPending ? (
        <View style={styles.section}>
          <Surface style={[styles.card, { borderLeftColor: colors.error }]} elevation={1}>
            <Text variant="titleMedium" style={[styles.title, { color: colors.error }]}>
              Account Deletion Pending
            </Text>
            <Text variant="bodyMedium" style={styles.description}>
              You have requested to delete your account and all associated data.
            </Text>
            <Divider style={styles.divider} />
            <View style={styles.metaRow}>
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                Requested on:
              </Text>
              <Text variant="bodyMedium" style={styles.metaVal}>
                {formatDate(deletionRequestedAt)}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                Scheduled deletion:
              </Text>
              <Text
                variant="bodyMedium"
                style={[styles.metaVal, { color: colors.error, fontWeight: 'bold' }]}
              >
                {formatDate(scheduledDeletionAt)}
              </Text>
            </View>
            <Divider style={styles.divider} />
            <Text
              variant="bodySmall"
              style={{ color: colors.onSurfaceVariant, marginBottom: 16 }}
            >
              If you cancel the deletion request, your account details, properties,
              contracts, and payment history will be preserved.
            </Text>
            {displayError ? (
              <HelperText type="error" visible={!!displayError}>
                {displayError}
              </HelperText>
            ) : null}
            <Button
              mode="contained"
              onPress={handleCancelDeletionClick}
              loading={isActionLoading}
              disabled={isActionLoading}
              buttonColor={colors.primary}
              style={styles.button}
            >
              Cancel Deletion Request
            </Button>
          </Surface>
        </View>
      ) : (
        <View style={styles.section}>
          <Surface style={styles.card} elevation={1}>
            <Text variant="titleMedium" style={[styles.title, { color: colors.error }]}>
              Important Notice
            </Text>
            <Text variant="bodyMedium" style={styles.description}>
              Requesting account deletion will schedule your account and all associated
              records to be permanently deleted after 3 days.
            </Text>

            <View style={styles.bulletContainer}>
              <Text variant="bodyMedium" style={styles.bulletTitle}>
                The following data will be permanently lost:
              </Text>
              <Text variant="bodyMedium" style={styles.bulletItem}>
                • Business settings, templates, and configurations
              </Text>
              <Text variant="bodyMedium" style={styles.bulletItem}>
                • Tenant details, contacts, and communication logs
              </Text>
              <Text variant="bodyMedium" style={styles.bulletItem}>
                • Rent contracts, invoices, and billing statements
              </Text>
              <Text variant="bodyMedium" style={styles.bulletItem}>
                • Transactions, receipts, and financial archives
              </Text>
              <Text variant="bodyMedium" style={styles.bulletItem}>
                • Offline sync caches and push notification configurations
              </Text>
            </View>

            <Divider style={styles.divider} />

            <Text variant="bodyMedium" style={{ marginBottom: 12 }}>
              To confirm this action, please enter your current account password.
            </Text>

            <TextInput
              label="Account Password"
              placeholder="Enter your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              right={
                <TextInput.Icon
                  icon={showPassword ? 'eye-off' : 'eye'}
                  onPress={() => setShowPassword(!showPassword)}
                />
              }
              style={styles.input}
              mode="outlined"
            />

            {displayError ? (
              <HelperText type="error" visible={!!displayError}>
                {displayError}
              </HelperText>
            ) : null}

            <Button
              mode="contained"
              onPress={handleRequestDeletionClick}
              loading={isActionLoading}
              disabled={isActionLoading || !password}
              buttonColor={colors.error}
              textColor="white"
              style={styles.button}
            >
              Request Account Deletion
            </Button>
          </Surface>
        </View>
      )}

      {/* Confirmation Modals */}
      <BaseModal
        visible={requestModalVisible}
        onDismiss={() => setRequestModalVisible(false)}
        mode="confirm"
        title="Confirm Account Deletion"
        message="Are you absolutely sure you want to request account deletion? Your account and all associated data will be scheduled for permanent deletion in 3 days."
        icon="alert-circle-outline"
        destructive={true}
        confirmText="Request Deletion"
        cancelText="Cancel"
        onConfirm={handleConfirmRequest}
        onCancel={() => setRequestModalVisible(false)}
      />

      <BaseModal
        visible={cancelModalVisible}
        onDismiss={() => setCancelModalVisible(false)}
        mode="confirm"
        title="Cancel Deletion Request"
        message="Are you sure you want to cancel the pending account deletion request?"
        icon="help-circle-outline"
        confirmText="Cancel Request"
        cancelText="No"
        onConfirm={handleConfirmCancel}
        onCancel={() => setCancelModalVisible(false)}
      />
    </KeyboardScroll>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 20,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  description: {
    marginBottom: 16,
    lineHeight: 20,
  },
  divider: {
    marginVertical: 16,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  metaVal: {
    fontWeight: '500',
  },
  bulletContainer: {
    marginVertical: 8,
    paddingLeft: 4,
  },
  bulletTitle: {
    fontWeight: '600',
    marginBottom: 8,
  },
  bulletItem: {
    marginBottom: 4,
    paddingLeft: 8,
  },
  input: {
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  button: {
    marginTop: 8,
    borderRadius: 8,
  },
});
