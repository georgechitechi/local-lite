import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Linking, Platform, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import { properCase } from '@/shared/utils/helper';

interface SupportModalProps {
  visible: boolean;
  onDismiss: () => void;
  selectedBusiness: any;
  colors: any;
}

export default function SupportModal({
  visible,
  onDismiss,
  selectedBusiness,
  colors,
}: SupportModalProps) {
  const { showSnackbar } = useSnackbar();

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Contact Support"
      subtitle="Choose your preferred contact method"
      actions={[
        {
          label: 'WhatsApp',
          icon: 'whatsapp',
          mode: 'contained',
          onPress: () => {
            onDismiss();
            if (selectedBusiness?.phone) {
              const phone = selectedBusiness.phone.replace(/[^0-9]/g, '');
              const message = `Hello ${selectedBusiness?.name},\n\nI need support with Property Admin app.\n\nApp Version: ${Constants.expoConfig?.version || '1.0.0'}\nPlatform: ${properCase(Platform.OS)}.\nDevice: ${Device.modelName || 'Unknown'}.\n\nDescribe your issue:\n\n\nThank You`;
              Linking.openURL(
                `whatsapp://send?phone=${phone}&text=${encodeURIComponent(message)}`,
              );
            } else {
              showSnackbar(
                'Business phone number is not configured. Please use email instead.',
                'error',
              );
            }
          },
          style: { flex: 1 },
        },
        {
          label: 'Email',
          icon: 'email',
          mode: 'outlined',
          onPress: () => {
            onDismiss();
            const email = `${selectedBusiness?.email}`;
            const subject = 'Support Request';
            const body = `Hello ${selectedBusiness?.name},\n\nI need support with Property Admin app.\n\nApp Version: ${Constants.expoConfig?.version || '1.0.0'}\nPlatform: ${properCase(Platform.OS)}\nDevice: ${Device.modelName || 'Unknown'}\n\nDescribe your issue:\n\n\nThank You`;
            Linking.openURL(
              `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
            );
          },
          style: { flex: 1 },
        },
      ]}
    >
      <View>
        <Text
          variant="bodyMedium"
          style={{
            color: colors.onSurfaceVariant,
            lineHeight: 22,
            textAlign: 'center',
          }}
        >
          Have a question or running into an issue? Our support team is here to help you
          get the most out of {selectedBusiness?.name}.
        </Text>
        <Text
          variant="bodySmall"
          style={{
            color: colors.onSurfaceVariant,
            marginTop: 12,
            opacity: 0.8,
            textAlign: 'center',
          }}
        >
          Response times may vary, but we typically respond within 24 hours.
        </Text>
      </View>
    </BaseModal>
  );
}
