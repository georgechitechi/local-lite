import type React from 'react';
import { HelperText } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';

interface ConfirmDeployModalProps {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}

export const ConfirmDeployModal: React.FC<ConfirmDeployModalProps> = ({
  visible,
  onDismiss,
  onConfirm,
}) => {
  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      mode="confirm"
      destructive={true}
      icon="database-alert"
      title="Reset & Deploy Database?"
      message="This will completely wipe the current database schema on Supabase and deploy a fresh copy. All existing data in the cloud database will be permanently deleted!"
      confirmText="Yes, Deploy"
      onConfirm={onConfirm}
      onCancel={onDismiss}
    >
      <HelperText type="error" visible style={{ textAlign: 'center' }}>
        This action cannot be undone. Are you absolutely sure you want to proceed?
      </HelperText>
    </BaseModal>
  );
};
