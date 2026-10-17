import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Card, IconButton, Menu, Portal, Text, TextInput } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import DiffViewer from '@/shared/components/DiffViewer';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import SectionGroup from '@/shared/components/SectionGroup';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import {
  useBookings,
  useContracts,
  useCoreMutations,
  useHouses,
  useStoreRefresh,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { sendBookingApprovalNotification } from '@/shared/services/emailService';
import { formatDateForDB } from '@/shared/utils/formatters';
import { generateUUID, toLowerCase } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import BookingDetailsModal from './BookingDetailsModal';
import BookingModal from './BookingModal';

const STATUS_CONFIG: Record<string, { label: string; subtitle: string }> = {
  pending: {
    label: 'Pending',
    subtitle: 'New requests awaiting review',
  },
  approved: {
    label: 'Approved',
    subtitle: 'Approved requests awaiting reservation or conversion',
  },
  rejected: {
    label: 'Rejected',
    subtitle: 'Requests that have been declined',
  },
  converted: {
    label: 'Converted',
    subtitle: 'Bookings already moved to active contracts',
  },
  reserved: {
    label: 'Reserved',
    subtitle: 'Units held with a commitment',
  },
};

interface BookingsListModalProps {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
}

export default function BookingsListModal({
  visible,
  onDismiss,
  title = 'Booking Requests',
}: BookingsListModalProps) {
  const { user } = useAuth();
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const { can } = useAccessControl();
  const { showSnackbar } = useSnackbar();

  const allBookings = useBookings(selectedBusiness?.id);
  const tenants = useTenants(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const contracts = useContracts(selectedBusiness?.id);
  const {
    batch: coreBatch,
    insert: coreInsert,
    update: coreUpdate,
    delete: coreDelete,
  } = useCoreMutations();
  const { refreshing, onRefresh } = useStoreRefresh();

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(
    new Set(['pending']),
  );
  const [menuVisible, setMenuVisible] = useState<string | null>(null);

  // Sub-modal states
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [actionDialogVisible, setActionDialogVisible] = useState(false);
  const [actionType, setActionType] = useState<string | null>(null);
  const [rejectionNotes, setRejectionNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Conversion / Sync states
  const [syncDialogVisible, setSyncDialogVisible] = useState(false);
  const [updateComparison, setUpdateComparison] = useState<any>(null);
  const [isSyncMode, setIsSyncMode] = useState(false);
  const [directConvertDialogVisible, setDirectConvertDialogVisible] = useState(false);
  const [directConvertLoading, setDirectConvertLoading] = useState(false);

  const filteredBookings = useMemo(() => {
    return allBookings
      .filter(b => {
        const matchesSearch =
          !searchQuery ||
          toLowerCase(b.name || '').includes(toLowerCase(searchQuery)) ||
          toLowerCase(b.phone || '').includes(toLowerCase(searchQuery)) ||
          toLowerCase(b.email || '').includes(toLowerCase(searchQuery));
        const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
        return matchesSearch && matchesStatus;
      })
      .sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
      );
  }, [allBookings, searchQuery, statusFilter]);

  const sections = useMemo(() => {
    const groups: Record<string, any[]> = {};
    filteredBookings.forEach(b => {
      const status = b.status || 'pending';
      if (!groups[status]) groups[status] = [];
      groups[status].push(b);
    });

    const order = ['pending', 'approved', 'reserved', 'converted', 'rejected'];
    return order
      .filter(s => groups[s])
      .map(s => ({
        title: STATUS_CONFIG[s]?.label || s,
        status: s,
        data: expandedStatuses.has(s) ? groups[s] : [],
        count: groups[s].length,
      }));
  }, [filteredBookings, expandedStatuses]);

  const createContractForBooking = async (request: any, tenantId: string) => {
    if (!selectedBusiness?.id) return;

    const houseId = request.house_id;
    if (!houseId) return;

    const hasContractForHouse = contracts.some(
      (c: any) =>
        c.tenant_id === tenantId &&
        c.house_id === houseId &&
        isActiveContractStatus(c.status),
    );

    if (hasContractForHouse) return;

    const house = houses.find((h: any) => h.id === houseId);
    if (!house) return;

    const now = new Date();
    const startDate = formatDateForDB(now);
    const endDate = new Date(now);
    endDate.setFullYear(endDate.getFullYear() + 1);
    const endDateStr = formatDateForDB(endDate);

    const newContractId = generateUUID();
    const contractData = {
      id: newContractId,
      tenant_id: tenantId,
      house_id: houseId,
      rent_amount: house.monthly_rent || 0,
      start_date: startDate,
      end_date: endDateStr,
      status: 'active',
      business_id: selectedBusiness.id,
      user_id: request.user_id || null,
    };

    await coreBatch([
      {
        tableName: 'contracts',
        operation: 'INSERT',
        payload: contractData,
      },
      {
        tableName: 'houses',
        operation: 'UPDATE',
        rowId: houseId,
        payload: { status: 'occupied' },
      },
    ]);
  };

  const handleAction = async () => {
    if (!selectedBooking || !actionType) return;
    try {
      setActionLoading(true);

      if (actionType === 'delete') {
        if (coreDelete) {
          await coreDelete('bookings', selectedBooking.id);
        }
        showSnackbar('Booking deleted successfully', 'success');
        return;
      }

      const statusMap: any = {
        approve: 'approved',
        reject: 'rejected',
        convert: 'converted',
      };
      const newStatus = statusMap[actionType] || actionType;

      const review = {
        status: newStatus,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user?.email || 'Admin',
        action_type: actionType,
        review_notes: actionType === 'reject' ? rejectionNotes : '',
      };

      let currentMetadata = selectedBooking.metadata || {};
      if (typeof currentMetadata === 'string') {
        try {
          currentMetadata = JSON.parse(currentMetadata);
        } catch {
          currentMetadata = {};
        }
      }
      const reviews = [...(currentMetadata.reviews || []), review];

      if (coreUpdate) {
        await coreUpdate('bookings', selectedBooking.id, {
          status: newStatus,
          metadata: { ...currentMetadata, reviews },
        });
      }

      if (actionType === 'approve' && selectedBooking.email && selectedBusiness) {
        await sendBookingApprovalNotification(selectedBooking, selectedBusiness as any);
      }

      if (actionType === 'convert' && selectedBooking.converted_tenant_id) {
        await createContractForBooking(
          selectedBooking,
          selectedBooking.converted_tenant_id,
        );
      }

      showSnackbar(`Booking ${newStatus} successfully`, 'success');
    } catch (e: any) {
      showSnackbar(e.message, 'error');
    } finally {
      setActionLoading(false);
      setActionDialogVisible(false);
      setRejectionNotes('');
    }
  };

  const handleDirectConvert = async () => {
    if (!selectedBooking) return;
    try {
      setDirectConvertLoading(true);

      let parsedNextOfKin = selectedBooking.next_of_kin || [];
      if (typeof parsedNextOfKin === 'string') {
        try {
          parsedNextOfKin = JSON.parse(parsedNextOfKin);
        } catch {
          parsedNextOfKin = [];
        }
      }

      const newTenantId = generateUUID();
      const tenantData = {
        id: newTenantId,
        name: selectedBooking.name || '',
        phone: selectedBooking.phone || '',
        email: selectedBooking.email || null,
        address: selectedBooking.address || '',
        gender: selectedBooking.gender || 'other',
        marital_status: selectedBooking.marital_status || 'single',
        nationality: selectedBooking.nationality || 'Unknown',
        next_of_kin: parsedNextOfKin,
        business_id: selectedBusiness?.id || '',
        user_id: selectedBooking.user_id || user?.id || '',
        status: 'active',
      };

      // Create tenant using local-lite
      await coreInsert('tenants', tenantData);

      const review = {
        status: 'converted',
        reviewed_at: new Date().toISOString(),
        reviewed_by: user?.email || 'Admin',
        action_type: 'convert',
        review_notes: 'Converted directly from booking',
      };

      let currentMetadata = selectedBooking.metadata || {};
      if (typeof currentMetadata === 'string') {
        try {
          currentMetadata = JSON.parse(currentMetadata);
        } catch {
          currentMetadata = {};
        }
      }
      const reviews = [...(currentMetadata.reviews || []), review];

      // Simulate network delay for tenant creation to show overlay and allow it to enter sync queue first
      await new Promise(resolve => setTimeout(resolve, 1500));

      if (coreUpdate) {
        await coreUpdate('bookings', selectedBooking.id, {
          status: 'converted',
          converted_tenant_id: newTenantId,
          metadata: { ...currentMetadata, reviews },
        });
      }

      if (selectedBooking.house_id) {
        await createContractForBooking(selectedBooking, newTenantId);
      }

      // Simulate a small delay for finishing up
      await new Promise(resolve => setTimeout(resolve, 800));

      showSnackbar('Tenant created directly from booking', 'success');
    } catch (e: any) {
      showSnackbar(e.message || 'Failed to convert booking', 'error');
    } finally {
      setDirectConvertLoading(false);
      setDirectConvertDialogVisible(false);
    }
  };

  const compareData = (booking: any, tenant: any) => {
    const fields = [
      'name',
      'phone',
      'email',
      'address',
      'gender',
      'marital_status',
      'nationality',
      'next_of_kin',
    ];
    const differences: any[] = [];

    const normalize = (val: any) => {
      if (val === null || val === undefined) return '';
      return String(val).trim();
    };

    const parseIfNeeded = (val: any) => {
      if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) {
        try {
          return JSON.parse(val);
        } catch {
          return val;
        }
      }
      return val;
    };

    fields.forEach(f => {
      const bValue = (booking as any)[f];
      const tValue = (tenant as any)[f];

      // Deep compare for next_of_kin array
      if (f === 'next_of_kin') {
        const bParsed = parseIfNeeded(bValue);
        const tParsed = parseIfNeeded(tValue);
        const bKin = Array.isArray(bParsed) ? JSON.stringify(bParsed) : '[]';
        const tKin = Array.isArray(tParsed) ? JSON.stringify(tParsed) : '[]';
        if (bKin !== tKin) {
          differences.push({
            field: f,
            label: 'Next of Kin',
            booking: bParsed,
            tenant: tParsed,
          });
        }
        return;
      }

      if (toLowerCase(normalize(bValue)) !== toLowerCase(normalize(tValue))) {
        differences.push({
          field: f,
          label: f.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
          booking: bValue,
          tenant: tValue,
        });
      }
    });
    return differences;
  };

  const handleSyncInitiate = (booking: any, mode: 'sync' | 'convert') => {
    const tenant = tenants.find(t => t.id === booking.converted_tenant_id);
    if (!tenant && mode === 'sync') {
      showSnackbar('Linked tenant not found', 'error');
      return;
    }

    // If convert mode, we might want to find if a tenant with same email/phone exists
    let existingTenant = tenant;
    if (!existingTenant) {
      existingTenant = tenants.find(
        t => t.email === booking.email || t.phone === booking.phone,
      );
    }

    if (existingTenant) {
      const diffs = compareData(booking, existingTenant);
      if (diffs.length === 0) {
        showSnackbar('Booking and Tenant data are already in sync', 'info');
        return;
      }
      setUpdateComparison({ booking, tenant: existingTenant, differences: diffs });
      setIsSyncMode(mode === 'sync');
      setSyncDialogVisible(true);
    } else if (mode === 'convert') {
      // Just convert if no existing tenant found (standard flow would create new tenant)
      // For simplicity in this modal, we'll assume the user uses the full screen for complex conversion
      // or we can implement the basic conversion here.
      showSnackbar(
        'No existing tenant found. Use full screen for new tenant creation.',
        'info',
      );
    }
  };

  const handleSyncConfirm = async (direction: 'to_tenant' | 'to_booking') => {
    if (!updateComparison) return;
    try {
      setActionLoading(true);
      const { booking, tenant, differences } = updateComparison;

      if (direction === 'to_tenant') {
        const updates: any = {};
        for (const d of differences) {
          updates[d.field] = d.booking;
        }
        if (coreUpdate) {
          await coreUpdate('tenants', tenant.id, updates);
        }
        showSnackbar('Tenant updated from booking data', 'success');
      } else {
        const updates: any = {};
        for (const d of differences) {
          updates[d.field] = d.tenant;
        }
        if (coreUpdate) {
          await coreUpdate('bookings', booking.id, updates);
        }
        showSnackbar('Booking updated from tenant data', 'success');
      }
    } catch (e: any) {
      showSnackbar(e.message, 'error');
    } finally {
      setActionLoading(false);
      setSyncDialogVisible(false);
    }
  };

  const renderSectionHeader = ({ section }: any) => (
    <SectionGroup
      title={`${section.title} (${section.count})`}
      subtitle={STATUS_CONFIG[section.status]?.subtitle}
      isExpanded={expandedStatuses.has(section.status)}
      onToggle={() => {
        setExpandedStatuses(prev => {
          const next = new Set(prev);
          if (next.has(section.status)) next.delete(section.status);
          else next.add(section.status);
          return next;
        });
      }}
    />
  );

  const renderItem = ({ item }: any) => (
    <Card style={styles.itemCard} mode="outlined">
      <Card.Content style={[styles.itemContent, { alignItems: 'flex-start' }]}>
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
            {item.name}
          </Text>

          <View
            style={{
              flexDirection: 'column',
              marginTop: 8,
              alignItems: 'flex-start',
              gap: 4,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialCommunityIcons
                name="phone-outline"
                size={14}
                color={colors.onSurfaceVariant}
              />
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                {item.phone}
              </Text>
            </View>
            {item.email && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MaterialCommunityIcons
                  name="email-outline"
                  size={14}
                  color={colors.onSurfaceVariant}
                />
                <Text
                  variant="bodySmall"
                  style={{ color: colors.onSurfaceVariant }}
                  numberOfLines={1}
                >
                  {item.email}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View
          style={{
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            alignSelf: 'stretch',
          }}
        >
          <Menu
            visible={menuVisible === item.id}
            onDismiss={() => setMenuVisible(null)}
            anchor={
              <IconButton
                icon="dots-vertical"
                onPress={() => setMenuVisible(item.id)}
                style={{ margin: 0, marginRight: 0, marginTop: -8 }}
              />
            }
          >
            <Menu.Item
              onPress={() => {
                setMenuVisible(null);
                setSelectedBooking(item);
                setDetailsVisible(true);
              }}
              title="View Booking"
              leadingIcon="eye"
            />
            {can('edit', 'booking') && (
              <Menu.Item
                onPress={() => {
                  setMenuVisible(null);
                  setSelectedBooking(item);
                  setEditVisible(true);
                }}
                title="Edit Booking"
                leadingIcon="pencil"
              />
            )}
            {item.status === 'pending' && can('edit', 'booking') && (
              <>
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(null);
                    setSelectedBooking(item);
                    setActionType('approve');
                    setActionDialogVisible(true);
                  }}
                  title="Approve Booking"
                  leadingIcon="check"
                />
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(null);
                    setSelectedBooking(item);
                    setActionType('reject');
                    setActionDialogVisible(true);
                  }}
                  title="Reject Booking"
                  leadingIcon="close"
                />
              </>
            )}
            {item.status === 'approved' && can('create', 'tenant') && (
              <Menu.Item
                onPress={() => {
                  setMenuVisible(null);
                  setSelectedBooking(item);
                  setDirectConvertDialogVisible(true);
                }}
                title="Convert to Tenant"
                leadingIcon="account-convert"
              />
            )}
            {item.status === 'converted' && can('edit', 'booking') && (
              <Menu.Item
                onPress={() => {
                  setMenuVisible(null);
                  handleSyncInitiate(item, 'sync');
                }}
                title="Sync Booking"
                leadingIcon="sync"
              />
            )}
            {can('delete', 'booking') && (
              <Menu.Item
                onPress={() => {
                  setMenuVisible(null);
                  setSelectedBooking(item);
                  setActionType('delete');
                  setActionDialogVisible(true);
                }}
                title="Delete Booking"
                leadingIcon="delete"
                titleStyle={{ color: colors.error }}
              />
            )}
          </Menu>

          {item.status === 'converted' && (
            <MaterialCommunityIcons
              name="check-decagram"
              size={20}
              color={colors.primary}
              style={{ marginRight: 12, marginBottom: -4 }}
            />
          )}
        </View>
      </Card.Content>
    </Card>
  );

  return (
    <Portal>
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title={title}
        subtitle="Manage Property Bookings"
        edgeToEdge
        maxHeight="80%"
        scrollable={false}
        search={
          showSearch
            ? {
                placeholder: 'Search bookings...',
                value: searchQuery,
                onChangeText: setSearchQuery,
                onClear: () => setSearchQuery(''),
              }
            : null
        }
        headerRight={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton
              icon={showSearch ? 'magnify-minus' : 'magnify'}
              onPress={() => {
                if (showSearch) setSearchQuery('');
                setShowSearch(!showSearch);
              }}
              size={26}
            />
            {can('create', 'booking') && (
              <IconButton
                icon="plus"
                onPress={() => {
                  setSelectedBooking(null);
                  setEditVisible(true);
                }}
                size={26}
              />
            )}
          </View>
        }
      >
        <View style={styles.container}>
          <FilterButtons
            options={[
              { label: 'All', value: 'all', icon: 'layers' },
              { label: 'Pending', value: 'pending', icon: 'clock-outline' },
              { label: 'Approved', value: 'approved', icon: 'check-circle' },
              { label: 'Converted', value: 'converted', icon: 'account-check' },
            ]}
            selectedValue={statusFilter}
            onValueChange={value => setStatusFilter(value || 'all')}
          />

          <SectionList
            sections={sections}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            renderSectionHeader={renderSectionHeader}
            contentContainerStyle={{ paddingBottom: 20, flexGrow: 1 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            stickySectionHeadersEnabled={true}
            ListEmptyComponent={
              <EmptyState icon="calendar-blank" title="No bookings found" />
            }
          />
        </View>

        {/* Sub-Modals */}
        <BookingDetailsModal
          visible={detailsVisible}
          onDismiss={() => setDetailsVisible(false)}
          bookingId={selectedBooking?.id}
          businessId={selectedBusiness?.id}
        />

        <BookingModal
          visible={editVisible}
          onDismiss={() => setEditVisible(false)}
          bookingToEdit={selectedBooking}
          businessId={selectedBusiness?.id}
        />

        {/* Action Confirmation Modal */}
        <BaseModal
          visible={actionDialogVisible}
          onDismiss={() => setActionDialogVisible(false)}
          title={
            actionType === 'delete'
              ? 'Delete Booking'
              : actionType === 'reject'
                ? 'Reject Request'
                : 'Confirm Action'
          }
          mode="confirm"
          onConfirm={handleAction}
          loading={actionLoading}
          destructive={actionType === 'reject' || actionType === 'delete'}
          confirmText={actionType === 'delete' ? 'Delete' : 'Confirm'}
        >
          <Text>
            {actionType === 'delete'
              ? `Are you sure you want to permanently delete the booking for ${selectedBooking?.name}? This action cannot be undone.`
              : `Are you sure you want to ${actionType} this booking for ${selectedBooking?.name}?`}
          </Text>
          {actionType === 'reject' && (
            <TextInput
              label="Rejection Notes"
              value={rejectionNotes}
              onChangeText={setRejectionNotes}
              multiline
              numberOfLines={3}
              style={{ marginTop: 16 }}
              mode="outlined"
            />
          )}
        </BaseModal>

        {/* Sync Comparison Modal */}
        <BaseModal
          visible={syncDialogVisible}
          onDismiss={() => setSyncDialogVisible(false)}
          title={isSyncMode ? 'Data Sync Comparison' : 'Convert & Sync Booking'}
          subtitle="Network and sync status"
          scrollable={true}
          actions={[
            {
              label: 'Update Tenant',
              onPress: () => handleSyncConfirm('to_tenant'),
              mode: 'contained',
              icon: 'arrow-right-bold',
            },
            {
              label: 'Update Booking',
              onPress: () => handleSyncConfirm('to_booking'),
              mode: 'outlined',
              icon: 'arrow-left-bold',
            },
          ]}
        >
          <Text variant="bodySmall" style={{ marginBottom: 12 }}>
            Differences found between booking and tenant records.
          </Text>
          <DiffViewer differences={updateComparison?.differences || []} />
        </BaseModal>

        <BaseModal
          visible={directConvertDialogVisible}
          onDismiss={() => setDirectConvertDialogVisible(false)}
          title="Convert to Tenant"
          mode="confirm"
          onConfirm={handleDirectConvert}
          loading={directConvertLoading}
          confirmText="Convert & Save"
        >
          <Text variant="bodyMedium" style={{ marginBottom: 12 }}>
            A new tenant record will be created directly from this booking with the
            following data:
          </Text>
          <View
            style={{
              gap: 8,
              padding: 12,
              backgroundColor: colors.surfaceVariant,
              borderRadius: 8,
            }}
          >
            <Text>
              Name: <Text style={{ fontWeight: 'bold' }}>{selectedBooking?.name}</Text>
            </Text>
            <Text>
              Phone: <Text style={{ fontWeight: 'bold' }}>{selectedBooking?.phone}</Text>
            </Text>
            {selectedBooking?.email && (
              <Text>
                Email:{' '}
                <Text style={{ fontWeight: 'bold' }}>{selectedBooking?.email}</Text>
              </Text>
            )}
            {selectedBooking?.address && (
              <Text>
                Address:{' '}
                <Text style={{ fontWeight: 'bold' }}>{selectedBooking?.address}</Text>
              </Text>
            )}
          </View>
        </BaseModal>
      </BaseModal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  itemCard: {
    marginVertical: 6,
    marginHorizontal: 16,
    paddingHorizontal: 4,
    borderRadius: 16,
  },
  itemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
});
