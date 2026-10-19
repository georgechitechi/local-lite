const setBusinessSelectModalVisible = (value: UIState['businessSelectModalVisible']) =>
  setUIField('businessSelectModalVisible', value);
const setPropertyFormModalVisible = (value: UIState['propertyFormModalVisible']) =>
  setUIField('propertyFormModalVisible', value);
const setPropertyFormPropertyId = (value: UIState['propertyFormPropertyId']) =>
  setUIField('propertyFormPropertyId', value);
const setContractManagementModalVisible = (
  value: UIState['contractManagementModalVisible'],
) => setUIField('contractManagementModalVisible', value);
const setBookingsListModalVisible = (value: UIState['bookingsListModalVisible']) =>
  setUIField('bookingsListModalVisible', value);
const setPaymentMessagesListModalVisible = (
  value: UIState['paymentMessagesListModalVisible'],
) => setUIField('paymentMessagesListModalVisible', value);
const setMpesaPaymentModalVisible = (value: UIState['mpesaPaymentModalVisible']) =>
  setUIField('mpesaPaymentModalVisible', value);

import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { router, Tabs, useSegments } from 'expo-router';
import React, { useEffect } from 'react';
import { Avatar } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useAuth } from '@/providers/AuthProvider';
import { useOfflineImageSync } from '@/shared/components/CachedImage';
import { GlobalModals } from '@/shared/components/GlobalModals';
import NetworkIndicator from '@/shared/components/NetworkIndicator';
import SPressable from '@/shared/components/SlightPressable';
import ThemedHeader from '@/shared/components/ThemedHeader';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { setUIField, type UIState } from '@/stores/uiStore';

const HIDDEN_TAB_OPTIONS = {
  tabBarItemStyle: { display: 'none' as const },
  tabBarButton: () => null,
};

