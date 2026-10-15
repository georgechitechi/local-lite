const setExpenseModalVisible = (value: UIState['expenseModalVisible']) =>
  setUIField('expenseModalVisible', value);
const setExpenseModalInitialData = (value: UIState['expenseModalInitialData']) =>
  setUIField('expenseModalInitialData', value);

import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Divider, IconButton, Menu, Portal, Surface, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import BaseSearch from '@/shared/components/BaseSearch';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import LoadingCard from '@/shared/components/LoadingCard';
import SectionGroup from '@/shared/components/SectionGroup';
import SPressable from '@/shared/components/SlightPressable';
import StatusUpdateModal from '@/shared/components/StatusUpdateModal';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useCurrency } from '@/shared/hooks/useCurrency';
import {
  useContracts,
  useCoreMutations,
  useExpensesById,
  useHousesById,
  useMaintenanceRequests,
  usePropertiesById,
  useStoreRefresh,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { sendNotification } from '@/shared/services/notifications';
import { formatWithCurrency } from '@/shared/utils/formatters';
import { addOpacity, snakeCaseToTitleCase } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import { setUIField, type UIState } from '@/stores/uiStore';

interface MaintenanceRequest {
  id: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  property_id: string | null;
  house_id: string | null;
  affected_houses: string[] | null;
  tenant_id: string | null;
  images: string[] | null;
  expense_id: string | null;
  event_date: string | null;
  houseNumber?: string;
  tenantName?: string;
  propertyName?: string;
  affectedHousesData?: any[];
  expenseAmount?: number;
}

interface MaintenanceSection {
  title: string;
  status: string;
  data: MaintenanceRequest[];
}

export default function MaintenanceScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const { userRoles, tenantId, loading: accessLoading, can } = useAccessControl();
  const { showSnackbar } = useSnackbar();
  const isAdmin = userRoles.includes('admin');
  const isStaff = userRoles.includes('staff');
  const isTenant = userRoles.includes('tenant') && !isStaff;
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'pending' | 'in_progress' | 'completed' | 'cancelled'
  >('all');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['pending', 'in_progress']),
  );
  const [visibleMenuId, setVisibleMenuId] = useState<string | null>(null);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [selectedMaintenance, setSelectedMaintenance] =
    useState<MaintenanceRequest | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  const { update } = useCoreMutations();
  const maintenanceRequests = useMaintenanceRequests(selectedBusiness?.id);
  const contracts = useContracts(selectedBusiness?.id);

  const housesById = useHousesById(selectedBusiness?.id);
  const propertiesById = usePropertiesById(selectedBusiness?.id);
  const expensesById = useExpensesById(selectedBusiness?.id);

  const { refreshing, onRefresh } = useStoreRefresh();

  const requests = useMemo(() => {
    if (!maintenanceRequests) return [];
    const allMapped = maintenanceRequests.map(req => {
      const house = req.house_id ? housesById.get(req.house_id) : undefined;
      const property = req.property_id ? propertiesById.get(req.property_id) : undefined;
      const expense = req.expense_id ? expensesById.get(req.expense_id) : undefined;

      const affectedHousesList = req.affected_houses
        ? req.affected_houses
            .map((houseId: string) => housesById.get(houseId))
            .filter((h: any) => h !== undefined)
        : [];

      return {
        ...req,
        houseNumber: house?.house_number || 'N/A',
        propertyName: property?.name || 'N/A',
        affectedHousesData: affectedHousesList,
        expenseAmount: expense ? Number(expense.amount) : undefined,
      };
    });

    if (isTenant) {
      if (!tenantId) return [];

      const tenantContract = contracts.find(
        c => c.tenant_id === tenantId && isActiveContractStatus(c.status),
      );
      const tenantHouseId = tenantContract?.house_id;
      const tenantPropertyId = tenantHouseId
        ? housesById.get(tenantHouseId)?.property_id
        : undefined;

      return allMapped.filter(req => {
        if (req.tenant_id === tenantId) return true;
        if (tenantPropertyId && req.property_id === tenantPropertyId) {
          const isPropertyWide =
            !req.house_id && (!req.affected_houses || req.affected_houses.length === 0);
          if (isPropertyWide) return true;
        }
        return false;
      });
    }

    return allMapped;
  }, [
    maintenanceRequests,
    housesById,
    propertiesById,
    expensesById,
    isTenant,
    tenantId,
    contracts,
  ]);

  const statusItems = useMemo(
    () => [
      {
        id: 'pending',
        title: 'Pending',
        color: (colors as any).warning,
        disabled: selectedMaintenance?.status === 'pending',
      },
      {
        id: 'in_progress',
        title: 'In Progress',
        color: (colors as any).info,
        disabled: selectedMaintenance?.status === 'in_progress',
      },
      {
        id: 'completed',
        title: 'Completed',
        color: colors.success,
        disabled: selectedMaintenance?.status === 'completed',
      },
      {
        id: 'cancelled',
        title: 'Cancelled',
        color: colors.error,
        disabled: selectedMaintenance?.status === 'cancelled',
      },
    ],
    [selectedMaintenance, colors],
  );

  const sections = useMemo(() => {
    const filtered = requests.filter(req => {
      // Status Filter
      if (statusFilter !== 'all' && req.status !== statusFilter) return false;

      // Search Filter
      const searchLower = searchQuery.toLowerCase();
      return (
        req.description?.toLowerCase().includes(searchLower) ||
        req.houseNumber.toLowerCase().includes(searchLower)
      );
    });

    // Group by status
    const grouped: Record<string, MaintenanceRequest[]> = {};
    filtered.forEach(req => {
      const status = req.status || 'pending';
      if (!grouped[status]) {
        grouped[status] = [];
      }
      grouped[status].push(req as unknown as MaintenanceRequest);
    });

    // Define status order
    const statusOrder = ['pending', 'in_progress', 'completed', 'cancelled'];

    // Convert to sections array
    return statusOrder
      .filter(status => grouped[status] && grouped[status].length > 0)
      .map(status => ({
        title: snakeCaseToTitleCase(status),
        status: status,
        data: grouped[status].sort((a, b) => {
          const timeA = new Date(a.event_date || Date.now()).getTime();
          const timeB = new Date(b.event_date || Date.now()).getTime();
          return timeB - timeA;
        }),
      }));
  }, [requests, searchQuery, statusFilter]);

  const getPriorityColor = useCallback(
    (priority: string) => {
      switch (priority) {
        case 'urgent':
          return colors.error;
        case 'high':
          return colors.warning;
        case 'medium':
          return colors.info;
        case 'low':
          return colors.outline;
        default:
          return colors.onSurfaceVariant;
      }
    },
    [colors],
  );
  const handleDelete = async () => {
    if (!can('delete', 'maintenance')) {
      showSnackbar('You do not have permission to delete requests', 'error');
      return;
    }
    if (!selectedMaintenance) return;
    try {
      setDeleteLoading(true);
      await update('maintenance_requests', selectedMaintenance.id, {
        deleted: 1,
        status: 'deleted',
      });
      setDeleteDialogVisible(false);
      setSelectedMaintenance(null);
      showSnackbar('Maintenance request deleted', 'success');
    } catch (error) {
      console.error('Delete error:', error);
      showSnackbar('Failed to delete request', 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleUpdateStatus = async (newStatus: string) => {
    if (!selectedMaintenance || statusLoading) return;
    setStatusLoading(true);
    try {
      await update('maintenance_requests', selectedMaintenance.id, {
        status: newStatus as any,
      });

      sendNotification(
        'Maintenance Request Updated',
        `The status of your maintenance request is now ${snakeCaseToTitleCase(newStatus)}.`,
        {
          type: 'maintenance',
          maintenanceId: selectedMaintenance.id,
          status: newStatus,
        },
      );
      setStatusModalVisible(false);
      setSelectedMaintenance(null);
      showSnackbar(`Status updated to ${snakeCaseToTitleCase(newStatus)}`, 'success');
    } catch (error) {
      console.error('Update error:', error);
      showSnackbar('Failed to update status', 'error');
    } finally {
      setStatusLoading(false);
    }
  };

  const handleConvertToExpense = useCallback((item: MaintenanceRequest) => {
    const scope = item.property_id
      ? 'Property'
      : item.affected_houses?.length
        ? 'Multi-House'
        : 'Single House';

    let target = item.propertyName !== 'N/A' ? item.propertyName : '';
    if (item.houseNumber !== 'N/A') {
      target += target ? ` - House ${item.houseNumber}` : `House ${item.houseNumber}`;
    }
    if (item.affected_houses?.length) {
      target += ` (${item.affected_houses.length} houses)`;
    }

    const detailedRemarks = [
      `Maintenance: ${item.description || 'N/A'}`,
      item.description ? `Details: ${item.description}` : null,
      `Scope: ${scope}`,
      target ? `Target: ${target}` : null,
      `Reference: ${item.id}`,
    ]
      .filter(Boolean)
      .join('\n');

    setExpenseModalInitialData({
      category: 'Maintenance',
      description: detailedRemarks,
      maintenanceId: item.id,
      houseId: item.house_id || undefined,
      propertyId: item.property_id || undefined,
    });
    setExpenseModalVisible(true);
  }, []);

  const renderSectionHeader = useCallback(
    ({ section }: { section: MaintenanceSection }) => {
      const isExpanded = expandedSections.has(section.status);

      const totalExpense = section.data.reduce(
        (sum, item) => sum + (item.expenseAmount || 0),
        0,
      );

      return (
        <SectionGroup
          title={snakeCaseToTitleCase(section.status)}
          subtitle={`Total Requests: ${section.data.length}${
            totalExpense > 0
              ? ` • Expenses: ${
                  defaultCurrency
                    ? formatWithCurrency(totalExpense, defaultCurrency)
                    : totalExpense
                }`
              : ' • No expenses recorded'
          }`}
          isExpanded={isExpanded}
          onToggle={() => {
            setExpandedSections(prev => {
              const next = new Set(prev);
              if (next.has(section.status)) {
                next.delete(section.status);
              } else {
                next.add(section.status);
              }
              return next;
            });
          }}
          containerStyle={styles.statusHeader}
          headerStyle={{ backgroundColor: colors.surface }}
        />
      );
    },
    [expandedSections, colors, defaultCurrency],
  );

  const renderItem = useCallback(
    ({ item, section }: { item: MaintenanceRequest; section: MaintenanceSection }) => {
      if (!expandedSections.has(section.status)) return null;

      const priorityColor = getPriorityColor(item.priority);

      return (
        <Surface
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
            },
          ]}
          elevation={1}
        >
          <SPressable
            onPress={() =>
              router.push({
                pathname: '/maintenance/view/[id]',
                params: { id: item.id },
              })
            }
          >
            <View style={styles.cardHeader}>
              <View style={styles.titleRow}>
                <View
                  style={[
                    styles.priorityBadge,
                    { backgroundColor: addOpacity(priorityColor, 0.15) },
                  ]}
                >
                  <Text style={[styles.priorityText, { color: priorityColor }]}>
                    {item.priority.toUpperCase()}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {isAdmin && (
                  <Menu
                    visible={visibleMenuId === item.id}
                    onDismiss={() => setVisibleMenuId(null)}
                    anchor={
                      <IconButton
                        icon="dots-vertical"
                        size={20}
                        onPress={() => setVisibleMenuId(item.id)}
                        style={{ margin: 0 }}
                      />
                    }
                  >
                    <Menu.Item
                      onPress={() => {
                        setVisibleMenuId(null);
                        setSelectedMaintenance(item);
                        setStatusModalVisible(true);
                      }}
                      title="Update Status"
                      leadingIcon="list-status"
                    />
                    <Menu.Item
                      onPress={() => {
                        setVisibleMenuId(null);
                        router.push({
                          pathname: '/maintenance/edit/[id]',
                          params: { id: item.id },
                        });
                      }}
                      title="Edit Request"
                      leadingIcon="pencil"
                    />
                    <Menu.Item
                      onPress={() => {
                        setVisibleMenuId(null);
                        handleConvertToExpense(item);
                      }}
                      title="Log Expense"
                      leadingIcon="currency-usd"
                    />
                    <Divider />
                    {can('delete', 'maintenance') && (
                      <Menu.Item
                        onPress={() => {
                          setVisibleMenuId(null);
                          setSelectedMaintenance(item);
                          setDeleteDialogVisible(true);
                        }}
                        title="Delete Request"
                        leadingIcon="delete"
                        titleStyle={{ color: colors.error }}
                      />
                    )}
                  </Menu>
                )}
              </View>
            </View>

            <View style={styles.cardContent}>
              {/* Property-wide maintenance */}
              {item.property_id && (
                <View style={styles.infoRow}>
                  <MaterialCommunityIcons
                    name="office-building"
                    size={18}
                    color={colors.primary}
                  />
                  <Text variant="bodyMedium" style={styles.infoText}>
                    {item.propertyName}
                  </Text>
                </View>
              )}

              {/* Multi-house maintenance */}
              {item.affected_houses && item.affected_houses.length > 0 && (
                <View style={styles.affectedHousesContainer}>
                  <View style={styles.infoRow}>
                    <MaterialCommunityIcons
                      name="home-group"
                      size={18}
                      color={colors.primary}
                    />
                    <Text variant="bodyMedium" style={styles.infoText}>
                      {item.affected_houses.length} Houses Affected
                    </Text>
                  </View>
                  <View style={styles.housesList}>
                    <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                      {item.affectedHousesData
                        ?.slice(0, 3)
                        .map((h: any) => `#${h.house_number}`)
                        .join(', ')}
                      {item.affected_houses &&
                        item.affected_houses.length > 3 &&
                        ` +${item.affected_houses.length - 3} more`}
                    </Text>
                  </View>
                </View>
              )}

              {/* Single house maintenance */}
              {item.house_id &&
                !item.property_id &&
                (!item.affected_houses || item.affected_houses.length === 0) && (
                  <View style={styles.infoRow}>
                    <MaterialCommunityIcons
                      name="home-variant"
                      size={18}
                      color={colors.primary}
                    />
                    <Text variant="bodyMedium" style={styles.infoText}>
                      House {item.houseNumber}
                    </Text>
                  </View>
                )}

              {item.description && (
                <Text
                  variant="bodyMedium"
                  numberOfLines={2}
                  style={[styles.descriptionText, { marginTop: 8 }]}
                >
                  {item.description}
                </Text>
              )}

              <View
                style={[styles.cardFooter, { borderTopColor: colors.outlineVariant }]}
              >
                {/* Left: Date & Images */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  <View style={styles.footerIconItem}>
                    <MaterialCommunityIcons
                      name="calendar-clock"
                      size={16}
                      color={colors.onSurfaceVariant}
                    />
                    <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                      {item.event_date
                        ? new Date(item.event_date).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : 'No date'}
                    </Text>
                  </View>
                  {item.images && item.images.length > 0 && (
                    <View style={styles.footerIconItem}>
                      <MaterialCommunityIcons
                        name="image-multiple-outline"
                        size={16}
                        color={colors.primary}
                      />
                      <Text
                        variant="bodySmall"
                        style={{ color: colors.primary, fontWeight: '600' }}
                      >
                        {item.images.length}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Right: Logged Status */}
                <View>
                  {item.expense_id ? (
                    <View style={styles.loggedBadge}>
                      <MaterialCommunityIcons
                        name="check-decagram"
                        size={14}
                        color={colors.success}
                      />
                      <Text style={styles.loggedText}>
                        {item.expenseAmount && defaultCurrency
                          ? formatWithCurrency(item.expenseAmount, defaultCurrency)
                          : 'Logged'}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.loggedBadge}>
                      <MaterialCommunityIcons
                        name="alert-circle-outline"
                        size={14}
                        color={colors.error}
                      />
                      <Text style={styles.loggedText}>Unlogged</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </SPressable>
        </Surface>
      );
    },
    [
      expandedSections,
      colors,
      visibleMenuId,
      isAdmin,
      can,
      router,
      handleConvertToExpense,
      defaultCurrency,
      getPriorityColor,
    ],
  );

  if (accessLoading) {
    return <LoadingCard iconName="tools" text="Loading maintenance..." />;
  }

  if (isTenant && !tenantId) {
    return (
      <EmptyState
        icon="account-lock-outline"
        title="Permission Denied"
        description="You do not have permission to view maintenance requests. Please contact your administrator to be assigned as a tenant."
        style={{ backgroundColor: colors.background }}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <BaseSearch
        placeholder="Search maintenance requests..."
        value={searchQuery}
        onChangeText={setSearchQuery}
        onClear={() => setSearchQuery('')}
        leftIcon={'magnify'}
        rightIcon={'close-circle'}
      />

      <View style={styles.filterContainer}>
        <FilterButtons
          options={[
            { label: 'All', value: 'all', icon: 'layers-outline' },
            { label: 'Pending', value: 'pending', icon: 'clock-outline' },
            { label: 'In Progress', value: 'in_progress', icon: 'progress-clock' },
            { label: 'Completed', value: 'completed', icon: 'check-circle' },
            { label: 'Cancelled', value: 'cancelled', icon: 'close-circle' },
          ]}
          selectedValue={statusFilter}
          onValueChange={val => setStatusFilter((val || 'all') as any)}
        />
      </View>

      <SectionList
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        sections={sections}
        extraData={{ requests, statusFilter, expandedSections }}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={true}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <EmptyState
            icon="tools"
            title="No Records"
            description="Try adjusting your filters or search terms"
          />
        }
      />
      <Portal>
        <BaseModal
          mode="confirm"
          visible={deleteDialogVisible}
          onDismiss={() => setDeleteDialogVisible(false)}
          onConfirm={handleDelete}
          title="Delete Request"
          message="Are you sure you want to delete this maintenance request?"
          confirmText="Delete"
          cancelText="Cancel"
          loading={deleteLoading}
          destructive={true}
        />

        <StatusUpdateModal
          visible={statusModalVisible}
          onDismiss={() => setStatusModalVisible(false)}
          title="Update Maintenance Status"
          subtitle={
            selectedMaintenance
              ? `Request: ${selectedMaintenance.description?.substring(0, 30)}...`
              : undefined
          }
          items={statusItems}
          onSelect={status => {
            handleUpdateStatus(status);
          }}
        />
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  statusHeader: {
    marginBottom: 1,
  },
  card: {
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  titleRow: {
    flex: 1,
  },
  priorityBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  priorityText: {
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  cardContent: {
    padding: 16,
    paddingTop: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  infoText: {
    fontWeight: '600',
  },
  affectedHousesContainer: {
    marginBottom: 8,
  },
  housesList: {
    marginLeft: 28,
    marginTop: 2,
  },
  descriptionText: {
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'transparent',
  },
  footerIconItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  loggedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  loggedText: {
    fontSize: 11,
    fontWeight: '700',
  },
  filterContainer: {
    paddingHorizontal: 2,
  },
});
