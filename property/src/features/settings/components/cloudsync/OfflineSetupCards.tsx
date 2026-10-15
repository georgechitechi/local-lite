import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface OfflineSetupCardsProps {
  pat: string | null;
  onStartPatOnboarding: () => void;
  onStartManualConnection: () => void;
  onOpenStepOneModal: () => void;
}

export const OfflineSetupCards: React.FC<OfflineSetupCardsProps> = ({
  pat,
  onStartPatOnboarding,
  onStartManualConnection,
  onOpenStepOneModal,
}) => {
  const colors = useThemeColors();

  return (
    <View style={styles.formContainer}>
      <Text variant="bodyMedium" style={{ marginBottom: 16 }}>
        Bring your own database. Enter your App Key to enable cloud backups and
        multi-device sync.
      </Text>

      <View style={[styles.infoBox, { backgroundColor: colors.surfaceVariant }]}>
        <View style={{ flex: 1, gap: 12 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text variant="titleSmall" style={{ color: colors.primary, marginBottom: 0 }}>
              Connect Database
            </Text>
          </View>

          <TouchableRipple
            onPress={onStartPatOnboarding}
            style={{
              backgroundColor: colors.primaryContainer,
              borderRadius: 12,
              padding: 16,
              borderWidth: 1,
              borderColor: colors.primary,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 8,
                  padding: 8,
                }}
              >
                <Icon source="key" size={24} color={colors.onPrimary} />
              </View>
              <View style={{ marginLeft: 16, flex: 1 }}>
                <Text
                  variant="titleMedium"
                  style={{
                    color: colors.onPrimaryContainer,
                    fontWeight: 'bold',
                  }}
                >
                  Personal Access Token
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: colors.onPrimaryContainer, marginTop: 2 }}
                >
                  {pat
                    ? 'Your PAT is securely saved in your local store.'
                    : 'Please enter a valid Personal Access Token'}
                </Text>
              </View>
            </View>
          </TouchableRipple>

          <TouchableRipple
            onPress={onStartManualConnection}
            style={{
              backgroundColor: colors.surfaceVariant,
              borderRadius: 12,
              padding: 16,
              borderWidth: 1,
              borderColor: colors.secondary,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 8,
                  padding: 8,
                }}
              >
                <Icon
                  source="text-box-outline"
                  size={24}
                  color={colors.onSurfaceVariant}
                />
              </View>
              <View style={{ marginLeft: 16, flex: 1 }}>
                <Text
                  variant="titleMedium"
                  style={{
                    color: colors.onSurfaceVariant,
                    fontWeight: 'bold',
                  }}
                >
                  Manual App Key
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: colors.onSurfaceVariant, marginTop: 2 }}
                >
                  For advanced users. Manually enter your connection keys.
                </Text>
              </View>
            </View>
          </TouchableRipple>
        </View>
      </View>

      <View style={{ marginTop: 12 }}>
        <Button
          mode="outlined"
          icon="help-circle-outline"
          onPress={onOpenStepOneModal}
          style={{ width: '100%', borderColor: colors.outlineVariant }}
        >
          Need a Supabase project?
        </Button>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  formContainer: {
    marginTop: 16,
  },
  infoBox: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
});
