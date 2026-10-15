import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Button, Card, Divider, List, Text } from 'react-native-paper';
import GitHubDevUpdateModal from '@/features/settings/components/GitHubDevUpdateModal';
import BaseModal from '@/shared/components/BaseModal';
import { rateApp, shareApp } from '@/shared/utils/shareApp';

interface HelpModalProps {
  visible: boolean;
  onDismiss: () => void;
  colors: any;
  handleContactSupport: () => void;
  isEASBuild: boolean;
  checkingUpdate: boolean;
  handleCheckForUpdates: () => void;
  handleResetAllData: () => void;
}

export default function HelpModal({
  visible,
  onDismiss,
  colors,
  handleContactSupport,
  isEASBuild,
  checkingUpdate,
  handleCheckForUpdates,
  handleResetAllData,
}: HelpModalProps) {
  const router = useRouter();
  const [showGitHubDevModal, setShowGitHubDevModal] = useState(false);

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title={`About ${Constants.expoConfig?.name || 'Property Admin'}`}
      subtitle="App information, support, and system details"
      maxHeight="85%"
      scrollable
    >
      <View>
        {/* Quick Actions */}
        <Text variant="titleSmall" style={{ marginBottom: 4, fontWeight: '600' }}>
          Quick Actions
        </Text>

        <Card style={{ marginBottom: 12, backgroundColor: colors.surface }} elevation={1}>
          <List.Item
            title="Contact Support"
            description="Get help via Email or WhatsApp"
            left={props => <List.Icon {...props} icon="headset" color={colors.primary} />}
            right={props => <List.Icon {...props} icon="chevron-right" />}
            onPress={handleContactSupport}
            style={{ paddingVertical: 4 }}
          />
          <Divider style={{ opacity: 0.5 }} />
          <List.Item
            title="Rate App"
            description="Enjoying the app? Leave us a review!"
            left={props => (
              <List.Icon {...props} icon="star-outline" color={colors.primary} />
            )}
            right={props => <List.Icon {...props} icon="chevron-right" />}
            onPress={rateApp}
            style={{ paddingVertical: 4 }}
          />
          <Divider style={{ opacity: 0.5 }} />
          <List.Item
            title="Share App"
            description="Share store link with friends"
            left={props => (
              <List.Icon {...props} icon="share-variant-outline" color={colors.primary} />
            )}
            right={props => <List.Icon {...props} icon="chevron-right" />}
            onPress={shareApp}
            style={{ paddingVertical: 4 }}
          />
          <Divider style={{ opacity: 0.5 }} />
          <List.Item
            title="Documentation"
            description="Read our app documentation"
            left={props => (
              <List.Icon
                {...props}
                icon="book-open-page-variant"
                color={colors.primary}
              />
            )}
            right={props => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => {
              onDismiss();
              router.push('/settings/documentation');
            }}
            style={{ paddingVertical: 4 }}
          />
        </Card>

        <Text
          variant="titleSmall"
          style={{ marginTop: 0, marginBottom: 12, fontWeight: '600' }}
        >
          System Information
        </Text>

        <Card
          style={{ marginBottom: 8, backgroundColor: colors.surfaceVariant }}
          elevation={0}
        >
          <Card.Content style={{ paddingVertical: 8 }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                App Version
              </Text>
              <Text variant="bodyMedium" style={{ fontWeight: '600' }}>
                {Constants.expoConfig?.version || '1.0.0'}
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                Platform
              </Text>
              <Text variant="bodyMedium" style={{ fontWeight: '600' }}>
                {Platform.OS === 'ios' ? 'iOS' : 'Android'}
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                Device
              </Text>
              <Text variant="bodyMedium" style={{ fontWeight: '600' }}>
                {Device.modelName || 'Unknown'}
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
              }}
            >
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                OS Version
              </Text>
              <Text variant="bodyMedium" style={{ fontWeight: '600' }}>
                {Device.osVersion || 'Unknown'}
              </Text>
            </View>
          </Card.Content>
        </Card>

        {isEASBuild && (
          <Button
            mode="contained-tonal"
            onPress={handleCheckForUpdates}
            icon="update"
            loading={checkingUpdate}
            disabled={checkingUpdate}
            style={{ marginBottom: 12 }}
          >
            Check for Updates (OTA)
          </Button>
        )}

        {(__DEV__ || Constants.expoConfig?.extra?.variant === 'development') && (
          <Button
            mode="contained-tonal"
            onPress={() => setShowGitHubDevModal(true)}
            icon="github"
            style={{ marginBottom: 12 }}
          >
            Check GitHub Dev Releases
          </Button>
        )}

        <Button
          mode="outlined"
          onPress={handleResetAllData}
          textColor={colors.error}
          style={{ borderColor: colors.error }}
          icon="delete-sweep"
        >
          Reset All Data
        </Button>
      </View>

      <GitHubDevUpdateModal
        visible={showGitHubDevModal}
        onDismiss={() => setShowGitHubDevModal(false)}
        colors={colors}
      />
    </BaseModal>
  );
}
