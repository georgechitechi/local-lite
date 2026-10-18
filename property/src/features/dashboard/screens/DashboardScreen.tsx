const setExpensesListModalVisible = (value: UIState['expensesListModalVisible']) =>
  setUIField('expensesListModalVisible', value);
const setMpesaPaymentModalVisible = (value: UIState['mpesaPaymentModalVisible']) =>
  setUIField('mpesaPaymentModalVisible', value);

import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import { useSyncStatus } from 'local-lite/react';
import React, { useMemo, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Divider, Surface, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import ExpiringContractsCard, {
  type ExpiringContract,
} from '@/features/contracts/components/ExpiringContractsCard';
import DailyFinanceCard from '@/features/dashboard/components/DailyFinanceCard';
import { InsightsCard } from '@/features/dashboard/components/InsightsCard';
import MaintenanceOverviewCard from '@/features/dashboard/components/MaintenanceOverviewCard';
import PendingRentCard from '@/features/dashboard/components/PendingRentCard';
import RecentActivityCard from '@/features/dashboard/components/RecentActivityCard';
import { StatCard } from '@/features/dashboard/components/StatCard';
import WaiversCard, {
  type WaiverTenant,
} from '@/features/dashboard/components/WaiversCard';
import { WelcomeDashboard } from '@/features/dashboard/components/WelcomeDashboard';
import { calculateDashboardStats } from '@/features/dashboard/utils/businessMetrics';
import ExpensesAnalysisCard from '@/features/expenses/components/ExpensesAnalysisCard';
import MpesaPaymentModal from '@/features/payments/components/MpesaPaymentModal';
import { useLocalClient } from '@/providers/SyncClientProvider';
import { useOfflineImageSync } from '@/shared/components/CachedImage';
import LoadingCard from '@/shared/components/LoadingCard';
import SPressable from '@/shared/components/SlightPressable';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useCurrency } from '@/shared/hooks/useCurrency';
import { useInsights } from '@/shared/hooks/useInsights';
import {
  useBusinesses,
  useContracts,
  useCoreGroupMap,
  useCoreIndexMap,
  useExpenses,
  useHouses,
  useIsInitialSyncing,
  useMaintenanceRequests,
  usePaymentMessageReceipts,
  usePaymentMessages,
  useProfile,
  useProperties,
  useReceipts,
  useSettings,
  useStoreRefresh,
  useTenants,
} from '@/shared/hooks/useStore';
import { useTheme, useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatWithCurrency, parseLocalDate } from '@/shared/utils/formatters';
import {
  calculateEffectiveRent,
  parseMetadata,
  safeParseJSON,
} from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import { setUIField, type UIState, useUIState } from '@/stores/uiStore';

