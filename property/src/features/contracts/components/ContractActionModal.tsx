import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

export type ContractActionType =
  | 'pause'
  | 'resume'
  | 'terminate'
  | 'batch_pause'
  | 'batch_resume';

export interface ContractActionModalProps {
  visible: boolean;
  onDismiss: () => void;
  actionType: ContractActionType | null;
  subtitle?: string | null;
  actionDate: string;
  onActionDateChange: (date: string) => void;
  onConfirm: () => void;
  loading?: boolean;
}

export default function ContractActionModal({
  visible,
  onDismiss,
  actionType,
  subtitle,
  actionDate,
  onActionDateChange,
  onConfirm,
  loading = false,
}: ContractActionModalProps) {
  const colors = useThemeColors();

  if (!actionType) return null;

  const isPause = actionType === 'pause' || actionType === 'batch_pause';
  const isTerminate = actionType === 'terminate';

  const title = isPause
    ? 'Pause Contract'
    : isTerminate
      ? 'Terminate Contract'
      : 'Resume Contract';

  const confirmLabel = isPause ? 'Pause' : isTerminate ? 'Terminate' : 'Resume';

  const helpText = isPause
    ? 'Select the date when the contract should be paused (inclusive).'
    : isTerminate
      ? 'Select the date when the contract will be terminated.'
      : 'Select the date when the contract will resume.';

  const dateLabel = isPause
    ? 'Pause Date'
    : isTerminate
      ? 'Termination Date'
      : 'Resume Date';

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title={title}
      subtitle={subtitle || undefined}
      actions={[
        {
          label: 'Cancel',
          onPress: onDismiss,
          mode: 'outlined',
        },
        {
          label: confirmLabel,
          onPress: onConfirm,
          loading,
          mode: 'contained',
        },
      ]}
    >
      <View style={styles.content}>
        <Text
          variant="bodySmall"
          style={{ color: colors.onSurfaceVariant, marginBottom: 12 }}
        >
          {helpText}
        </Text>
        <DatePicker
          label={dateLabel}
          value={actionDate}
          onChange={d => d && onActionDateChange(d)}
          maximumDate={null}
        />
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  content: {
    marginBottom: 16,
  },
});
