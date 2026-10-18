const setContractSettingsModalVisible = (
  value: UIState['contractSettingsModalVisible'],
) => setUIField('contractSettingsModalVisible', value);
const setExpensesListModalVisible = (value: UIState['expensesListModalVisible']) =>
  setUIField('expensesListModalVisible', value);

import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Divider,
  HelperText,
  IconButton,
  List as PaperList,
  Portal,
  ProgressBar,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import BusinessSelectModal from '@/features/settings/components/BusinessSelectModal';
import DashboardCustomizationModal from '@/features/settings/components/DashboardCustomizationModal';
import HelpModal from '@/features/settings/components/HelpModal';
import ResetDataModal from '@/features/settings/components/ResetDataModal';
import SupportModal from '@/features/settings/components/SupportModal';
import ThemeModal from '@/features/settings/components/ThemeModal';
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
  directSyncContacts,
  type SyncProgressData,
} from '@/shared/services/contactsSync';
import {
  requestLocalNotificationPermissions,
  sendNotification,
} from '@/shared/services/notifications';
import { formatDateForDB } from '@/shared/utils/formatters';
import { generateUUID } from '@/shared/utils/helper';
import { safeReloadApp } from '@/shared/utils/safeReload';
import { isActiveTenantStatus } from '@/shared/utils/statusHelper';
import { exportAndDownloadTenantsVCF } from '@/shared/utils/vcfExport';
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

interface Links {
  whatsapp_group: string;
  website: string;
  facebook: string;
  instagram: string;
  twitter: string;
}

interface ExportResult {
  success: boolean;
  message?: string;
}

