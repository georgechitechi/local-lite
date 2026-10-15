import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import Constants from 'expo-constants';
import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface UpdatePromptProps {
  visible: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}

const appName = Constants.expoConfig?.name || 'this app';

export const UpdatePrompt: React.FC<UpdatePromptProps> = ({
  visible,
  onUpdate,
  onDismiss,
}) => {
  const colors = useThemeColors();

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Update Available"
      subtitle="Select date and time"
      showCloseButton={false}
      actions={[
        {
          label: 'Later',
          onPress: onDismiss,
          mode: 'outlined',
          icon: 'clock-outline',
          style: { flex: 1 },
        },
        {
          label: 'Update Now',
          onPress: onUpdate,
          mode: 'contained',
          icon: 'rocket-launch',
          style: { flex: 1 },
        },
      ]}
    >
      <View style={styles.content}>
        <View
          style={[styles.iconContainer, { backgroundColor: colors.primaryContainer }]}
        >
          <MaterialCommunityIcons name="rocket-launch" size={48} color={colors.primary} />
        </View>

        <Text variant="headlineSmall" style={styles.title}>
          New Version Ready!
        </Text>

        <Text
          variant="bodyLarge"
          style={[styles.message, { color: colors.onSurfaceVariant }]}
        >
          A fresh update for
          <Text style={{ color: colors.primary, fontWeight: 'bold' }}> {appName} </Text>
          is available with new features and improvements.
        </Text>

        <View style={[styles.infoBox, { backgroundColor: colors.surfaceVariant }]}>
          <MaterialCommunityIcons
            name="information-outline"
            size={20}
            color={colors.onSurfaceVariant}
          />
          <Text
            variant="bodyMedium"
            style={[styles.infoText, { color: colors.onSurfaceVariant }]}
          >
            The app will restart after the update.
          </Text>
        </View>

        <Text variant="bodyMedium" style={styles.question}>
          Would you like to update and restart now?
        </Text>
      </View>
    </BaseModal>
  );
};

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 24,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    width: '100%',
  },
  infoText: {
    marginLeft: 8,
    flex: 1,
  },
  question: {
    textAlign: 'center',
    fontWeight: '500',
  },
});
