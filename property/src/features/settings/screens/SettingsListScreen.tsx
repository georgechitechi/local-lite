const setContractSettingsModalVisible = (
  value: UIState['contractSettingsModalVisible'],
) => setUIField('contractSettingsModalVisible', value);
const setExpensesListModalVisible = (value: UIState['expensesListModalVisible']) =>
  setUIField('expensesListModalVisible', value);

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useMemo, useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  Avatar,
  Divider,
  IconButton,
  List as PaperList,
  Portal,
  Switch,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import BusinessLinksModal, {
  type BusinessLinks,
} from '@/features/settings/components/BusinessLinksModal';
import BusinessSelectModal from '@/features/settings/components/BusinessSelectModal';
import ContactSyncModals from '@/features/settings/components/ContactSyncModals';
import DashboardCustomizationModal from '@/features/settings/components/DashboardCustomizationModal';
import HelpModal from '@/features/settings/components/HelpModal';
import ResetDataModal from '@/features/settings/components/ResetDataModal';
import SupportModal from '@/features/settings/components/SupportModal';
import ThemeModal from '@/features/settings/components/ThemeModal';
import { useContactSync } from '@/features/settings/hooks/useContactSync';
import { useSettingsModals } from '@/features/settings/hooks/useSettingsModals';
import UtilityManagementModal from '@/features/utilities/components/UtilityManagementModal';
import { useAuth } from '@/providers/AuthProvider';
import { useBiometric } from '@/providers/BiometricAuthProvider';
import { useIdleLock } from '@/providers/LockScreenProvider';
import BaseModal from '@/shared/components/BaseModal';
import { useOfflineImageSync } from '@/shared/components/CachedImage';
import LoadingCard from '@/shared/components/LoadingCard';
import SPressable from '@/shared/components/SlightPressable';
import { UpdatePrompt } from '@/shared/components/UpdatePrompt';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import {
  useContracts,
  useCoreMutations,
  useHouses,
  useProfile,
  useProperties,
  useSettings,
  useStoreRefresh,
  useTenants,
} from '@/shared/hooks/useStore';
import { useTheme, useThemeColors } from '@/shared/hooks/useThemeProvider';
import { ensureUserProfile, OFFLINE_USER_ID } from '@/shared/services/auth';
import {
  requestLocalNotificationPermissions,
  sendNotification,
} from '@/shared/services/notifications';
import { generateUUID } from '@/shared/utils/helper';
import { safeReloadApp } from '@/shared/utils/safeReload';
import { clearAllPersistence } from '@/stores/syncHelper';
import { setUIField, type UIState } from '@/stores/uiStore';

const isEASBuild = Constants.expoConfig?.extra?.isEASBuild === true;

const List = {
  ...PaperList,
  Item: (props: React.ComponentProps<typeof PaperList.Item>) => {
    const { onPress, onLongPress, ...rest } = props;

    if (onPress || onLongPress) {
      return (
        <SPressable onPress={onPress} onLongPress={onLongPress}>
          <View pointerEvents="none">
            <PaperList.Item
              {...rest}
              rippleColor="transparent"
              style={[{ paddingVertical: 2, minHeight: 75 }, props.style]}
            />
          </View>
        </SPressable>
      );
    }

    return (
      <PaperList.Item
        {...rest}
        style={[{ paddingVertical: 2, minHeight: 75 }, props.style]}
      />
    );
  },
  Accordion: (props: React.ComponentProps<typeof PaperList.Accordion>) => (
    <PaperList.Accordion {...props} rippleColor="transparent" />
  ),
  Section: (props: React.ComponentProps<typeof PaperList.Section>) => (
    <PaperList.Section {...props} style={[{ marginBottom: 0 }, props.style]} />
  ),
  Subheader: (props: React.ComponentProps<typeof PaperList.Subheader>) => (
    <PaperList.Subheader
      {...props}
      style={[{ paddingTop: 8, paddingBottom: 0 }, props.style]}
    />
  ),
} as typeof PaperList;

