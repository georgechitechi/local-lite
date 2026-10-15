import type React from 'react';
import { StyleSheet } from 'react-native';
import { HelperText, TextInput } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import ContactPicker from '@/shared/components/ContactPicker';
import type { ProjectUser } from './types';

interface EditUserProfileModalProps {
  user: ProjectUser | null;
  visible: boolean;
  displayName: string;
  email: string;
  phone: string;
  loading: boolean;
  onDisplayNameChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onSave: () => void;
  onDismiss: () => void;
}

export const EditUserProfileModal: React.FC<EditUserProfileModalProps> = ({
  user,
  visible,
  displayName,
  email,
  phone,
  loading,
  onDisplayNameChange,
  onEmailChange,
  onPhoneChange,
  onSave,
  onDismiss,
}) => {
  if (!user) return null;

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Edit User Profile"
      subtitle={user.email ?? ''}
      actions={[
        {
          label: 'Cancel',
          mode: 'outlined',
          onPress: onDismiss,
          style: { flex: 1 },
        },
        {
          label: 'Save',
          mode: 'contained',
          loading,
          onPress: onSave,
          style: { flex: 1 },
        },
      ]}
    >
      <TextInput
        label="Display Name"
        value={displayName}
        onChangeText={onDisplayNameChange}
        mode="outlined"
        style={styles.input}
        autoCapitalize="words"
        autoCorrect={false}
        placeholder="e.g. John Doe"
      />
      <TextInput
        label="Email Address"
        value={email}
        onChangeText={onEmailChange}
        mode="outlined"
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />
      <ContactPicker
        label="Phone Number"
        value={phone}
        onChangeText={onPhoneChange}
        containerStyle={{ marginBottom: 8 }}
      />
      <HelperText type="info">
        Changing the email will update the user's sign-in address project-wide.
      </HelperText>
    </BaseModal>
  );
};

const styles = StyleSheet.create({
  input: {
    marginBottom: 8,
  },
});
