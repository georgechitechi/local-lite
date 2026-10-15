import type React from 'react';
import { Linking, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface StepOneModalProps {
  visible: boolean;
  onDismiss: () => void;
  onProceed: () => void;
}

export const StepOneModal: React.FC<StepOneModalProps> = ({
  visible,
  onDismiss,
  onProceed,
}) => {
  const colors = useThemeColors();

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Create Project"
      subtitle="Set up your Supabase project and PAT"
      maxHeight={'85%'}
      scrollable={true}
    >
      <View style={{ gap: 16 }}>
        <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
          Bring your own database. To connect cloud sync, follow these two quick setup
          steps on Supabase:
        </Text>

        <View
          style={{
            backgroundColor: colors.surfaceVariant,
            borderRadius: 12,
            padding: 16,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon source="numeric-1-circle" size={24} color={colors.primary} />
            <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
              Create a Supabase Project
            </Text>
          </View>
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            Create a new project on Supabase. Your database will be provisioned in about a
            minute.
          </Text>
          <Button
            mode="contained"
            icon="open-in-new"
            onPress={() => Linking.openURL('https://database.new')}
            style={{ marginTop: 4 }}
          >
            Create Project (database.new)
          </Button>
        </View>

        <View
          style={{
            backgroundColor: colors.surfaceVariant,
            borderRadius: 12,
            padding: 16,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon source="numeric-2-circle" size={24} color={colors.primary} />
            <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
              Generate a Personal Access Token (PAT)
            </Text>
          </View>
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            Generate a PAT from your Supabase account tokens page. This allows the app to
            configure and sync with your database automatically.
          </Text>
          <Button
            mode="outlined"
            icon="shield-key"
            onPress={() =>
              Linking.openURL('https://supabase.com/dashboard/account/tokens')
            }
            style={{ marginTop: 4 }}
          >
            Generate PAT
          </Button>
        </View>

        <View
          style={{
            backgroundColor: colors.primaryContainer,
            borderRadius: 12,
            padding: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Icon
            source="information-outline"
            size={24}
            color={colors.onPrimaryContainer}
          />
          <Text variant="bodySmall" style={{ color: colors.onPrimaryContainer, flex: 1 }}>
            Once your project and token are ready, proceed to connect your database.
          </Text>
        </View>

        <Button
          mode="contained"
          icon="arrow-right"
          contentStyle={{ flexDirection: 'row-reverse' }}
          onPress={() => {
            onDismiss();
            onProceed();
          }}
          style={{ marginTop: 4 }}
        >
          Proceed to connect database
        </Button>
      </View>
    </BaseModal>
  );
};