interface HouseType {
  id: string;
  value: string;
  label: string;
  amenities: string[];
  active: boolean;
}

interface Amenity {
  id: string;
  label: string;
  value: string;
  active: boolean;
}

interface DashboardPreferences {
  show_insights: boolean;
  show_pending_rent: boolean;
  show_recent_activity: boolean;
  show_waivers: boolean;
  show_expiring_contracts: boolean;
  show_maintenance: boolean;
  show_daily_finance: boolean;
  show_expenses_analysis: boolean;
}

interface Settings {
  house_types: HouseType[];
  amenities: Amenity[];
  notification_settings: {
    enabled: boolean;
  };
  dashboard_preferences: DashboardPreferences;
  payment_methods: any[];
  [key: string]: any;
}

export default function SettingsManager() {
  const { isSyncActive: isCloudSyncEnabled } = useLocalSync();
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  const { confirmSignOut, user: authUser } = useAuth();
  const { selectedBusiness, requireBusiness } = useBusiness();
  const { isAdmin, isTenant, isAdminOrStaff } = useAccessControl();
  const { isDarkMode, themeMode, setThemeMode } = useTheme();
  const {
    isBiometricSupported,
    isBiometricEnabled,
    biometricType,
    enableBiometric,
    disableBiometric,
  } = useBiometric();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();

  const {
    currentModal,
    setCurrentModal,
    showBusinessModal,
    setShowBusinessModal,
    showHelpModal,
    setShowHelpModal,
    showUtilityModal,
    setShowUtilityModal,
    resetAllDataDialogVisible,
    setResetAllDataDialogVisible,
    showThemeModal,
    setShowThemeModal,
    showUpdatePrompt,
    setShowUpdatePrompt,
    showSupportModal,
    setShowSupportModal,
    showDashboardModal,
    setShowDashboardModal,
  } = useSettingsModals();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const tenants = useTenants(selectedBusiness?.id);
  const contracts = useContracts(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const properties = useProperties(selectedBusiness?.id);
  const allSettings = useSettings(selectedBusiness?.id);
  const { insert, update } = useCoreMutations();
  const { refreshing, onRefresh } = useStoreRefresh();

  const contactSync = useContactSync({
    selectedBusiness,
    tenants,
    contracts,
    houses,
    properties,
    pauseAutoLock,
    resumeAutoLock,
    setSaving,
    showSnackbar,
  });

  // Network status check with Snackbar
  const { isOnline } = useOfflineCheck();

  // Current user
  const userId = authUser?.id || null;

  useEffect(() => {
    if (authUser) {
      // Ensure profile exists in database without blocking the UI
      ensureUserProfile(authUser).catch(error => {
        console.error('Error ensuring user profile:', error);
      });
    }
    setLoading(false);
  }, [authUser]);

  // Compute profile data from store
  const userProfile = useProfile(userId);

  // Offline image sync for avatar
  const { localUri: avatarUri } = useOfflineImageSync(
    userProfile?.avatar_url || undefined,
  );

  // Compute settings from SQLite (memoized from useSettings live query)
  const settings = useMemo(() => {
    const s: Settings = {
      house_types: [],
      amenities: [],
      notification_settings: {
        enabled: false,
      },
      dashboard_preferences: {
        show_insights: true,
        show_pending_rent: true,
        show_recent_activity: true,
        show_waivers: true,
        show_expiring_contracts: true,
        show_maintenance: true,
        show_daily_finance: true,
        show_expenses_analysis: true,
      },
      payment_methods: [],
    };

    allSettings.forEach((setting: any) => {
      let val = setting.setting_value;
      if (typeof val === 'string') {
        try {
          val = JSON.parse(val);
        } catch {
          // keep as string
        }
      }
      s[setting.setting_key] = val;
    });

    return s;
  }, [allSettings]);

  // Form States
  const [links, setLinks] = useState<BusinessLinks>({
    whatsapp_group: '',
    website: '',
    facebook: '',
    instagram: '',
    twitter: '',
  });

  // UI state
  const [processingReset, setProcessingReset] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [successReloadData, setSuccessReloadData] = useState<{
    title: string;
    message: string;
  } | null>(null);

  // Add this state at the top
  // House type error state removed

  useEffect(() => {
    if (requireBusiness() && selectedBusiness?.id) {
      const linksData = (settings?.links as any) || {};
      setLinks({
        whatsapp_group: linksData.whatsapp_group || '',
        website: linksData.website || '',
        facebook: linksData.facebook || '',
        instagram: linksData.instagram || '',
        twitter: linksData.twitter || '',
      });
    }
  }, [selectedBusiness, requireBusiness, settings?.links]);

  const handleSaveLinks = async () => {
    try {
      setSaving(true);
      if (!selectedBusiness?.id || !userId) return;

      const existingLinksSetting = allSettings.find(
        (s: any) => s.setting_key === 'links',
      );

      if (existingLinksSetting) {
        await update('settings', existingLinksSetting.id, {
          setting_value: links as any,
        });
      } else {
        const newId = generateUUID();
        await insert('settings', {
          id: newId,
          business_id: selectedBusiness.id,
          user_id: userId,
          setting_key: 'links',
          setting_value: links as any,
        });
      }

      showSnackbar('Links updated successfully!', 'success');
      setCurrentModal(null);
    } catch (error: any) {
      console.error('Error saving links:', error);
      showSnackbar('Failed to save links', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async (settingKey: string, value: any) => {
    if (!selectedBusiness?.id || !userId) return;

    try {
      setSaving(true);

      const existingSetting = allSettings.find(s => s.setting_key === settingKey);

      if (existingSetting) {
        await update('settings', existingSetting.id, {
          setting_value: value,
        });
      } else {
        const newId = generateUUID();
        await insert('settings', {
          id: newId,
          business_id: selectedBusiness.id,
          user_id: userId,
          setting_key: settingKey,
          setting_value: value,
        });
      }
    } catch (error: any) {
      console.error('Error saving settings:', error);
      showSnackbar('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  // House Types and Amenities handlers removed

  const renderModal = () => {
    switch (currentModal) {
      default:
        return null;
    }
  };

  const handleNotificationToggle = async (value: boolean) => {
    if (!authUser || !selectedBusiness?.id) return;

    try {
      if (value) {
        const granted = await requestLocalNotificationPermissions();
        if (!granted) {
          showSnackbar('Notification permissions were not granted.', 'error');
          return;
        }
      }

      const newSettings = {
        ...settings.notification_settings,
        enabled: value,
      };
      await saveSettings('notification_settings', newSettings);
    } catch (error) {
      console.error('Error toggling notifications:', error);
      showSnackbar('Failed to update notification settings', 'error');
    }
  };

  const handleBiometricToggle = async (value: boolean) => {
    if (Platform.OS === 'web') {
      showSnackbar('Biometric authentication is not available on web.', 'info');
      return;
    }

    if (value) {
      // Enable biometric authentication
      const result = await enableBiometric();
      if (result.success) {
        showSnackbar(
          `${biometricType || 'Biometric'} authentication enabled successfully!`,
          'success',
        );
        sendNotification(
          'Biometric Login Update',
          'Biometric authentication has been enabled.',
          { type: 'biometric_login' },
        );
      } else {
        showSnackbar(
          result.error || 'Failed to enable biometric authentication.',
          'error',
        );
      }
    } else {
      // Disable biometric authentication
      const result = await disableBiometric();
      if (result.success) {
        showSnackbar('Biometric authentication disabled.', 'success');
        sendNotification(
          'Biometric Login Update',
          'Biometric authentication has been disabled.',
          { type: 'biometric_login' },
        );
      } else {
        showSnackbar(
          result.error || 'Failed to disable biometric authentication.',
          'error',
        );
      }
    }
  };

  const handleContactSupport = () => {
    setShowSupportModal(true);
  };

  const handleResetAllData = () => {
    setResetAllDataDialogVisible(true);
  };

  const confirmResetAllData = async () => {
    try {
      setProcessingReset(true);
      await clearAllPersistence({ reload: false });

      setSuccessReloadData({
        title: 'Success',
        message: 'Local data cleared. The app will now restart to re-sync.',
      });
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to clear local data', 'error');
    } finally {
      setProcessingReset(false);
      setResetAllDataDialogVisible(false);
    }
  };

  const handleCheckForUpdates = async () => {
    if (Platform.OS === 'web') {
      showSnackbar('Over-the-air updates are not supported on web.', 'info');
      return;
    }

    if (__DEV__) {
      showSnackbar(
        'Over-the-air updates cannot be tested in development builds.',
        'info',
      );
      return;
    }

    try {
      setCheckingUpdate(true);
      const update = await Updates.checkForUpdateAsync();

      if (update.isAvailable) {
        setShowUpdatePrompt(true);
      } else {
        showSnackbar('You are already running the latest version of the app.', 'success');
      }
    } catch (error: any) {
      console.error('Update check error:', error);
      showSnackbar(
        'Could not check for updates. ' +
          (error.message || 'Make sure you are connected to the internet.'),
        'error',
      );
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handlePerformUpdate = async () => {
    try {
      setShowUpdatePrompt(false);
      setCheckingUpdate(true);
      await Updates.fetchUpdateAsync();
      setSuccessReloadData({
        title: 'Update Ready',
        message: 'The update has been downloaded. The app will now restart to apply it.',
      });
    } catch (e: any) {
      showSnackbar(`Failed to download update: ${e.message}`, 'error');
    } finally {
      setCheckingUpdate(false);
    }
  };

  if (loading) {
    return <LoadingCard iconName="cog" text="Loading settings..." />;
  }

  return (
    <>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <List.Section>
          <List.Subheader>Business Profile</List.Subheader>
          {selectedBusiness ? (
            <List.Item
              title={selectedBusiness.name}
              description={selectedBusiness.email}
              left={props => <List.Icon {...props} icon="office-building" />}
              right={props => <IconButton {...props} icon="chevron-right" />}
              onPress={() =>
                router.push({
                  pathname: '/businesses/view/[id]',
                  params: {
                    id: selectedBusiness.id,
                  },
                })
              }
            />
          ) : (
            <List.Item
              title="No Business Selected"
              description="Please select a business to continue"
              left={props => <List.Icon {...props} icon="information" />}
              titleStyle={{ color: colors.error }}
              descriptionStyle={{ color: colors.error }}
              right={props => <IconButton {...props} icon="chevron-right" />}
              onPress={() => setShowBusinessModal(true)}
            />
          )}
        </List.Section>

        <Divider />

        <List.Section>
          {!isCloudSyncEnabled || authUser?.id === OFFLINE_USER_ID ? (
            <>
              <List.Subheader>Cloud Sync</List.Subheader>
              <List.Item
                title="Cloud Sync Configuration"
                description="Manage your custom Supabase sync settings"
                left={props => <List.Icon {...props} icon="cloud-sync" />}
                right={props => <IconButton {...props} icon="chevron-right" />}
                onPress={() => router.push('/settings/cloud-sync' as any)}
              />
            </>
          ) : (
            <>
              <List.Subheader>User Profile</List.Subheader>
              {authUser ? (
                <>
                  <List.Item
                    title={
                      userProfile?.name ||
                      authUser?.email?.split('@')[0] ||
                      'User Profile'
                    }
                    titleStyle={
                      !userProfile?.name ? { color: colors.onSurfaceVariant } : {}
                    }
                    description={authUser.email}
                    left={props =>
                      userProfile?.avatar_url ? (
                        <Avatar.Image
                          size={50}
                          source={{ uri: avatarUri || userProfile.avatar_url }}
                          style={{ marginLeft: 10 }}
                        />
                      ) : (
                        <List.Icon {...props} icon="account" />
                      )
                    }
                    right={props => <IconButton {...props} icon="chevron-right" />}
                    onPress={() => router.push('/settings/profile')}
                  />
                  <List.Item
                    title="Sign Out"
                    description="Sign out of application"
                    left={props => (
                      <List.Icon {...props} icon="logout" color={colors.error} />
                    )}
                    onPress={confirmSignOut}
                    titleStyle={{ color: colors.error }}
                    descriptionStyle={{ color: colors.error }}
                    right={props => <IconButton {...props} icon="chevron-right" />}
                  />
                </>
              ) : (
                <List.Item
                  title="Loading User Data"
                  description="Please wait..."
                  left={props => <List.Icon {...props} icon="account" />}
                />
              )}
              <Divider style={{ marginVertical: 8 }} />
              <List.Item
                title="Cloud Sync Configuration"
                description="Manage your custom Supabase sync settings"
                left={props => <List.Icon {...props} icon="cloud-sync" />}
                right={props => <IconButton {...props} icon="chevron-right" />}
                onPress={() => router.push('/settings/cloud-sync' as any)}
              />
            </>
          )}
        </List.Section>

        <Divider />

        {(isAdmin || isTenant) && (
          <>
            <List.Section>
              <List.Subheader>Financial Settings</List.Subheader>
              {isAdmin && (
                <>
                  <List.Item
                    title="Payment Methods"
                    description="Manage supported payment methods"
                    left={props => <List.Icon {...props} icon="credit-card-outline" />}
                    onPress={() => router.push('/settings/payments')}
                    right={props => <IconButton {...props} icon="chevron-right" />}
                  />
                  <List.Item
                    title="Business Expenses"
                    description="Monitor and manage business expenses"
                    left={props => <List.Icon {...props} icon="cash" />}
                    onPress={() => setExpensesListModalVisible(true)}
                    right={props => <IconButton {...props} icon="chevron-right" />}
                  />
                  <List.Item
                    title="Contract Settings"
                    description="Configure contract defaults and templates"
                    left={props => (
                      <List.Icon {...props} icon="file-document-edit-outline" />
                    )}
                    onPress={() => setContractSettingsModalVisible(true)}
                    right={props => <IconButton {...props} icon="chevron-right" />}
                  />
                  <List.Item
                    title="Business Promotions"
                    description="Manage business promotions"
                    left={props => <List.Icon {...props} icon="ticket-percent" />}
                    onPress={() => router.push('/settings/promotions')}
                    right={props => <IconButton {...props} icon="chevron-right" />}
                  />
                  <List.Item
                    title="Holiday Waivers"
                    description="Manage tenants' holiday waivers"
                    left={props => <List.Icon {...props} icon="calendar-clock" />}
                    onPress={() => router.push('/settings/holidays')}
                    right={props => <IconButton {...props} icon="chevron-right" />}
                  />
                </>
              )}
              <List.Item
                title="Transactions"
                description={
                  isTenant
                    ? 'View your payment transactions'
                    : 'View all payment transactions'
                }
                left={props => <List.Icon {...props} icon="swap-horizontal" />}
                onPress={() => router.push('/settings/transactions')}
                right={props => <IconButton {...props} icon="chevron-right" />}
              />
            </List.Section>

            {isAdmin && (
              <>
                <Divider />

                <List.Section>
                  <List.Subheader>Utility Settings</List.Subheader>
                  <List.Item
                    title="Utility Meters"
                    description="Manage electricity, water and other meters"
                    left={props => <List.Icon {...props} icon="meter-electric-outline" />}
                    onPress={() => setShowUtilityModal(true)}
                    right={props => <IconButton {...props} icon="chevron-right" />}
                  />
                  {isCloudSyncEnabled && authUser?.id !== OFFLINE_USER_ID && (
                    <List.Item
                      title="API Keys"
                      description="Manage business API keys and tokens"
                      left={props => <List.Icon {...props} icon="key-variant" />}
                      onPress={() => router.push('/settings/api-keys')}
                      right={props => <IconButton {...props} icon="chevron-right" />}
                    />
                  )}
                </List.Section>

                <Divider />

                <List.Section>
                  <List.Subheader>Business Links & Booking Requests</List.Subheader>
                  <List.Item
                    title="Property Configurations"
                    description="Manage house types and amenities"
                    left={props => <List.Icon {...props} icon="cogs" />}
                    onPress={() => router.push('/settings/configurations')}
                    right={props => <IconButton {...props} icon="chevron-right" />}
                  />
                  <List.Item
                    title="Business Links"
                    description="Manage WhatsApp groups, social media, and other links"
                    left={props => <List.Icon {...props} icon="link-variant" />}
                    onPress={() => setCurrentModal('links')}
                    right={props => <IconButton {...props} icon="chevron-right" />}
                  />
                  <List.Item
                    title="Maintenance"
                    description="Manage maintenance requests"
                    left={props => <List.Icon {...props} icon="wrench" />}
                    onPress={() => router.push('/maintenance')}
                    right={props => <IconButton {...props} icon="chevron-right" />}
                  />
                </List.Section>
              </>
            )}
          </>
        )}

        <Divider />

        {isAdminOrStaff && (
          <List.Section>
            <List.Subheader>Data Management</List.Subheader>
            <List.Item
              title="Reports & Analytics"
              description="Generate and view analytics reports"
              left={props => <List.Icon {...props} icon="chart-box" />}
              onPress={() => router.push('/reports')}
              right={props => <IconButton {...props} icon="chevron-right" />}
            />
            {isAdmin && (
              <>
                <List.Item
                  title="Manage Contacts"
                  description="Export or sync tenant contacts"
                  left={props => <List.Icon {...props} icon="contacts" />}
                  right={props =>
                    saving ? (
                      <List.Icon {...props} icon="loading" />
                    ) : (
                      <IconButton {...props} icon="chevron-right" />
                    )
                  }
                  onPress={() => contactSync.setContactOptionsModalVisible(true)}
                  disabled={saving}
                />
                <List.Item
                  title="Backup & Restore"
                  description="Create or restore data backups"
                  left={props => <List.Icon {...props} icon="database-sync" />}
                  onPress={() => router.push('/backup' as any)}
                />
                {isCloudSyncEnabled && authUser?.id !== OFFLINE_USER_ID && (
                  <List.Item
                    title="Schedule Management"
                    description="Manage automated tasks and schedules"
                    left={props => <List.Icon {...props} icon="clock-outline" />}
                    onPress={() => router.push('/settings/schedules')}
                  />
                )}
                <List.Item
                  title="Data Integrity Checks"
                  description="Run checks to ensure data accuracy"
                  left={props => <List.Icon {...props} icon="shield-check" />}
                  onPress={() => router.push('/settings/data-integrity' as any)}
                  right={props => <IconButton {...props} icon="chevron-right" />}
                />
              </>
            )}
          </List.Section>
        )}
        <Divider />

        <List.Section>
          {isAdmin && (
            <>
              <List.Subheader>Application Settings</List.Subheader>
              <List.Item
                title="Business Currency"
                description="Set default currency"
                left={props => <List.Icon {...props} icon="cash-multiple" />}
                right={props => <IconButton {...props} icon="chevron-right" />}
                onPress={() => {
                  setCurrentModal(null);
                  router.push('/settings/currency');
                }}
              />
              <List.Item
                title="Reminders & Notifications"
                description="Set or send reminders to tenants"
                left={props => <List.Icon {...props} icon="bell-ring" />}
                onPress={() => router.push('/reminders')}
                right={props => <IconButton {...props} icon="chevron-right" />}
              />
            </>
          )}
          <List.Item
            title="Application Theme"
            description={
              themeMode === 'auto'
                ? `Auto (Currently ${isDarkMode ? 'Dark' : 'Light'})`
                : themeMode === 'dark'
                  ? 'Dark Mode'
                  : 'Light Mode'
            }
            left={props => <List.Icon {...props} icon="theme-light-dark" />}
            right={props => <IconButton {...props} icon="chevron-right" />}
            onPress={() => setShowThemeModal(true)}
          />
          <List.Item
            title="Biometric Authentication"
            description={
              isBiometricSupported
                ? isBiometricEnabled
                  ? `Enabled - Use ${biometricType || 'biometric'} to unlock`
                  : 'Disabled - Use password to login'
                : 'Not available on this device'
            }
            left={props => <List.Icon {...props} icon="fingerprint" />}
            right={() =>
              isBiometricSupported ? (
                <Switch
                  value={isBiometricEnabled}
                  onValueChange={handleBiometricToggle}
                />
              ) : null
            }
          />

          <List.Item
            title="Push Notifications"
            description="Receive push notifications on your device"
            left={props => <List.Icon {...props} icon="bell" />}
            right={() => (
              <Switch
                value={settings.notification_settings.enabled}
                onValueChange={handleNotificationToggle}
                disabled={!isOnline}
              />
            )}
          />
        </List.Section>

        <Divider />

        {isAdmin && (
          <List.Section>
            <List.Item
              title="Business Customizations"
              description="Manage visibility of dashboard cards and receipts"
              left={props => <List.Icon {...props} icon="view-dashboard-edit-outline" />}
              right={props => <IconButton {...props} icon="chevron-right" />}
              onPress={() => setShowDashboardModal(true)}
            />
          </List.Section>
        )}

        <Divider />

        <List.Section>
          <List.Subheader>System</List.Subheader>
          <List.Item
            title={`About ${Constants.expoConfig?.name || 'Property Admin'}`}
            description="App information, support, and system details"
            left={props => <List.Icon {...props} icon="information-outline" />}
            right={props => <IconButton {...props} icon="chevron-right" />}
            onPress={() => setShowHelpModal(true)}
          />
        </List.Section>
      </ScrollView>
      {renderModal()}

      <UtilityManagementModal
        visible={showUtilityModal}
        onDismiss={() => setShowUtilityModal(false)}
      />

      {/* Theme Selection Modal */}
      <ThemeModal
        visible={showThemeModal}
        onDismiss={() => setShowThemeModal(false)}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        colors={colors}
      />
      <HelpModal
        visible={showHelpModal}
        onDismiss={() => setShowHelpModal(false)}
        colors={colors}
        handleContactSupport={handleContactSupport}
        isEASBuild={isEASBuild}
        checkingUpdate={checkingUpdate}
        handleCheckForUpdates={handleCheckForUpdates}
        handleResetAllData={handleResetAllData}
      />
      {/* Reset All Data Confirmation Modal */}
      <ResetDataModal
        visible={resetAllDataDialogVisible}
        onDismiss={() => setResetAllDataDialogVisible(false)}
        onConfirm={confirmResetAllData}
        processing={processingReset}
        colors={colors}
      />
      <Portal>
        <BusinessLinksModal
          visible={currentModal === 'links'}
          onDismiss={() => setCurrentModal(null)}
          links={links}
          setLinks={setLinks}
          onSave={handleSaveLinks}
          saving={saving}
          colors={colors}
          showSnackbar={showSnackbar}
        />
        {/* Dashboard Customization Modal */}
        <DashboardCustomizationModal
          visible={showDashboardModal}
          onDismiss={() => setShowDashboardModal(false)}
          settings={settings}
          saveSettings={saveSettings}
        />
      </Portal>
      <ContactSyncModals {...contactSync} colors={colors} />
      <BusinessSelectModal
        visible={showBusinessModal}
        onDismiss={() => setShowBusinessModal(false)}
      />
      <UpdatePrompt
        visible={showUpdatePrompt}
        onUpdate={handlePerformUpdate}
        onDismiss={() => setShowUpdatePrompt(false)}
      />
      <SupportModal
        visible={showSupportModal}
        onDismiss={() => setShowSupportModal(false)}
        selectedBusiness={selectedBusiness}
        colors={colors}
      />
      {/* Success Reload Modal */}
      <BaseModal
        visible={!!successReloadData}
        onDismiss={() => {}}
        title={successReloadData?.title || 'Success'}
        message={successReloadData?.message}
        mode="info"
        confirmText="OK"
        onConfirm={async () => {
          setSuccessReloadData(null);
          await safeReloadApp();
          router.replace('/(auth)/login');
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
