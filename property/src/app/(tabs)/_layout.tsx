import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { router, Tabs, useSegments } from 'expo-router';
import React, { useEffect } from 'react';
import { Pressable } from 'react-native';
import { Avatar } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useAuth } from '@/providers/AuthProvider';
import { useOfflineImageSync } from '@/shared/components/CachedImage';
import { GlobalModals } from '@/shared/components/GlobalModals';
import NetworkIndicator from '@/shared/components/NetworkIndicator';
import ThemedHeader from '@/shared/components/ThemedHeader';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { setUIField, type UIState } from '@/stores/uiStore';

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

const HIDDEN_TAB_OPTIONS = {
  tabBarItemStyle: { display: 'none' as const },
  tabBarButton: () => null,
};

interface HiddenTabDefinition {
  name: string;
  title: string;
  subtitle?: string;
  backTo?: string;
  tabBarStyle?: Record<string, any>;
  onBack?: () => void;
  customBack?: () => void;
  customHeader?: (helpers: {
    renderBusinessHeader: (title?: string) => React.ReactNode;
  }) => React.ReactNode;
}

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

  const { localUri: businessLogoUri } = useOfflineImageSync(
    selectedBusiness?.logo_url || undefined,
  );

  useEffect(() => {
    if (authLoading || businessLoading) return;

    if (!selectedBusiness && router) {
      const currentPath = segments.join('/');
      const isOnDashboard =
        currentPath === '' ||
        currentPath === 'index' ||
        currentPath === '(tabs)' ||
        currentPath.includes('cloud-sync') ||
        currentPath.includes('settings');
      if (!isOnDashboard) {
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

  const hiddenScreens: HiddenTabDefinition[] = [
    {
      name: 'settings/profile',
      title: 'Profile',
      subtitle: 'Manage your account settings',
    },
    {
      name: 'settings/cloud-sync',
      title: 'Cloud Sync',
      subtitle: 'Sync your data to the cloud',
      tabBarStyle: { display: 'none' },
      onBack: () => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace(
            (user && !isOfflineAuthoritative) || isLocalModeAuthorized
              ? '/(tabs)/settings'
              : '/(auth)/login',
          );
        }
      },
    },
    {
      name: 'settings/transactions',
      title: 'Transactions',
      subtitle: 'Track payments and transaction history',
    },
    {
      name: 'maintenance/create',
      title: 'Report Issue',
      subtitle: 'Report a new maintenance issue',
      backTo: '/(tabs)/maintenance',
    },
    {
      name: 'maintenance/view/[id]',
      title: 'Request Details',
      subtitle: 'View maintenance request details',
      backTo: '/(tabs)/maintenance',
    },
    {
      name: 'maintenance/edit/[id]',
      title: 'Edit Request',
      subtitle: 'Edit maintenance request details',
      backTo: '/(tabs)/maintenance',
    },
    {
      name: 'reports/index',
      title: 'Reports',
      subtitle: 'View reports',
    },
    {
      name: 'settings/index',
      title: 'Settings',
      subtitle: 'Manage application settings and preferences',
      customBack: () => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.navigate('/(tabs)');
        }
      },
    },
    { name: 'settings/layout-builder', title: 'Layout Builder' },
    { name: 'settings/business-gallery', title: 'Business Gallery' },
    { name: 'settings/holidays', title: 'Holiday Breaks' },
    {
      name: 'businesses/view/[id]',
      title: 'View Business',
      customHeader: ({ renderBusinessHeader: rbh }) =>
        rbh(`${selectedBusiness?.name || 'Select Business'}`),
    },
    {
      name: 'properties/view/[id]',
      title: 'View Property',
      backTo: '/(tabs)/properties',
    },
    {
      name: 'tenants/create',
      title: 'Create Tenant',
      backTo: '/(tabs)/tenants',
    },
    {
      name: 'tenants/edit/[id]',
      title: 'Edit Tenant',
      backTo: '/(tabs)/tenants',
    },
    {
      name: 'tenants/view/[id]',
      title: 'View Tenant',
      backTo: '/(tabs)/tenants',
    },
    {
      name: 'contracts/create',
      title: 'Create Contract',
      backTo: '/(tabs)/contracts',
    },
    {
      name: 'contracts/edit/[id]',
      title: 'Edit Contract',
      backTo: '/(tabs)/contracts',
    },
    {
      name: 'contracts/view/[id]',
      title: 'View Contract',
      backTo: '/(tabs)/contracts',
    },
    {
      name: 'receipts/create',
      title: 'Create Receipt',
      backTo: '/(tabs)/receipts',
    },
    {
      name: 'receipts/edit/[id]',
      title: 'Edit Receipt',
      backTo: '/(tabs)/receipts',
    },
    {
      name: 'receipts/view/[id]',
      title: 'View Receipt',
      backTo: '/(tabs)/receipts',
    },
    { name: 'settings/currency', title: 'Currency Settings' },
    { name: 'settings/schedules', title: 'Schedule Management' },
    { name: 'settings/documentation', title: 'Documentation' },
    { name: 'settings/promotions', title: 'Promotions' },
    { name: 'settings/templates', title: 'Message Templates' },
    {
      name: 'settings/change-password',
      title: 'Change Password',
      subtitle: 'Update your account password',
    },
    { name: 'settings/delete-account', title: 'Delete Account' },
    { name: 'settings/api-keys', title: 'API Keys' },
    { name: 'backup/index', title: 'Backup & Restore' },
    { name: 'settings/data-integrity', title: 'Data Integrity' },
    { name: 'settings/configurations', title: 'Property Configurations' },
    { name: 'settings/payments', title: 'Payment Methods' },
    { name: 'reminders/index', title: 'Reminders & Notifications' },
  ];

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
            return (
              <Pressable
                {...props}
                ref={ref as any}
                android_ripple={null}
                style={[
                  props.style,
                  {
                    cursor: 'default',
                  } as any,
                ]}
              />
            );
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
            tabBarItemStyle:
              !isAdmin && (isTenant || isStaff) ? undefined : { display: 'none' },
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

        {/* Declarative Hidden Tabs */}
        {hiddenScreens.map(screen => (
          <Tabs.Screen
            key={screen.name}
            name={screen.name}
            options={{
              title: screen.title,
              ...HIDDEN_TAB_OPTIONS,
              ...(screen.tabBarStyle ? { tabBarStyle: screen.tabBarStyle } : {}),
              header: screen.customHeader
                ? () => screen.customHeader?.({ renderBusinessHeader })
                : () => (
                    <ThemedHeader
                      title={screen.title}
                      subtitle={screen.subtitle}
                      actions={
                        screen.onBack
                          ? undefined
                          : [
                              {
                                icon: 'arrow-left',
                                onPress: screen.customBack
                                  ? screen.customBack
                                  : () =>
                                      router.navigate(
                                        (screen.backTo || '/(tabs)/settings') as any,
                                      ),
                              },
                            ]
                      }
                      {...(screen.onBack ? { onBack: screen.onBack } : {})}
                    />
                  ),
            }}
          />
        ))}
      </Tabs>

      <GlobalModals />
    </React.Fragment>
  );
};

TabLayout.displayName = 'TabLayout';

export default TabLayout;
