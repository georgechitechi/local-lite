import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import { useCoreMutations } from '@/shared/hooks/useStore';
import type { Schedule } from '@/stores/types';

interface DeleteScheduleModalProps {
  visible: boolean;
  onDismiss: () => void;
  deletingSchedule: Schedule | null;
  store?: any;
  onSuccess?: () => void;
}

export default function DeleteScheduleModal({
  visible,
  onDismiss,
  deletingSchedule,
  store,
  onSuccess,
}: DeleteScheduleModalProps) {
  const { colors } = useTheme();
  const { showSnackbar } = useSnackbar();
  const { delete: deleteRecord } = useCoreMutations();
  const [saving, setSaving] = useState(false);

  const handleDeleteSchedule = async (): Promise<void> => {
    if (!deletingSchedule) return;

    setSaving(true);
    try {
      if (deleteRecord) {
        await deleteRecord('schedules', deletingSchedule.id);
      }

      showSnackbar('Report schedule deleted successfully', 'success');
      onSuccess?.();
      onDismiss();
    } catch (error: any) {
      console.error('Error deleting report schedule:', error);
      showSnackbar('Failed to delete report schedule', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Delete Report Schedule"
      subtitle="View property reports"
      actions={[
        {
          label: 'Cancel',
          mode: 'outlined',
          onPress: onDismiss,
        },
        {
          label: 'Delete',
          mode: 'contained',
          onPress: handleDeleteSchedule,
          loading: saving,
          buttonColor: colors.error,
          textColor: 'white',
          icon: 'delete',
        },
      ]}
    >
      <Text variant="bodyMedium">
        Are you sure you want to delete the &quot;
        {deletingSchedule?.schedule_type}&quot; report schedule?
      </Text>
      <Text variant="bodySmall" style={[styles.warningText, { color: colors.error }]}>
        This action cannot be undone.
      </Text>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  warningText: {
    fontStyle: 'italic',
    marginTop: 8,
  },
});
