import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import BusinessSelectModal from '@/features/settings/components/BusinessSelectModal';
import EmptyState from '@/shared/components/EmptyState';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useTheme, useThemeColors } from '@/shared/hooks/useThemeProvider';

export const WelcomeDashboard = () => {
  const [showBusinessSelect, setShowBusinessSelect] = useState(false);
  const { isSyncActive } = useLocalSync();
  const colors = useThemeColors();
  const { isDarkMode } = useTheme();
  const isDark = isDarkMode || false;
  const router = useRouter();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ flexGrow: 1, flex: undefined }}
    >
      <EmptyState
        icon="domain"
        title="Select business to proceed"
        description="Choose a business or create one to manage your properties and tenants."
        style={{
          padding: 24,
          justifyContent: 'center',
          alignItems: 'center',
          flex: 1,
        }}
      >
        <Button
          mode="contained"
          onPress={() => setShowBusinessSelect(true)}
          style={{ width: '100%' }}
          icon="select-all"
        >
          Select Business
        </Button>
      </EmptyState>

      {!isSyncActive && (
        <Surface
          elevation={1}
          style={{
            marginHorizontal: 16,
            marginBottom: 16,
            borderRadius: 16,
            padding: 16,
            backgroundColor: colors.surface,
            ...(isDark && { borderColor: colors.outlineVariant, borderWidth: 1 }),
          }}
        >
          <Text
            variant="titleMedium"
            style={{
              color: colors.onSurface,
              fontWeight: 'bold',
              marginBottom: 16,
              textAlign: 'center',
            }}
          >
            Unlock the full potential 🚀
          </Text>

          <View style={{ gap: 16, marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  backgroundColor: colors.primaryContainer,
                  padding: 8,
                  borderRadius: 20,
                }}
              >
                <MaterialCommunityIcons
                  name="shield-check"
                  size={20}
                  color={colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  variant="bodyMedium"
                  style={{ color: colors.onSurface, fontWeight: 'bold' }}
                >
                  Secure Auto-Backups
                </Text>
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  Your data is always safe, even if you lose your phone
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  backgroundColor: colors.secondaryContainer,
                  padding: 8,
                  borderRadius: 20,
                }}
              >
                <MaterialCommunityIcons
                  name="devices"
                  size={20}
                  color={colors.secondary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  variant="bodyMedium"
                  style={{ color: colors.onSurface, fontWeight: 'bold' }}
                >
                  Multi-Device Access
                </Text>
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  Sync seamlessly across all your devices instantly
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  backgroundColor: colors.surfaceVariant,
                  padding: 8,
                  borderRadius: 20,
                }}
              >
                <MaterialCommunityIcons
                  name="account-group"
                  size={20}
                  color={colors.onSurfaceVariant}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  variant="bodyMedium"
                  style={{ color: colors.onSurface, fontWeight: 'bold' }}
                >
                  Team Collaboration
                </Text>
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  Invite staff and manage access permissions easily
                </Text>
              </View>
            </View>
          </View>

          <Button
            mode="contained"
            onPress={() => router.push('/settings/cloud-sync')}
            style={{ borderRadius: 8 }}
            buttonColor={colors.primary}
            icon={'cloud-sync'}
          >
            {'Go to Cloud Sync'}
          </Button>
        </Surface>
      )}
      <BusinessSelectModal
        visible={showBusinessSelect}
        onDismiss={() => setShowBusinessSelect(false)}
      />
    </ScrollView>
  );
};
