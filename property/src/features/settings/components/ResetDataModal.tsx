import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';

interface ResetDataModalProps {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
  processing: boolean;
  colors: any;
}

export default function ResetDataModal({
  visible,
  onDismiss,
  onConfirm,
  processing,
  colors,
}: ResetDataModalProps) {
  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Reset All Data"
      subtitle="Clear all local data and re-sync"
      zIndex={10000}
      maxHeight="60%"
      actions={[
        {
          label: 'Cancel',
          onPress: onDismiss,
          mode: 'outlined',
        },
        {
          label: 'Reset Data',
          onPress: onConfirm,
          mode: 'contained',
          buttonColor: colors.error,
          textColor: 'white',
          loading: processing,
          disabled: processing,
        },
      ]}
    >
      <View style={{ alignItems: 'center' }}>
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={48}
          color={colors.error}
          style={{ marginBottom: 16 }}
        />
        <Text variant="bodyMedium" style={{ textAlign: 'center', marginBottom: 16 }}>
          This will clear all local data and fetch fresh data from the server.
        </Text>
        <Text
          variant="bodyMedium"
          style={{
            textAlign: 'center',
            fontWeight: 'bold',
            color: colors.error,
          }}
        >
          Any unsaved local changes that have not yet synced will be lost.
        </Text>
      </View>
    </BaseModal>
  );
}