export default function SettingsManager() {
  const { isSyncActive: isCloudSyncEnabled } = useLocalSync();
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  const { confirmSignOut, user: authUser } = useAuth();
  const { selectedBusiness, requireBusiness } = useBusiness();
  const { hasAccess } = useAccessControl();
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
    syncModalVisible,
    setSyncModalVisible,
    exclusionModalVisible,
    setExclusionModalVisible,
    contactOptionsModalVisible,
    setContactOptionsModalVisible,
    exportModalVisible,
    setExportModalVisible,
    permissionModalVisible,
    setPermissionModalVisible,
  } = useSettingsModals();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncCompleted, setSyncCompleted] = useState(false);
  const [syncCancelled, setSyncCancelled] = useState(false);

  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgressData>({
    currentStep: 0,
    totalSteps: 0,
    currentTenant: '',
    stats: { created: 0, updated: 0, replaced: 0, duplicates: 0, errors: 0 },
    progress: 0,
  });

  const tenants = useTenants(selectedBusiness?.id);
  const contracts = useContracts(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const properties = useProperties(selectedBusiness?.id);
  const allSettings = useSettings(selectedBusiness?.id);
  const { insert, update } = useCoreMutations();
  const { refreshing, onRefresh } = useStoreRefresh();

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

  const [syncTenants, setSyncTenants] = useState<any[]>([]);
  const [syncSearchQuery, setSyncSearchQuery] = useState('');
  const [excludedTenantIds, setExcludedTenantIds] = useState<string[]>([]);
  const [contactActionType, setContactActionType] = useState<'sync' | 'export' | null>(
    null,
  );

  // Form States
  const [links, setLinks] = useState<Links>({
    whatsapp_group: '',
    website: '',
    facebook: '',
    instagram: '',
    twitter: '',
  });

  // UI state
  const [processingReset, setProcessingReset] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [permissionModalData, setPermissionModalData] = useState<{
    message: string;
    permanentlyDenied: boolean;
  } | null>(null);
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

  const handlePrepareContactSelection = (action: 'sync' | 'export') => {
    if (!selectedBusiness?.id) {
      showSnackbar('Please select a business first', 'error');
      return;
    }

    try {
      setContactActionType(action);
      // Use local local-lite data instead of Supabase query
      const filteredTenants = tenants
        .filter(t => isActiveTenantStatus(t.status))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      if (!filteredTenants || filteredTenants.length === 0) {
        showSnackbar('No active tenants found.', 'info');
        return;
      }

      setSyncTenants(filteredTenants);
      setSyncSearchQuery('');
      // Automatically exclude common names if found (optional, e.g. "Self")
      const autoExcluded = filteredTenants
        .filter(
          t =>
            t.name?.toLowerCase().includes('self') ||
            t.name?.toLowerCase().includes('admin'),
        )
        .map(t => t.id);
      setExcludedTenantIds(autoExcluded);

      setExclusionModalVisible(true);
    } catch (error: any) {
      console.error('Error preparing tenant selection:', error);
      showSnackbar('Failed to prepare tenant selection.', 'error');
    }
  };

  const handleExportContacts = () => handlePrepareContactSelection('export');
  const handleDirectSyncContacts = () => handlePrepareContactSelection('sync');

  const handleConfirmExport = async () => {
    if (!selectedBusiness?.id) return;
    try {
      setSaving(true);
      pauseAutoLock();
      setExclusionModalVisible(false);

      // Use local local-lite data for export
      const tenantsToExport = tenants
        .filter(t => isActiveTenantStatus(t.status))
        .map(t => ({
          ...t,
          contracts: contracts
            .filter(c => c.tenant_id === t.id)
            .map(c => ({
              ...c,
              house: houses.find(h => h.id === c.house_id)
                ? {
                    ...(houses.find(h => h.id === c.house_id) as any),
                    property: properties.find(
                      p => p.id === houses.find(h => h.id === c.house_id)?.property_id,
                    ),
                  }
                : undefined,
            })),
        }));

      const filename = `${selectedBusiness.name.replace(/[^a-zA-Z0-9]/g, '_')}_tenant_contacts_${formatDateForDB(new Date())}.vcf`;
      const result = await exportAndDownloadTenantsVCF(
        tenantsToExport as any,
        selectedBusiness.name,
        filename,
        excludedTenantIds,
      );

      setExportResult(result);
      setExportModalVisible(true);
    } catch (error: any) {
      console.error('Error exporting contacts:', error);
      setExportResult({
        success: false,
        message: error.message || 'Failed to export contacts. Please try again.',
      });
      setExportModalVisible(true);
    } finally {
      setSaving(false);
      resumeAutoLock();
    }
  };

  const openDeviceSettings = async () => {
    try {
      // Try to open app settings
      await Linking.openSettings();
    } catch (error) {
      console.error('Error opening settings:', error);
      showSnackbar('Please enable Contacts permission in your device settings.', 'error');
    }
  };

  const handleContactSupport = () => {
    setShowSupportModal(true);
  };

  const handleCancelSync = () => {
    setSyncCancelled(true);
    setSyncModalVisible(false);
  };

  const handleConfirmSync = async () => {
    if (!selectedBusiness?.id) return;
    try {
      setSaving(true);
      pauseAutoLock();

      // Reset sync state
      setSyncCancelled(false);
      setSyncCompleted(false);
      setSyncProgress({
        currentStep: 0,
        totalSteps: 0,
        currentTenant: '',
        stats: {
          created: 0,
          updated: 0,
          replaced: 0,
          duplicates: 0,
          errors: 0,
        },
        progress: 0,
      });

      // Show progress modal
      setSyncModalVisible(true);

      // Start sync with progress tracking and excluded IDs
      const result = await directSyncContacts(
        syncTenants,
        selectedBusiness.name,
        (progressData: SyncProgressData) => {
          if (!syncCancelled) {
            setSyncProgress(progressData);
          }
        },
        () => syncCancelled,
        excludedTenantIds,
        pauseAutoLock,
        resumeAutoLock,
      );

      if (syncCancelled) {
        setSyncModalVisible(false);
        showSnackbar('Contact sync was cancelled by user.', 'info');
        return;
      }

      if (result.success) {
        setSyncCompleted(true);
        sendNotification(
          'Sync Completed',
          'Contact synchronization has finished successfully.',
          { type: 'system_sync' },
        );
      } else {
        setSyncModalVisible(false);

        if (result.permissionDenied) {
          setPermissionModalData({
            message: result.message || 'Contacts permission is required.',
            permanentlyDenied: !!result.permanentlyDenied,
          });
          setPermissionModalVisible(true);
        } else {
          showSnackbar(
            result.message || 'Failed to sync contacts directly. Please try again.',
            'error',
          );
        }
      }
    } catch (error: any) {
      console.error('Error in direct sync:', error);
      setSyncModalVisible(false);
      showSnackbar(
        error.message || 'Failed to sync contacts directly. Please try again.',
        'error',
      );
    } finally {
      setSaving(false);
      resumeAutoLock();
    }
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

        {(hasAccess(['admin']) || hasAccess(['tenant'])) && (
          <>
            <List.Section>
              <List.Subheader>Financial Settings</List.Subheader>
              {hasAccess(['admin']) && (
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
                  hasAccess(['tenant'])
                    ? 'View your payment transactions'
                    : 'View all payment transactions'
                }
                left={props => <List.Icon {...props} icon="swap-horizontal" />}
                onPress={() => router.push('/settings/transactions')}
                right={props => <IconButton {...props} icon="chevron-right" />}
              />
            </List.Section>

            {hasAccess(['admin']) && (
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

        {hasAccess(['admin', 'staff']) && (
          <List.Section>
            <List.Subheader>Data Management</List.Subheader>
            <List.Item
              title="Reports & Analytics"
              description="Generate and view analytics reports"
              left={props => <List.Icon {...props} icon="chart-box" />}
              onPress={() => router.push('/reports')}
              right={props => <IconButton {...props} icon="chevron-right" />}
            />
            {hasAccess(['admin']) && (
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
                  onPress={() => setContactOptionsModalVisible(true)}
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
          {hasAccess(['admin']) && (
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

        {hasAccess(['admin']) && (
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
        {/* Links Modal */}
        <BaseModal
          visible={currentModal === 'links'}
          onDismiss={() => setCurrentModal(null)}
          title="Business Links"
          scrollable={true}
          subtitle="Add your business social media links and website."
          maxHeight="80%"
          actions={[
            {
              label: 'Cancel',
              mode: 'outlined',
              onPress: () => setCurrentModal(null),
              style: { flex: 1 },
            },
            {
              label: 'Save Links',
              mode: 'contained',
              onPress: handleSaveLinks,
              loading: saving,
              disabled: saving,
              style: { flex: 1 },
            },
          ]}
        >
          <View style={styles.compactModalContent}>
            {/* Website */}
            <Card
              style={{ marginBottom: 12, backgroundColor: colors.surface }}
              elevation={1}
            >
              <Card.Content style={{ paddingVertical: 12 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <MaterialCommunityIcons
                    name="web"
                    size={20}
                    color={colors.primary}
                    style={{ marginRight: 8 }}
                  />
                  <Text variant="titleSmall" style={{ flex: 1, fontWeight: '600' }}>
                    Website / Booking Portal
                  </Text>
                </View>
                <TextInput
                  mode="outlined"
                  placeholder="https://yourwebsite.com"
                  value={links.website}
                  onChangeText={text => setLinks(prev => ({ ...prev, website: text }))}
                  style={styles.input}
                  outlineColor={links.website ? (colors as any).success : undefined}
                  activeOutlineColor={
                    links.website ? (colors as any).success : colors.primary
                  }
                  dense
                  right={
                    links.website ? (
                      <TextInput.Icon
                        icon="close-circle"
                        onPress={() => setLinks(prev => ({ ...prev, website: '' }))}
                      />
                    ) : null
                  }
                />
                <HelperText type="info" style={{ marginTop: 4, fontSize: 11 }}>
                  📌 Used in tenant conversion emails for profile access
                </HelperText>
                {links.website && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <Button
                      mode="outlined"
                      compact
                      icon="content-copy"
                      onPress={() => {
                        // Copy to clipboard functionality
                        showSnackbar('Website link copied to clipboard', 'success');
                      }}
                      style={{ flex: 1 }}
                    >
                      Copy
                    </Button>
                    <Button
                      mode="contained-tonal"
                      compact
                      icon="open-in-new"
                      onPress={() => Linking.openURL(links.website)}
                      style={{ flex: 1 }}
                    >
                      Open
                    </Button>
                  </View>
                )}
              </Card.Content>
            </Card>

            {/* WhatsApp Group */}
            <Card
              style={{ marginBottom: 12, backgroundColor: colors.surface }}
              elevation={1}
            >
              <Card.Content style={{ paddingVertical: 12 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <MaterialCommunityIcons
                    name="whatsapp"
                    size={20}
                    color="#25D366"
                    style={{ marginRight: 8 }}
                  />
                  <Text variant="titleSmall" style={{ flex: 1, fontWeight: '600' }}>
                    WhatsApp Group
                  </Text>
                </View>
                <TextInput
                  mode="outlined"
                  placeholder="https://chat.whatsapp.com/..."
                  value={links.whatsapp_group}
                  onChangeText={text =>
                    setLinks(prev => ({ ...prev, whatsapp_group: text }))
                  }
                  style={styles.input}
                  outlineColor={
                    links.whatsapp_group ? (colors as any).success : undefined
                  }
                  activeOutlineColor={
                    links.whatsapp_group ? (colors as any).success : colors.primary
                  }
                  dense
                  right={
                    links.whatsapp_group ? (
                      <TextInput.Icon
                        icon="close-circle"
                        onPress={() =>
                          setLinks(prev => ({ ...prev, whatsapp_group: '' }))
                        }
                      />
                    ) : null
                  }
                />
                <HelperText type="info" style={{ marginTop: 4, fontSize: 11 }}>
                  📌 For tenant community group invitations
                </HelperText>
                {links.whatsapp_group && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <Button
                      mode="outlined"
                      compact
                      icon="content-copy"
                      onPress={() => {
                        showSnackbar('WhatsApp link copied to clipboard', 'success');
                      }}
                      style={{ flex: 1 }}
                    >
                      Copy
                    </Button>
                    <Button
                      mode="contained-tonal"
                      compact
                      icon="open-in-new"
                      onPress={() => Linking.openURL(links.whatsapp_group)}
                      style={{ flex: 1 }}
                    >
                      Open
                    </Button>
                  </View>
                )}
              </Card.Content>
            </Card>

            {/* Social Media Section */}
            <Text
              variant="titleSmall"
              style={{ marginTop: 8, marginBottom: 12, fontWeight: '600' }}
            >
              Social Media Links
            </Text>

            {/* Social Media Links */}
            <View style={{ marginBottom: 12 }}>
              <TextInput
                mode="outlined"
                label="Facebook"
                placeholder="https://facebook.com/yourpage"
                value={links.facebook}
                onChangeText={text => setLinks(prev => ({ ...prev, facebook: text }))}
                style={styles.input}
                outlineColor={links.facebook ? (colors as any).success : undefined}
                activeOutlineColor={
                  links.facebook ? (colors as any).success : colors.primary
                }
                dense
                left={<TextInput.Icon icon="facebook" color="#1877F2" />}
                right={
                  links.facebook ? (
                    <TextInput.Icon
                      icon="close-circle"
                      onPress={() => setLinks(prev => ({ ...prev, facebook: '' }))}
                    />
                  ) : null
                }
              />
            </View>

            <View style={{ marginBottom: 12 }}>
              <TextInput
                mode="outlined"
                label="Instagram"
                placeholder="https://instagram.com/youraccount"
                value={links.instagram}
                onChangeText={text => setLinks(prev => ({ ...prev, instagram: text }))}
                style={styles.input}
                outlineColor={links.instagram ? (colors as any).success : undefined}
                activeOutlineColor={
                  links.instagram ? (colors as any).success : colors.primary
                }
                dense
                left={<TextInput.Icon icon="instagram" color="#E4405F" />}
                right={
                  links.instagram ? (
                    <TextInput.Icon
                      icon="close-circle"
                      onPress={() => setLinks(prev => ({ ...prev, instagram: '' }))}
                    />
                  ) : null
                }
              />
            </View>

            <View style={{ marginBottom: 12 }}>
              <TextInput
                mode="outlined"
                label="Twitter / X"
                placeholder="https://twitter.com/youraccount"
                value={links.twitter}
                onChangeText={text => setLinks(prev => ({ ...prev, twitter: text }))}
                style={styles.input}
                outlineColor={links.twitter ? colors.success : undefined}
                activeOutlineColor={links.twitter ? colors.success : colors.primary}
                dense
                left={<TextInput.Icon icon="twitter" color="#1DA1F2" />}
                right={
                  links.twitter ? (
                    <TextInput.Icon
                      icon="close-circle"
                      onPress={() => setLinks(prev => ({ ...prev, twitter: '' }))}
                    />
                  ) : null
                }
              />
            </View>
          </View>
        </BaseModal>
        {/* Dashboard Customization Modal */}
        <DashboardCustomizationModal
          visible={showDashboardModal}
          onDismiss={() => setShowDashboardModal(false)}
          settings={settings}
          saveSettings={saveSettings}
        />
      </Portal>
      {/* Contact Sync Progress Modal */}
      <BaseModal
        visible={syncModalVisible}
        onDismiss={() => {
          setSyncModalVisible(false);
          setSyncCompleted(false);
        }}
        title={syncCompleted ? 'Sync Completed!' : 'Syncing Contacts'}
        subtitle={
          syncCompleted
            ? 'All contacts have been processed.'
            : 'Please wait while we sync your contacts.'
        }
        actions={
          syncCompleted
            ? [
                {
                  label: 'Close',
                  mode: 'contained',
                  onPress: () => {
                    setSyncModalVisible(false);
                    setSyncCompleted(false);
                  },
                  buttonColor: colors.success,
                  style: { flex: 1 },
                },
              ]
            : [
                {
                  label: 'Cancel',
                  mode: 'outlined',
                  onPress: handleCancelSync,
                  style: { flex: 1 },
                },
              ]
        }
      >
        <View style={{ marginBottom: 20 }}>
          <Text variant="bodyMedium" style={{ textAlign: 'center', marginBottom: 10 }}>
            {syncCompleted
              ? `All ${syncProgress.totalSteps} contacts processed`
              : `${syncProgress.currentStep} of ${syncProgress.totalSteps} contacts processed`}
          </Text>
          <ProgressBar
            progress={
              syncProgress.totalSteps > 0
                ? syncProgress.progress / syncProgress.totalSteps
                : 0
            }
            style={{ height: 8, borderRadius: 4, marginBottom: 5 }}
            color={syncCompleted ? colors.success : colors.primary}
          />
          <Text
            variant="bodySmall"
            style={{
              textAlign: 'center',
              fontWeight: 'bold',
              color: syncCompleted ? colors.success : colors.primary,
            }}
          >
            {Math.round(
              syncProgress.totalSteps > 0
                ? (syncProgress.progress / syncProgress.totalSteps) * 100
                : 0,
            )}
            %
          </Text>
        </View>

        {syncProgress.stats && (
          <View
            style={{
              backgroundColor: colors.surfaceVariant,
              padding: 15,
              borderRadius: 8,
              marginBottom: 20,
            }}
          >
            <Text
              variant="bodyMedium"
              style={{
                fontWeight: 'bold',
                marginBottom: 10,
                color: colors.onSurface,
              }}
            >
              {syncCompleted ? 'Final Results:' : 'Current Results:'}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 5,
              }}
            >
              <Text variant="bodySmall">Created: {syncProgress.stats.created || 0}</Text>
              <Text variant="bodySmall">Updated: {syncProgress.stats.updated || 0}</Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 5,
              }}
            >
              <Text variant="bodySmall">
                Replaced: {syncProgress.stats.replaced || 0}
              </Text>
              <Text variant="bodySmall">
                Duplicates: {syncProgress.stats.duplicates || 0}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="bodySmall">Errors: {syncProgress.stats.errors || 0}</Text>
            </View>
          </View>
        )}
      </BaseModal>
      {/* Contact Exclusion Selection Modal */}
      <BaseModal
        visible={exclusionModalVisible}
        onDismiss={() => setExclusionModalVisible(false)}
        edgeToEdge
        title={
          contactActionType === 'sync'
            ? 'Select Contacts to Sync'
            : 'Select Contacts to Export'
        }
        subtitle="Uncheck contacts you want to exclude."
        maxHeight="85%"
        scrollable={true}
        search={{
          placeholder: 'Search tenants...',
          value: syncSearchQuery,
          onChangeText: setSyncSearchQuery,
          onClear: () => setSyncSearchQuery(''),
        }}
        actions={[
          {
            label: 'Cancel',
            mode: 'outlined',
            onPress: () => setExclusionModalVisible(false),
            style: { flex: 1 },
          },
          {
            label: contactActionType === 'sync' ? 'Confirm Sync' : 'Confirm Export',
            mode: 'contained',
            onPress: () => {
              setExclusionModalVisible(false);
              if (contactActionType === 'sync') {
                handleConfirmSync();
              } else {
                handleConfirmExport();
              }
            },
            style: { flex: 1 },
          },
        ]}
      >
        <View>
          {syncTenants
            .filter(
              tenant =>
                tenant.name.toLowerCase().includes(syncSearchQuery.toLowerCase()) ||
                tenant.phone?.includes(syncSearchQuery) ||
                tenant.email?.toLowerCase().includes(syncSearchQuery.toLowerCase()),
            )
            .map((tenant: any) => (
              <List.Item
                key={tenant.id}
                title={tenant.name}
                description={tenant.phone || tenant.email}
                left={props => <List.Icon {...props} icon="account" />}
                right={() => (
                  <Checkbox.Android
                    status={
                      excludedTenantIds.includes(tenant.id) ? 'unchecked' : 'checked'
                    }
                    onPress={() => {
                      setExcludedTenantIds((prev: string[]) =>
                        prev.includes(tenant.id)
                          ? prev.filter(id => id !== tenant.id)
                          : [...prev, tenant.id],
                      );
                    }}
                  />
                )}
                onPress={() => {
                  setExcludedTenantIds((prev: string[]) =>
                    prev.includes(tenant.id)
                      ? prev.filter(id => id !== tenant.id)
                      : [...prev, tenant.id],
                  );
                }}
              />
            ))}
        </View>
      </BaseModal>
      {/* Contact Options Selection Modal */}
      <BaseModal
        visible={contactOptionsModalVisible}
        onDismiss={() => setContactOptionsModalVisible(false)}
        title="Manage Contacts"
        subtitle="Choose how you want to manage tenant contacts"
      >
        <View style={{ gap: 12 }}>
          <Card
            mode="outlined"
            onPress={() => {
              setContactOptionsModalVisible(false);
              // Small timeout to allow modal to close smoothly before opening the next one
              setTimeout(() => handleExportContacts(), 100);
            }}
            style={{ borderColor: colors.outline }}
          >
            <Card.Content style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialCommunityIcons
                name="export"
                size={24}
                color={colors.primary}
                style={{ marginRight: 16 }}
              />
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium">Export to File</Text>
                <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                  Download contacts as a .vcf file
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={24}
                color={colors.onSurfaceVariant}
              />
            </Card.Content>
          </Card>

          <Card
            mode="outlined"
            onPress={() => {
              setContactOptionsModalVisible(false);
              // Small timeout to allow modal to close smoothly before opening the next one
              setTimeout(() => handleDirectSyncContacts(), 100);
            }}
            style={{ borderColor: colors.outline }}
          >
            <Card.Content style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialCommunityIcons
                name="sync"
                size={24}
                color={colors.primary}
                style={{ marginRight: 16 }}
              />
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium">Sync to Device</Text>
                <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                  Add contacts directly to your phone
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={24}
                color={colors.onSurfaceVariant}
              />
            </Card.Content>
          </Card>
        </View>
      </BaseModal>
      {/* Export Contacts Modal */}
      <BaseModal
        visible={exportModalVisible}
        onDismiss={() => {
          setExportModalVisible(false);
          setExportResult(null);
        }}
        title={
          exportResult
            ? exportResult.success
              ? 'Export Successful!'
              : 'Export Failed'
            : 'Export Contacts'
        }
        subtitle={
          exportResult
            ? exportResult.success
              ? 'Your contacts are ready.'
              : 'There was an error.'
            : 'Create a VCF file of your contacts.'
        }
        actions={
          exportResult
            ? [
                {
                  label: 'Close',
                  mode: 'contained',
                  onPress: () => {
                    setExportModalVisible(false);
                    setExportResult(null);
                  },
                  buttonColor: exportResult.success ? colors.success : colors.error,
                  style: { flex: 1 },
                },
              ]
            : [
                {
                  label: 'Cancel',
                  mode: 'outlined',
                  onPress: () => setExportModalVisible(false),
                  style: { flex: 1 },
                },
                {
                  label: 'Export',
                  mode: 'contained',
                  onPress: handleConfirmExport,
                  buttonColor: colors.primary,
                  style: { flex: 1 },
                },
              ]
        }
      >
        <Text variant="bodyMedium" style={{ lineHeight: 24 }}>
          {exportResult
            ? exportResult.success
              ? 'Contacts exported successfully! You can now import the VCF file into your phone contacts.'
              : exportResult.message || 'Failed to export contacts. Please try again.'
            : 'This will export all tenant contacts as a VCF file that you can import into your phone contacts.\n Continue?'}
        </Text>
      </BaseModal>
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
      {/* Permission Modal */}
      <BaseModal
        visible={permissionModalVisible}
        onDismiss={() => setPermissionModalVisible(false)}
        title="Permission Required"
        message={permissionModalData?.message}
        mode="confirm"
        confirmText={
          permissionModalData?.permanentlyDenied ? 'Open Settings' : 'Try Again'
        }
        onConfirm={() => {
          setPermissionModalVisible(false);
          if (permissionModalData?.permanentlyDenied) {
            openDeviceSettings();
          } else {
            handleDirectSyncContacts();
          }
        }}
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
  input: {
    marginBottom: 16,
  },
  compactModalContent: {
    paddingVertical: 8,
  },
});