const Dashboard = function Dashboard() {
  const { selectedBusiness } = useBusiness();
  const mpesaPaymentModalVisible = useUIState(s => s.mpesaPaymentModalVisible);
  const isDarkModeInstance = useTheme();
  const {
    user,
    userRoles,
    tenantId,
    loading: accessLoading,
    isAdmin,
    isAdminOrStaff,
  } = useAccessControl();
  const isManagement = isAdminOrStaff;
  const colors = useThemeColors();
  const router = useRouter();
  const isKE = selectedBusiness?.country === 'KE';

  const [selectedMonthDate, setSelectedMonthDate] = useState<Date>(() => new Date());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set<string>(['unpaid', 'partial']),
  );
  const [waiverSelectedMonthDate, setWaiverSelectedMonthDate] = useState<Date>(
    () => new Date(),
  );
  const [waiverCollapsedGroups, setWaiverCollapsedGroups] = useState<Set<string>>(
    () => new Set<string>(['full', 'partial_waiver']),
  );
  const [dailyFinanceSelectedMonth, setDailyFinanceSelectedMonth] = useState<Date>(
    () => new Date(),
  );
  const [expensesSelectedMonth, setExpensesSelectedMonth] = useState<Date>(
    () => new Date(),
  );
  const [recentActivityDate, setRecentActivityDate] = useState<Date>(() => new Date());
  const [activityCollapsedGroups, setActivityCollapsedGroups] = useState<Set<string>>(
    () => new Set<string>(['income', 'expenses']),
  );

  // Safety check for isDarkMode
  const isDark = isDarkModeInstance.isDarkMode || false;
  const profile = useProfile(user?.id);

  // Use offline image sync for avatar
  const { localUri: avatarUri } = useOfflineImageSync(
    user?.user_metadata?.avatar_url || profile?.avatar_url || undefined,
  );

  const { defaultCurrency } = useCurrency(selectedBusiness?.id);

  const selectedBusinessId = selectedBusiness?.id;
  const allBusinesses = useBusinesses();
  const { refreshing, onRefresh } = useStoreRefresh();

  const properties = useProperties(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const receipts = useReceipts(selectedBusiness?.id);
  const expenses = useExpenses(selectedBusiness?.id);
  const tenants = useTenants(selectedBusiness?.id);
  const contracts = useContracts(selectedBusiness?.id);
  const paymentMessages = usePaymentMessages(selectedBusiness?.id);
  const paymentMessageReceipts = usePaymentMessageReceipts(selectedBusiness?.id);
  const maintenanceRequests = useMaintenanceRequests(selectedBusiness?.id);
  const settings = useSettings(selectedBusiness?.id);

  const receiptsByContractId = useCoreGroupMap(receipts, 'contract_id');
  const housesById = useCoreIndexMap(houses);
  const tenantsById = useCoreIndexMap(tenants);
  const propertiesById = useCoreIndexMap(properties);
  const contractsByTenantId = useCoreGroupMap(contracts, 'tenant_id');

  const isHydratingSelection =
    !!selectedBusinessId && !selectedBusiness && allBusinesses.length === 0;

  const client = useLocalClient();
  const { isSyncing: isSyncingStore } = useSyncStatus(client);

  const isInitialSyncing = useIsInitialSyncing();
  const [isWaitingForInitialSync, setIsWaitingForInitialSync] = useState(true);

  React.useEffect(() => {
    // If neither initial pull nor ongoing sync is active, unblock dashboard
    if (!isSyncingStore && !isInitialSyncing) {
      setIsWaitingForInitialSync(false);
    }
  }, [isSyncingStore, isInitialSyncing]);

  // Safety timer: Never allow initial sync wait to block the dashboard for more than 3.5 seconds
  React.useEffect(() => {
    if (isWaitingForInitialSync) {
      const timer = setTimeout(() => {
        setIsWaitingForInitialSync(false);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [isWaitingForInitialSync]);

  const insights = useInsights(selectedBusiness?.id, {
    houses,
    receipts,
    expenses,
    tenants,
    contracts,
    contractsByTenantId,
  });

  const handleInsightAction = (action: string, params?: Record<string, any>) => {
    switch (action) {
      case 'View Houses':
        router.push('/properties');
        break;
      case 'View Expenses':
        setExpensesListModalVisible(true);
        break;
      case 'View Contracts':
        router.push({
          pathname: '/contracts',
          params: { renewals: 'true' },
        });
        break;
      case 'Send Reminders':
        router.push({
          pathname: '/reminders',
          params: { payment: 'true' },
        });
        break;
      case 'View Reports':
        router.push('/reports');
        break;
      case 'Request Info':
        router.push({
          pathname: '/reminders',
          params: { category: 'data_cleanup' },
        });
        break;
      case 'View Tenants':
        router.push({
          pathname: '/tenants',
          params: params as any,
        });
        break;
      case 'View Receipts':
        router.push({
          pathname: '/receipts',
          params: params as any,
        });
        break;
    }
  };

  // Dashboard Preferences
  const dashboardPreferences = React.useMemo(() => {
    const defaultPrefs = {
      show_insights: true,
      show_pending_rent: true,
      show_recent_activity: true,
      show_waivers: true,
      show_expiring_contracts: true,
      show_maintenance: true,
      show_daily_finance: true,
      show_expenses_analysis: true,
    };
    const prefSetting = settings.find(
      (s: any) => s.setting_key === 'dashboard_preferences',
    );
    return prefSetting
      ? { ...defaultPrefs, ...(prefSetting.setting_value as any) }
      : defaultPrefs;
  }, [settings]);

  // Compute stats reactively
  const { stats, tenantContext } = useMemo(() => {
    const stats = calculateDashboardStats({
      properties,
      houses,
      tenants,
      contracts,
      receipts,
      expenses,
      maintenanceRequests,
    });

    // Recent Expenses
    const sortedExpenses = [...expenses]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 3)
      .map(e => ({
        id: e.id,
        amount: e.amount,
        category: e.category,
        date: e.date,
        remarks: e.remarks,
        createdAt: e.created_at,
        updatedAt: e.updated_at,
      }));

    const isActualTenant = userRoles.includes('tenant');

    return {
      stats,
      recentExpenses: sortedExpenses,
      tenantContext: isActualTenant
        ? (() => {
            if (!tenantId) return { contract: null, receipts: [], maintenance: [] };

            const contract = contracts.find(
              c => c.tenant_id === tenantId && isActiveContractStatus(c.status),
            );
            const tenantHouseId = contract?.house_id;
            const tenantPropertyId = houses.find(
              h => h.id === tenantHouseId,
            )?.property_id;

            return {
              contract,
              receipts: receipts
                .filter(r => r.tenant_id === tenantId)
                .sort(
                  (a, b) =>
                    new Date(b.payment_date).getTime() -
                    new Date(a.payment_date).getTime(),
                )
                .slice(0, 5),
              maintenance: maintenanceRequests
                .filter(m => {
                  if (m.tenant_id === tenantId) return true;
                  if (tenantPropertyId && m.property_id === tenantPropertyId) {
                    const isPropertyWide =
                      !m.house_id &&
                      (!m.affected_houses || m.affected_houses.length === 0);
                    if (isPropertyWide) return true;
                  }
                  return false;
                })
                .sort(
                  (a, b) =>
                    new Date(b.event_date || 0).getTime() -
                    new Date(a.event_date || 0).getTime(),
                )
                .slice(0, 5),
            };
          })()
        : null,
    };
  }, [
    properties,
    houses,
    receipts,
    expenses,
    tenants,
    contracts,
    maintenanceRequests,
    userRoles,
    tenantId,
  ]);

  // Calculated locally to support offline mode
  const pendingRentTenants = React.useMemo(() => {
    if (!selectedBusiness?.id || !isManagement) return [];

    const targetMonth = selectedMonthDate.getMonth() + 1;
    const targetYear = selectedMonthDate.getFullYear();
    const monthStart = new Date(targetYear, targetMonth - 1, 1);
    const monthEnd = new Date(targetYear, targetMonth, 0);

    // 1. Find active contracts
    const activeContracts = contracts.filter(c => {
      const startDate = new Date(c.start_date);
      const endDate = c.end_date ? new Date(c.end_date) : new Date(9999, 11, 31);

      return (
        startDate <= monthEnd && endDate >= monthStart && isActiveContractStatus(c.status)
      );
    });

    const results = activeContracts.map(contract => {
      const house = contract.house_id ? housesById.get(contract.house_id) : undefined;
      const property = house?.property_id
        ? propertiesById.get(house.property_id)
        : undefined;
      const tenant = contract.tenant_id ? tenantsById.get(contract.tenant_id) : undefined;

      const contractReceipts = (receiptsByContractId.get(contract.id) || []).filter(r => {
        const p = safeParseJSON<{ month?: number; year?: number }>(
          r.payment_period as any,
          {},
        );
        return p.month === targetMonth && p.year === targetYear;
      });

      const amountPaid = contractReceipts.reduce((sum, r) => {
        if (r.is_refunded || r.status === 'refunded') return sum;
        const amt = parseFloat(String(r.amount)) || 0;
        const ref = parseFloat(String(r.refunded_amount)) || 0;
        return sum + Math.max(0, amt - ref);
      }, 0);
      const rentAmount = parseFloat(String(contract.rent_amount)) || 0;

      // Check for breaks (holiday breaks)
      const metadata = parseMetadata(contract.metadata);
      const breaks = metadata.breaks || [];

      const { effectiveRent: effectiveRentAmount, isOnFullBreak } =
        calculateEffectiveRent(rentAmount, targetMonth, targetYear, breaks);

      const amountPending = Math.max(0, effectiveRentAmount - amountPaid);

      let status: 'paid' | 'partial' | 'unpaid' = 'unpaid';
      if (amountPending <= 0.1) status = 'paid';
      else if (amountPaid > 0) status = 'partial';

      return {
        contract_id: contract.id,
        tenant_name: tenant?.name || 'Unknown',
        property_name: (property as any)?.name || 'Unknown Property',
        house_number: house?.house_number || 'N/A',
        amount_pending: amountPending,
        amount_paid: amountPaid,
        payment_status: status,
        isOnBreak: isOnFullBreak,
      };
    });

    return results
      .filter(
        r =>
          !r.isOnBreak &&
          (r.payment_status === 'unpaid' || r.payment_status === 'partial'),
      )
      .sort((a, b) => a.tenant_name.localeCompare(b.tenant_name));
  }, [
    selectedBusiness?.id,
    isManagement,
    selectedMonthDate,
    contracts,
    receiptsByContractId,
    tenantsById,
    housesById,
    propertiesById,
  ]);

  const waiverTenants = React.useMemo<WaiverTenant[]>(() => {
    if (!selectedBusiness?.id || !isManagement) return [];

    const targetMonth = waiverSelectedMonthDate.getMonth() + 1;
    const targetYear = waiverSelectedMonthDate.getFullYear();
    const monthStart = new Date(targetYear, targetMonth - 1, 1);
    const monthEnd = new Date(targetYear, targetMonth, 0);

    // 1. Find active contracts
    const activeContracts = contracts.filter(c => {
      const startDate = new Date(c.start_date);
      const endDate = c.end_date ? new Date(c.end_date) : new Date(9999, 11, 31);

      return (
        startDate <= monthEnd && endDate >= monthStart && isActiveContractStatus(c.status)
      );
    });

    // 2. Calculate waivers
    const results: WaiverTenant[] = [];

    activeContracts.forEach(contract => {
      const house = contract.house_id ? housesById.get(contract.house_id) : undefined;
      const property = house?.property_id
        ? propertiesById.get(house.property_id)
        : undefined;
      const tenant = contract.tenant_id ? tenantsById.get(contract.tenant_id) : undefined;

      const rentAmount = parseFloat(String(contract.rent_amount)) || 0;

      // Check for breaks (holiday breaks)
      const metadata = parseMetadata(contract.metadata);
      const breaks = metadata.breaks || [];

      const {
        effectiveRent: effectiveRentAmount,
        isOnFullBreak,
        daysOnBreak,
      } = calculateEffectiveRent(rentAmount, targetMonth, targetYear, breaks);

      let waiverEndDate: string | undefined;
      const monthStart = new Date(targetYear, targetMonth - 1, 1);
      const monthEnd = new Date(targetYear, targetMonth, 0);

      breaks.forEach((b: any) => {
        if (!b?.start_date) return;
        const bStart = parseLocalDate(b.start_date);
        const bEnd =
          !b.end_date || String(b.end_date).includes('2099')
            ? new Date(2099, 11, 31)
            : parseLocalDate(b.end_date);
        if (bStart <= monthEnd && bEnd >= monthStart) {
          if (!waiverEndDate || (b.end_date && b.end_date > waiverEndDate)) {
            waiverEndDate = b.end_date;
          }
        }
      });

      if (daysOnBreak > 0 || isOnFullBreak) {
        results.push({
          contract_id: contract.id,
          tenant_name: tenant?.name || 'Unknown',
          property_name: (property as any)?.name || 'Unknown Property',
          house_number: house?.house_number || 'N/A',
          original_rent: rentAmount,
          effective_rent: effectiveRentAmount,
          amount_waived: rentAmount - effectiveRentAmount,
          days_on_break: daysOnBreak,
          is_full_waiver: isOnFullBreak,
          end_date: waiverEndDate,
        });
      }
    });

    return results.sort((a, b) => a.tenant_name.localeCompare(b.tenant_name));
  }, [
    selectedBusiness?.id,
    isManagement,
    waiverSelectedMonthDate,
    contracts,
    tenantsById,
    housesById,
    propertiesById,
  ]);

  const expiringContractsList = React.useMemo<ExpiringContract[]>(() => {
    if (!selectedBusiness?.id || !isManagement) return [];

    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    return contracts
      .filter(c => {
        if (!isActiveContractStatus(c.status)) return false;
        if (!c.end_date) return false;
        const endDate = new Date(c.end_date);
        return endDate <= thirtyDaysFromNow && endDate >= now;
      })
      .map(c => {
        const house = c.house_id ? housesById.get(c.house_id) : undefined;
        const property = house?.property_id
          ? propertiesById.get(house.property_id)
          : undefined;
        const tenant = c.tenant_id ? tenantsById.get(c.tenant_id) : undefined;
        const endDate = new Date(c.end_date);
        const daysRemaining = Math.ceil(
          (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        return {
          id: c.id,
          tenant_name: tenant?.name || 'Unknown',
          property_name: (property as any)?.name || 'Unknown Property',
          house_number: house?.house_number || 'N/A',
          end_date: c.end_date,
          days_remaining: daysRemaining,
        };
      })
      .sort((a, b) => a.days_remaining - b.days_remaining);
  }, [
    contracts,
    housesById,
    tenantsById,
    propertiesById,
    isManagement,
    selectedBusiness?.id,
  ]);

  const pendingRentLoading = false;

  if (
    accessLoading ||
    isHydratingSelection ||
    isWaitingForInitialSync ||
    isInitialSyncing
  ) {
    return (
      <LoadingCard iconName="view-dashboard-variant" text="Loading workspace data..." />
    );
  }

  if (!selectedBusiness) {
    return <WelcomeDashboard />;
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {!isAdmin && (
        <View style={{ marginBottom: 0, backgroundColor: colors.surface }}>
          <View style={{ paddingHorizontal: 16, marginVertical: 0 }}>
            <View style={styles.userInfoContainer}>
              {!profile && !user ? (
                <View style={styles.avatarPlaceholder}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatar} />
              ) : (
                <MaterialCommunityIcons
                  name="account-circle"
                  size={70}
                  color={colors.primary}
                />
              )}
              <View style={styles.userDetails}>
                {!profile && !user ? (
                  <View style={styles.loadingText}>
                    <ActivityIndicator size="small" color={colors.onSurfaceVariant} />
                  </View>
                ) : (
                  <>
                    <Text style={[styles.userName, { color: colors.onSurface }]}>
                      {user?.user_metadata?.name ||
                        user?.user_metadata?.full_name ||
                        profile?.name ||
                        'Not Set'}
                    </Text>
                    <Text style={[styles.userEmail, { color: colors.onSurfaceVariant }]}>
                      {user?.email}
                    </Text>
                    {(user?.phone || user?.user_metadata?.phone || profile?.phone) && (
                      <Text
                        style={[styles.userPhone, { color: colors.onSurfaceVariant }]}
                      >
                        {user?.phone || user?.user_metadata?.phone || profile?.phone}
                      </Text>
                    )}
                  </>
                )}
              </View>
            </View>

            {tenantContext?.contract && (
              <View style={{ marginTop: 16 }}>
                <Divider style={{ marginBottom: 16 }} />
                <Text variant="titleMedium" style={{ marginBottom: 8 }}>
                  My Rental Information
                </Text>
                <Surface
                  style={[
                    styles.transaction,
                    { backgroundColor: colors.surfaceVariant, elevation: 0 },
                  ]}
                >
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text variant="labelLarge" numberOfLines={1}>
                      Active Contract
                    </Text>
                    <Text variant="bodyMedium">
                      {houses.find(h => h.id === tenantContext.contract?.house_id)
                        ?.house_number || 'N/A'}{' '}
                      •{' '}
                      {defaultCurrency
                        ? formatWithCurrency(
                            tenantContext.contract?.rent_amount || 0,
                            defaultCurrency,
                          )
                        : tenantContext.contract?.rent_amount}
                    </Text>
                    <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                      Expires:{' '}
                      {tenantContext.contract?.end_date
                        ? new Date(tenantContext.contract.end_date).toLocaleDateString()
                        : 'N/A'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Button
                      mode="contained"
                      buttonColor={colors.success}
                      textColor={colors.onPrimary}
                      onPress={() => setMpesaPaymentModalVisible(true)}
                      icon="cellphone-nfc"
                      contentStyle={{ paddingHorizontal: 4 }}
                      labelStyle={{ fontSize: 12, marginHorizontal: 4 }}
                      compact
                    >
                      {isKE ? 'Pay via M-Pesa' : 'Pay via Mpesa'}
                    </Button>
                  </View>
                </Surface>
              </View>
            )}

            {tenantContext?.receipts && tenantContext.receipts.length > 0 && (
              <View style={{ marginTop: 16 }}>
                <Text variant="titleMedium" style={{ marginBottom: 8 }}>
                  My Recent Payments
                </Text>
                {tenantContext.receipts.map((r: any) => (
                  <SPressable
                    key={r.id}
                    onPress={() => router.push(`/receipts/view/${r.id}`)}
                  >
                    <Surface
                      style={[
                        styles.transaction,
                        { backgroundColor: colors.surface, marginBottom: 8 },
                      ]}
                      elevation={1}
                    >
                      <View>
                        <Text variant="labelLarge">Rent Payment</Text>
                        <Text variant="bodySmall">
                          {new Date(r.payment_date).toLocaleDateString()}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ color: colors.success, fontWeight: 'bold' }}>
                          {defaultCurrency
                            ? formatWithCurrency(parseFloat(r.amount), defaultCurrency)
                            : r.amount}
                        </Text>
                        <MaterialCommunityIcons
                          name="chevron-right"
                          size={20}
                          color={colors.onSurfaceVariant}
                          style={{ marginLeft: 4 }}
                        />
                      </View>
                    </Surface>
                  </SPressable>
                ))}
              </View>
            )}
          </View>
        </View>
      )}

      {tenantContext?.contract && (
        <MpesaPaymentModal
          visible={mpesaPaymentModalVisible}
          onDismiss={() => setMpesaPaymentModalVisible(false)}
          pendingAmount={parseFloat(String(tenantContext.contract.rent_amount)) || 0}
          contractId={tenantContext.contract.id}
          tenantId={tenantContext.contract.tenant_id || ''}
          businessId={selectedBusiness?.id || ''}
          tenantName={profile?.name || user?.email || 'Tenant'}
          initialPhone={profile?.phone || ''}
        />
      )}

      {isAdmin && (
        <View style={{ padding: 10 }}>
          <View style={styles.statsGrid}>
            <StatCard
              title="Total Rooms"
              value={stats.totalRooms}
              icon="office-building"
              color={colors.primary}
            />
            <StatCard
              title="Occupancy Rate"
              value={`${stats.occupancyRate.toFixed(1)}%`}
              icon="chart-pie"
              subtitle={`${stats.occupiedRooms}/${stats.totalRooms} rooms`}
              color={colors.secondary}
            />
            <StatCard
              title="Current Month"
              value={
                defaultCurrency
                  ? formatWithCurrency(stats.monthlyRevenue, defaultCurrency)
                  : '...'
              }
              icon="cash-multiple"
              subtitle={`${stats.revenueGrowth >= 0 ? '+' : ''}${stats.revenueGrowth.toFixed(1)}% vs last month`}
              color={colors.success}
            />
            <StatCard
              title="Annual Revenue"
              value={
                defaultCurrency
                  ? formatWithCurrency(stats.annualRevenue, defaultCurrency)
                  : '...'
              }
              icon="calendar"
              subtitle={`Year ${new Date().getFullYear()}`}
              color={colors.primary}
            />
            <StatCard
              title="Expected Revenue"
              value={
                defaultCurrency
                  ? formatWithCurrency(stats.projectedRevenue, defaultCurrency)
                  : '...'
              }
              icon="trending-up"
              subtitle={`Collection: ${stats.rentCollectionRate.toFixed(1)}%`}
              color={colors.warning}
            />
            <StatCard
              title="Active Tenants"
              value={stats.activeTenants}
              icon="account-group"
              subtitle={`Out of ${stats.totalTenants} total`}
              color={colors.info}
            />
            <StatCard
              title="Monthly Expenses"
              value={
                defaultCurrency
                  ? formatWithCurrency(stats.monthlyExpenses, defaultCurrency)
                  : '...'
              }
              icon="cash-remove"
              subtitle={`${stats.expenseGrowth >= 0 ? '+' : ''}${stats.expenseGrowth.toFixed(1)}% vs last month`}
              color={colors.primary}
            />
            <StatCard
              title="Annual Expenses"
              value={
                defaultCurrency
                  ? formatWithCurrency(stats.annualExpenses, defaultCurrency)
                  : '...'
              }
              icon="bank"
              subtitle={`Year ${new Date().getFullYear()}`}
              color={colors.secondary}
            />
            <StatCard
              title="Net Income"
              value={
                defaultCurrency
                  ? formatWithCurrency(
                      stats.annualRevenue - stats.annualExpenses,
                      defaultCurrency,
                    )
                  : '...'
              }
              icon="wallet"
              subtitle={`Year ${new Date().getFullYear()}`}
              color={colors.success}
            />
            <StatCard
              title="Expiring Soon"
              value={stats.expiringContracts}
              icon="timer-outline"
              subtitle="Next 30 days"
              color={colors.warning}
            />
          </View>
        </View>
      )}

      {isAdmin && dashboardPreferences.show_insights && (
        <InsightsCard insights={insights} onAction={handleInsightAction} />
      )}

      <View style={[styles.cardsContainer, { paddingHorizontal: 0 }]}>
        {isAdminOrStaff && (
          <>
            {dashboardPreferences.show_pending_rent && (
              <PendingRentCard
                loading={pendingRentLoading}
                tenants={pendingRentTenants}
                receipts={receipts}
                collapsedGroups={collapsedGroups}
                setCollapsedGroups={setCollapsedGroups}
                selectedMonthDate={selectedMonthDate}
                setSelectedMonthDate={setSelectedMonthDate}
                colors={colors}
                defaultCurrency={defaultCurrency}
              />
            )}
            {dashboardPreferences.show_waivers && (
              <WaiversCard
                loading={false}
                tenants={waiverTenants}
                collapsedGroups={waiverCollapsedGroups}
                setCollapsedGroups={setWaiverCollapsedGroups}
                selectedMonthDate={waiverSelectedMonthDate}
                setSelectedMonthDate={setWaiverSelectedMonthDate}
                isDark={isDark}
                colors={colors}
                defaultCurrency={defaultCurrency}
              />
            )}
            {dashboardPreferences.show_expenses_analysis && (
              <ExpensesAnalysisCard
                loading={false}
                expenses={expenses}
                selectedMonthDate={expensesSelectedMonth}
                setSelectedMonthDate={setExpensesSelectedMonth}
                colors={colors}
                defaultCurrency={defaultCurrency}
              />
            )}
            {dashboardPreferences.show_maintenance && (
              <MaintenanceOverviewCard
                loading={false}
                requests={maintenanceRequests}
                properties={properties}
                houses={houses}
                tenants={tenants}
                colors={colors}
              />
            )}
          </>
        )}

        {isAdmin && (
          <>
            {dashboardPreferences.show_daily_finance && (
              <DailyFinanceCard
                loading={false}
                receipts={receipts}
                paymentMessages={paymentMessages}
                paymentMessageReceipts={paymentMessageReceipts}
                tenants={tenants}
                houses={houses}
                contracts={contracts}
                properties={properties}
                selectedMonthDate={dailyFinanceSelectedMonth}
                setSelectedMonthDate={setDailyFinanceSelectedMonth}
                colors={colors}
                defaultCurrency={defaultCurrency}
              />
            )}
            {dashboardPreferences.show_expiring_contracts &&
              expiringContractsList.length > 0 && (
                <ExpiringContractsCard
                  loading={false}
                  contracts={expiringContractsList}
                  isDark={isDark}
                  colors={colors}
                />
              )}
            {dashboardPreferences.show_recent_activity && (
              <RecentActivityCard
                loading={false}
                receipts={receipts}
                expenses={expenses}
                tenants={tenants}
                tenantsById={tenantsById}
                collapsedGroups={activityCollapsedGroups}
                setCollapsedGroups={setActivityCollapsedGroups}
                selectedDate={recentActivityDate}
                setSelectedDate={setRecentActivityDate}
                isDark={isDark}
                colors={colors}
                defaultCurrency={defaultCurrency}
              />
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
};

export default Dashboard;

const styles = StyleSheet.create({
  container: { flex: 1 },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  transaction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    marginBottom: 8,
    borderRadius: 4,
    elevation: 1,
  },
  userInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 0,
    borderRadius: 8,
    width: '100%',
  },
  userDetails: { marginLeft: 12, flex: 1 },
  userName: { fontSize: 18, fontWeight: 'bold' },
  userEmail: { fontSize: 14, marginTop: 2 },
  userPhone: { fontSize: 14, marginTop: 2 },
  avatar: { width: 70, height: 70, borderRadius: 40 },
  avatarPlaceholder: {
    width: 70,
    height: 70,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { height: 20, justifyContent: 'center', marginBottom: 4 },
  cardsContainer: {
    gap: 16,
    paddingBottom: 24,
  },
});