const TabLayout = function TabLayout() {
  const colors = useThemeColors();
  const { selectedBusiness, loading: businessLoading } = useBusiness();
  const {
    user,
    isOfflineAuthoritative,
    isLocalModeAuthorized,
    confirmSignOut,
    loading: authLoading,
  } = useAuth();
  const segments = useSegments();
  const { isAdmin, isAdminOrStaff, isTenant, isStaff, isTenantOnly, can } =
    useAccessControl();

  // Show offline warning when authoritative offline
  const { localUri: businessLogoUri } = useOfflineImageSync(
    selectedBusiness?.logo_url || undefined,
  );

  // Redirect to Dashboard if no business is configured
  useEffect(() => {
    if (authLoading || businessLoading) return;

    if (!selectedBusiness && router) {
      // Check if we are already on the dashboard or businesses selection list
      const currentPath = segments.join('/');
      const isOnDashboard =
        currentPath === '' ||
        currentPath === 'index' ||
        currentPath === '(tabs)' ||
        currentPath.includes('cloud-sync') ||
        currentPath.includes('settings');
      if (!isOnDashboard) {
        // Use a small delay to ensure navigation is ready
        const timer = setTimeout(() => {
          router.replace('/(tabs)');
        }, 100);
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [selectedBusiness, segments, authLoading, businessLoading]);

  const renderBusinessHeader = (title?: string) => (
    <ThemedHeader
      title={title || selectedBusiness?.name || 'Select Business'}
      actions={
        selectedBusiness
          ? [
              {
                icon: 'cogs',
                onPress: () => router.navigate('/(tabs)/settings'),
              },
            ]
          : [{ icon: 'logout', onPress: confirmSignOut }]
      }
      onTitlePress={() => setBusinessSelectModalVisible(true)}
      subtitle="Tap to switch Business"
      avatar={
        selectedBusiness ? (
          businessLogoUri ? (
            <Avatar.Image
              size={40}
              source={{ uri: businessLogoUri }}
              style={{ backgroundColor: 'transparent' }}
            />
          ) : (
            <Avatar.Icon
              size={40}
              icon="briefcase"
              style={{ backgroundColor: colors.primaryContainer }}
              color={colors.onPrimary}
            />
          )
        ) : null
      }
      extra={selectedBusiness ? <NetworkIndicator /> : null}
    />
  );

  const renderTabBarIcon = (name: string) => {
    const TabBarIcon = ({ color, size }: { color: any; size: number }) => (
      <MaterialCommunityIcons name={name as any} size={size + 4} color={color} />
    );
    return TabBarIcon;
  };

  return (
    <React.Fragment>
      <Tabs
        screenOptions={{
          headerShown: true,
          tabBarInactiveTintColor: colors.outline,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.outlineVariant,
            borderTopWidth: 0.5,
          },
          tabBarButton: function TabBarButton({ ref, ...props }: any) {
            return <SPressable {...props} ref={ref as any} />;
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            tabBarIcon: renderTabBarIcon('home'),
            header: () => renderBusinessHeader(),
          }}
        />

        <Tabs.Screen
          name="settings/profile"
          options={{
            title: 'Profile',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Settings"
                subtitle="Manage your account settings"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/cloud-sync"
          options={{
            title: 'Cloud Sync',
            ...HIDDEN_TAB_OPTIONS,
            tabBarStyle: { display: 'none' },
            header: () => (
              <ThemedHeader
                title="Cloud Sync"
                subtitle="Sync your data to the cloud"
                onBack={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace(
                      (user && !isOfflineAuthoritative) || isLocalModeAuthorized
                        ? '/(tabs)/settings'
                        : '/(auth)/login',
                    );
                  }
                }}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/transactions"
          options={{
            title: 'Transactions',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Transactions"
                subtitle="Track payments and transaction history"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="properties/index"
          options={{
            title: 'Properties',
            tabBarItemStyle: isAdmin ? undefined : { display: 'none' },
            tabBarButton: isAdmin ? undefined : () => null,
            tabBarIcon: renderTabBarIcon('office-building'),
            header: () => (
              <ThemedHeader
                title="Properties"
                subtitle="Manage property listings and units"
                actions={[
                  {
                    icon: 'file-chart-outline',
                    size: 24,
                    onPress: () => router.navigate('/(tabs)/reports'),
                  },
                  {
                    icon: 'plus-circle',
                    onPress: () => {
                      setPropertyFormPropertyId(null);
                      setPropertyFormModalVisible(true);
                    },
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="tenants/index"
          options={{
            title: 'Tenants',
            tabBarItemStyle: isAdminOrStaff ? undefined : { display: 'none' },
            tabBarButton: isAdminOrStaff ? undefined : () => null,
            tabBarIcon: renderTabBarIcon('account-group'),
            header: () => (
              <ThemedHeader
                title="Tenants"
                subtitle="Manage tenant profiles and occupancy"
                actions={[
                  {
                    icon: 'account-multiple',
                    size: 28,
                    onPress: () => setBookingsListModalVisible(true),
                  },
                  ...(can('create', 'tenant')
                    ? [
                        {
                          icon: 'plus-circle',
                          onPress: () => router.navigate('/(tabs)/tenants/create'),
                        },
                      ]
                    : []),
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="contracts/index"
          options={{
            title: 'Contracts',
            tabBarItemStyle: isAdmin ? undefined : { display: 'none' },
            tabBarButton: isAdmin ? undefined : () => null,
            tabBarIcon: renderTabBarIcon('file'),
            header: () => (
              <ThemedHeader
                title="Contracts"
                subtitle="Manage lease agreements and renewals"
                actions={
                  isAdmin
                    ? [
                        {
                          icon: 'file-cog',
                          size: 24,
                          onPress: () => setContractManagementModalVisible(true),
                        },
                        {
                          icon: 'plus-circle',
                          onPress: () => router.navigate('/(tabs)/contracts/create'),
                        },
                      ]
                    : []
                }
              />
            ),
          }}
        />

        <Tabs.Screen
          name="receipts/index"
          options={{
            title: isAdminOrStaff ? 'Receipts' : 'My Receipts',
            tabBarItemStyle: isAdminOrStaff || isTenant ? undefined : { display: 'none' },
            tabBarButton: isAdminOrStaff || isTenant ? undefined : () => null,
            tabBarIcon: renderTabBarIcon('receipt-text-outline'),
            header: () => (
              <ThemedHeader
                title={isAdminOrStaff ? 'Receipts' : 'My Receipts'}
                subtitle="Track payments and transaction history"
                actions={[
                  ...(isAdmin
                    ? [
                        {
                          icon: 'bank-transfer',
                          size: 28,
                          onPress: () => setPaymentMessagesListModalVisible(true),
                        },
                      ]
                    : []),
                  ...(can('create', 'receipt')
                    ? [
                        {
                          icon: 'plus-circle',
                          onPress: () => router.navigate('/(tabs)/receipts/create'),
                        },
                      ]
                    : []),
                  ...(isTenantOnly
                    ? [
                        {
                          icon: 'cash-multiple',
                          size: 28,
                          onPress: () => setMpesaPaymentModalVisible(true),
                        },
                      ]
                    : []),
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="maintenance/index"
          options={{
            title: 'Maintenance',
            tabBarItemStyle: !isAdmin && (isTenant || isStaff) ? undefined : { display: 'none' },
            tabBarButton: !isAdmin && (isTenant || isStaff) ? undefined : () => null,
            tabBarIcon: renderTabBarIcon('hammer-wrench'),
            header: () => (
              <ThemedHeader
                title="Maintenance"
                subtitle="Track maintenance requests"
                actions={[
                  {
                    icon: 'plus-circle',
                    onPress: () => router.navigate('/(tabs)/maintenance/create'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="maintenance/create"
          options={{
            title: 'Report Issue',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Report Issue"
                subtitle="Report a new maintenance issue"
                actions={[
                  { icon: 'arrow-left', onPress: () => router.navigate('/(tabs)/maintenance') },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="maintenance/view/[id]"
          options={{
            title: 'Request Details',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Request Details"
                subtitle="View maintenance request details"
                actions={[
                  { icon: 'arrow-left', onPress: () => router.navigate('/(tabs)/maintenance') },
                ]}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="maintenance/edit/[id]"
          options={{
            title: 'Edit Request',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Edit Request"
                subtitle="Edit maintenance request details"
                actions={[
                  { icon: 'arrow-left', onPress: () => router.navigate('/(tabs)/maintenance') },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="reports/index"
          options={{
            title: 'Reports',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Reports"
                subtitle="View reports"
                actions={[
                  { icon: 'arrow-left', onPress: () => router.navigate('/(tabs)/settings') },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/index"
          options={{
            title: 'Settings',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Settings"
                subtitle="Manage application settings and preferences"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => {
                      if (router.canGoBack()) {
                        router.back();
                      } else {
                        router.navigate('/(tabs)');
                      }
                    },
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/layout-builder"
          options={{
            title: 'Layout Builder',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Layout Builder"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/business-gallery"
          options={{
            title: 'Business Gallery',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Business Gallery"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        {/* Holiday Break Page - Admin, Staff */}
        <Tabs.Screen
          name="settings/holidays"
          options={{
            title: 'Holiday Breaks',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Holiday Breaks"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="businesses/view/[id]"
          options={{
            title: 'View Business',
            ...HIDDEN_TAB_OPTIONS,
            header: () =>
              renderBusinessHeader(`${selectedBusiness?.name || 'Select Business'}`),
          }}
        />
        <Tabs.Screen
          name="properties/view/[id]"
          options={{
            title: 'View Property',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="View Property"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/properties'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="tenants/create"
          options={{
            title: 'Create Tenant',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Create Tenant"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/tenants'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="tenants/edit/[id]"
          options={{
            title: 'Edit Tenant',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Edit Tenant"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/tenants'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="tenants/view/[id]"
          options={{
            title: 'View Tenant',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="View Tenant"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/tenants'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="contracts/create"
          options={{
            title: 'Create Contract',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Create Contract"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/contracts'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="contracts/edit/[id]"
          options={{
            title: 'Edit Contract',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Edit Contract"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/contracts'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="contracts/view/[id]"
          options={{
            title: 'View Contract',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="View Contract"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/contracts'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="receipts/create"
          options={{
            title: 'Create Receipt',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Create Receipt"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/receipts'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="receipts/edit/[id]"
          options={{
            title: 'Edit Receipt',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Edit Receipt"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/receipts'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="receipts/view/[id]"
          options={{
            title: 'View Receipt',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="View Receipt"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/receipts'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/currency"
          options={{
            title: 'Currency Settings',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Currency Settings"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/schedules"
          options={{
            title: 'Schedule Management',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Schedule Management"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/documentation"
          options={{
            title: 'Documentation',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Documentation"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/promotions"
          options={{
            title: 'Promotions',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Promotions"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/templates"
          options={{
            title: 'Message Templates',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Message Templates"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/change-password"
          options={{
            title: 'Change Password',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Change Password"
                subtitle="Update your account password"
                actions={[
                  { icon: 'arrow-left', onPress: () => router.navigate('/(tabs)/settings') },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/delete-account"
          options={{
            title: 'Delete Account',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Delete Account"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/api-keys"
          options={{
            title: 'API Keys',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="API Keys"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="backup/index"
          options={{
            title: 'Backup & Restore',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Backup & Restore"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/data-integrity"
          options={{
            title: 'Data Integrity',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Data Integrity"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/configurations"
          options={{
            title: 'Property Configurations',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Property Configurations"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="settings/payments"
          options={{
            title: 'Payment Methods',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Payment Methods"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="reminders/index"
          options={{
            title: 'Reminders & Notifications',
            ...HIDDEN_TAB_OPTIONS,
            header: () => (
              <ThemedHeader
                title="Reminders & Notifications"
                actions={[
                  {
                    icon: 'arrow-left',
                    onPress: () => router.navigate('/(tabs)/settings'),
                  },
                ]}
              />
            ),
          }}
        />
      </Tabs>

      <GlobalModals />
    </React.Fragment>
  );
};

TabLayout.displayName = 'TabLayout';

export default TabLayout;
