import * as Clipboard from 'expo-clipboard';
import type React from 'react';
import { View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { decodeConnectionKey } from './types';

interface AppKeyModalProps {
  visible: boolean;
  onDismiss: () => void;
  appKeyString: string;
  supabaseUrl?: string;
}

export const AppKeyModal: React.FC<AppKeyModalProps> = ({
  visible,
  onDismiss,
  appKeyString,
  supabaseUrl,
}) => {
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();

  const connectedUrl = decodeConnectionKey(appKeyString).u || supabaseUrl || 'N/A';

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="App Key"
      subtitle="App Access Key, confidential"
      actions={[
        {
          label: 'Copy Key',
          mode: 'contained',
          icon: 'content-copy',
          onPress: async () => {
            if (appKeyString) {
              await Clipboard.setStringAsync(appKeyString);
              showSnackbar('App Key copied to clipboard!', 'success');
            }
          },
          style: { flex: 1 },
        },
        {
          label: 'Done',
          mode: 'outlined',
          onPress: onDismiss,
          style: { flex: 1 },
        },
      ]}
    >
      {appKeyString ? (
        <View
          style={{
            backgroundColor: colors.secondaryContainer,
            borderWidth: 1,
            borderColor: colors.outline,
            padding: 12,
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          <Text
            variant="labelMedium"
            style={{ color: colors.onSurfaceVariant, marginBottom: 2 }}
          >
            Connected Supabase URL:
          </Text>
          <Text
            variant="bodyMedium"
            selectable={true}
            style={{ fontWeight: 'bold', color: colors.primary }}
          >
            {connectedUrl}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          padding: 12,
          borderWidth: 1,
          borderColor: colors.outlineVariant,
          borderRadius: 4,
          backgroundColor: colors.surfaceVariant,
        }}
      >
        <Text
          selectable={true}
          style={{ userSelect: 'auto', color: colors.onSurfaceVariant }}
        >
          {appKeyString}
        </Text>
      </View>
      <HelperText type="info">Long press the text above to copy it.</HelperText>
      <HelperText type="error" visible={true} style={{ marginTop: 8 }}>
        ⚠️ WARNING: This key contains highly sensitive database credentials. Do not share
        it with anyone or post it publicly.
      </HelperText>
    </BaseModal>
  );
};
