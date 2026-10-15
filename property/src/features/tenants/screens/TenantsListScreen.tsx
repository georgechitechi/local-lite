import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import * as Print from 'expo-print';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import type { BatchMutation } from 'local-lite';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Divider,
  IconButton,
  Menu,
  Portal,
  Surface,
  Text,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { generatePDFContent, processReportData } from '@/features/reports/utils';
import { updateTenantStatus } from '@/features/tenants/utils/tenantStatus';
import { useAuth } from '@/providers/AuthProvider';
import { useIdleLock } from '@/providers/LockScreenProvider';
import BaseModal from '@/shared/components/BaseModal';
import BaseSearch from '@/shared/components/BaseSearch';
import DiffViewer from '@/shared/components/DiffViewer';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import LoadingCard from '@/shared/components/LoadingCard';
import SectionGroup from '@/shared/components/SectionGroup';
import SPressable from '@/shared/components/SlightPressable';
import StatusUpdateModal from '@/shared/components/StatusUpdateModal';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import {
  useBookings,
  useContracts,
  useContractsByTenantId,
  useCoreMutations,
  useHouses,
  useHousesById,
  usePaymentMessageReceipts,
  usePaymentMessages,
  useProperties,
  usePropertiesById,
  useReceipts,
  useStoreRefresh,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { sendBookingApprovalNotification } from '@/shared/services/emailService';
import type {
  Booking as StoreBooking,
  Contract as StoreContract,
  Tenant as StoreTenant,
} from '@/shared/types/types';
import { generateUUID, properCase, toAllCaps, toLowerCase } from '@/shared/utils/helper';
import {
  isActiveContractStatus,
  resolveHouseStatusFromContracts,
} from '@/shared/utils/statusHelper';

interface NextOfKin {
  name?: string;
  phone?: string;
  email?: string;
  relationship?: string;
  [key: string]: any;
}

interface Tenant extends Omit<StoreTenant, 'next_of_kin' | 'contracts'> {
  propertyName?: string;
  houseNumber?: string;
  fullPropertyInfo?: string;
  contracts?: StoreContract[];
  convertedFromBooking?: StoreBooking[];
  next_of_kin?: NextOfKin[];
}

interface TenantSection {
  title: string;
  data: Tenant[];
  count: number;
}

interface UpdateComparison {
  tenant: Tenant;
  booking: any;
  differences: {
    field: string;
    label: string;
    booking: any;
    tenant: any;
  }[];
}

interface Booking extends StoreBooking {
  [key: string]: any;
}

export default function TenantsScreen() {
  const { user } = useAuth();

  const router = useRouter();
  const { filterIds } = useLocalSearchParams<{ filterIds?: string }>();
  const { selectedBusiness } = useBusiness();
  const { loading: accessLoading, can } = useAccessControl();
  const { showSnackbar } = useSnackbar();
  const { isOnline } = useOfflineCheck();
  const colors = useThemeColors();

  // Core Table Live Queries & Mutations (local-lite)
  const rawTenants = useTenants(selectedBusiness?.id);
  const contracts = useContracts(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const properties = useProperties(selectedBusiness?.id);
  const receipts = useReceipts(selectedBusiness?.id);
  const { batch, update, insert, delete: deleteRecord } = useCoreMutations();

  const contractsByTenantId = useContractsByTenantId(selectedBusiness?.id);
  const housesById = useHousesById(selectedBusiness?.id);
  const propertiesById = usePropertiesById(selectedBusiness?.id);

  const bookings = useBookings(selectedBusiness?.id);
  const paymentMessages = usePaymentMessages(selectedBusiness?.id);
  const paymentMessageReceipts = usePaymentMessageReceipts(selectedBusiness?.id);
  const { refreshing, onRefresh } = useStoreRefresh();

  const [searchQuery, setSearchQuery] = useState('');
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(
    new Set(['active', 'former', 'inactive', 'unknown']),
  );
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState<string | null>(null);
  const { pauseAutoLock } = useIdleLock();
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [convertDialogVisible, setConvertDialogVisible] = useState(false);
  const [convertLoading, setConvertLoading] = useState(false);
  const [duplicateTenantDialogVisible, setDuplicateTenantDialogVisible] = useState(false);
  const [duplicateTenants, setDuplicateTenants] = useState<Booking[]>([]);
  const [pendingBookingData, setPendingBookingData] = useState<any>(null);
  const [updateComparison, setUpdateComparison] = useState<UpdateComparison | null>(null);
  const [updatingTenant, setUpdatingTenant] = useState(false);
  const [isSyncMode, setIsSyncMode] = useState(false);
  const [statusUpdateVisible, setStatusUpdateVisible] = useState(false);
  const [updateStatusLoading, setUpdateStatusLoading] = useState(false);
  const [tempStatus, setTempStatus] = useState<string>('');
  const [selectedBooking, setSelectedBooking] = useState<StoreBooking | null>(null);
  const [bookingModalVisible, setBookingModalVisible] = useState(false);

  // Reactive Data Calculation
  const formattedTenants = useMemo(() => {
    // 1. Group bookings by tenant in O(n) upfront to avoid O(n^2) later
    const bookingsByTenantId = new Map<string, StoreBooking[]>();
    for (const b of bookings) {
      if (b.status === 'converted' && b.converted_tenant_id) {
        const existing = bookingsByTenantId.get(b.converted_tenant_id) || [];
        existing.push(b);
        bookingsByTenantId.set(b.converted_tenant_id, existing);
      }
    }

    return rawTenants.map(tenant => {
      // Find contracts for this tenant (O(1) lookup)
      const tenantContracts = contractsByTenantId.get(tenant.id) || [];
      const activeContract = tenantContracts.find((c: StoreContract) =>
        isActiveContractStatus(c.status),
      );

      // Find house/property info if active contract exists
      let houseNumber = 'Not assigned';
      let propertyName = 'Not assigned';
      let fullPropertyInfo = 'Not assigned';

      if (activeContract?.house_id) {
        const house = housesById.get(activeContract.house_id);
        if (house) {
          houseNumber = house.house_number || 'Not assigned';
          const property = house.property_id
            ? propertiesById.get(house.property_id)
            : undefined;
          if (property) {
            propertyName = property.name || 'Not assigned';
            fullPropertyInfo = `${propertyName} - Room ${houseNumber}`;
          }
        }
      }

      // Find linked booking (O(1) lookup)
      const linkedBookings = bookingsByTenantId.get(tenant.id) || [];

      return {
        ...tenant,
        contracts: tenantContracts,
        propertyName,
        houseNumber,
        fullPropertyInfo,
        convertedFromBooking: linkedBookings,
        next_of_kin: (tenant.next_of_kin as unknown as NextOfKin[]) || [],
        status: tenant.status || 'active', // Ensure status
      } as Tenant;
    });
  }, [rawTenants, contractsByTenantId, housesById, propertiesById, bookings]);

  const tenantStatusItems = useMemo(
    () => [
      {
        id: 'active',
        title: 'Active',
        color: (colors as any).success,
        disabled: selectedTenant?.status === 'active',
      },
      {
        id: 'former',
        title: 'Former',
        color: colors.primary,
        disabled: selectedTenant?.status === 'former',
      },
      {
        id: 'inactive',
        title: 'Inactive',
        color: colors.error,
        disabled: selectedTenant?.status === 'inactive',
      },
      {
        id: 'blacklisted',
        title: 'Blacklisted',
        color: colors.onSurface,
        disabled: selectedTenant?.status === 'blacklisted',
      },
    ],
    [selectedTenant, colors],
  );

  const handleTenantLedger = async (tenant: Tenant) => {
    try {
      setLedgerLoading(tenant.id);
      pauseAutoLock();

      const fullReportData = receipts
        .sort((a, b) => {
          const dateA = new Date(a.payment_date || 0).getTime();
          const dateB = new Date(b.payment_date || 0).getTime();
          return dateA - dateB;
        })
        .map(r => {
          const contract = contracts.find(c => c.id === r.contract_id);
          const house = houses.find(h => h.id === contract?.house_id);
          const linkedPmr = (paymentMessageReceipts || []).filter(
            pmr => pmr.receipt_id === r.id,
          );
          const msgs = linkedPmr
            .map(pmr =>
              (paymentMessages || []).find(pm => pm.id === pmr.payment_message_id),
            )
            .filter(Boolean);
          return {
            ...r,
            payment_messages: msgs,
            contract: {
              ...contract,
              tenant: rawTenants.find(t => t.id === contract?.tenant_id) || tenant,
              house: {
                ...house,
                property: properties.find(p => p.id === house?.property_id),
              },
            },
          };
        });

      const { data: processedData, headers } = processReportData(
        'tenant_ledger',
        fullReportData as any[],
        {
          tenantId: tenant.id,
          groupByStatus: false,
        },
      );

      if (
        !processedData ||
        processedData.length === 0 ||
        (processedData.length === 1 && (processedData[0] as any).message)
      ) {
        showSnackbar(`No ledger records found for ${tenant.name}`, 'info');
        return;
      }

      const htmlContent = generatePDFContent(
        processedData,
        'tenant_ledger',
        selectedBusiness as any,
        headers,
      );

      const { uri } = await Print.printToFileAsync({ html: htmlContent });

      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Tenant Ledger: ${tenant.name}`,
        UTI: 'com.adobe.pdf',
      });

      showSnackbar('Tenant Ledger shared successfully', 'success');
    } catch (error) {
      console.error('Error generating ledger:', error);
      showSnackbar('Failed to generate ledger', 'error');
    } finally {
      setLedgerLoading(null);
    }
  };

  const handleEditTenant = (tenant: Tenant) => {
    if (selectedBusiness) {
      router.push(`/tenants/edit/${tenant.id}`);
    }
  };

  const handleViewTenant = (tenant: Tenant) => {
    if (selectedBusiness) {
      router.push(`/tenants/view/${tenant.id}`);
    }
  };

  const handleViewBooking = (booking: StoreBooking) => {
    setSelectedBooking(booking);
    setBookingModalVisible(true);
  };

  const handleDeleteTenant = async () => {
    if (!can('delete', 'tenant')) {
      showSnackbar('You do not have permission to delete tenants', 'error');
      return;
    }

    if (!selectedTenant || !selectedBusiness) return;

    try {
      setDeleteLoading(true);

      const mutations: BatchMutation[] = [];

      // Step 1: Check for related receipts and delete them (they depend on contracts & tenants)
      const tenantReceipts = receipts.filter(r => r.tenant_id === selectedTenant.id);
      tenantReceipts.forEach(receipt => {
        mutations.push({
          tableName: 'receipts',
          operation: 'DELETE',
          rowId: receipt.id,
        });
      });

      // Step 2: Find all contracts and delete them, while updating house statuses
      const tenantContracts = contracts.filter(c => c.tenant_id === selectedTenant.id);

      if (tenantContracts.length > 0) {
        const houseIds = tenantContracts
          .map(c => c.house_id)
          .filter((hId): hId is string => !!hId);

        const deletedIds = new Set(tenantContracts.map(c => c.id));
        const contractsAfterUpdate = contracts.filter(c => !deletedIds.has(c.id));

        // Delete contracts via local-lite
        tenantContracts.forEach(contract => {
          mutations.push({
            tableName: 'contracts',
            operation: 'DELETE',
            rowId: contract.id,
          });
        });

        // Update house statuses to reflect removed contracts
        houseIds.forEach(houseId => {
          const houseData = housesById.get(houseId);
          if (!houseData) return;
          mutations.push({
            tableName: 'houses',
            operation: 'UPDATE',
            rowId: houseId,
            payload: {
              status: resolveHouseStatusFromContracts(
                houseData.status,
                contractsAfterUpdate,
                houseId,
              ),
            },
          });
        });
      }

      // Step 3: Delete the tenant via local-lite
      mutations.push({
        tableName: 'tenants',
        operation: 'DELETE',
        rowId: selectedTenant.id,
      });

      // Execute core table batch
      await batch(mutations);

      // Step 4: Check for related bookings and delete them from local-lite
      const relatedBookings = bookings.filter(
        b => b.converted_tenant_id === selectedTenant.id,
      );

      if (relatedBookings.length > 0) {
        for (const booking of relatedBookings) {
          await deleteRecord('bookings', booking.id);
        }
      }

      setDeleteDialogVisible(false);
      setSelectedTenant(null);
      showSnackbar('Tenant deleted successfully', 'success');
    } catch (error) {
      console.error('Error deleting tenant:', error);
      showSnackbar('Failed to delete tenant', 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'active':
        return colors.success;
      case 'former':
        return colors.warning;
      case 'inactive':
        return colors.onSurfaceVariant;
      case 'blacklisted':
        return colors.error;
      default:
        return colors.onSurfaceVariant;
    }
  };

  const filterAndSortTenants = useCallback(
    (tenants: Tenant[]): Tenant[] => {
      const idsToFilter = filterIds ? filterIds.split(',') : null;

      return tenants
        .filter(tenant => {
          if (idsToFilter && !idsToFilter.includes(tenant.id)) return false;

          const matchesSearch =
            (tenant.name &&
              toLowerCase(tenant.name).includes(toLowerCase(searchQuery))) ||
            (tenant.email &&
              toLowerCase(tenant.email).includes(toLowerCase(searchQuery))) ||
            (tenant.phone &&
              toLowerCase(tenant.phone).includes(toLowerCase(searchQuery))) ||
            (tenant.propertyName &&
              toLowerCase(tenant.propertyName).includes(toLowerCase(searchQuery))) ||
            (tenant.houseNumber &&
              toLowerCase(tenant.houseNumber).includes(toLowerCase(searchQuery))) ||
            (Array.isArray(tenant.next_of_kin) &&
              tenant.next_of_kin.some(
                (kin: NextOfKin) =>
                  (kin.name &&
                    toLowerCase(kin.name).includes(toLowerCase(searchQuery))) ||
                  (kin.phone &&
                    toLowerCase(kin.phone).includes(toLowerCase(searchQuery))),
              ));

          const matchesStatus =
            selectedStatus === 'all' || tenant.status === selectedStatus;

          return matchesSearch && matchesStatus;
        })
        .sort((a, b) => {
          const nameA = a.name || '';
          const nameB = b.name || '';
          return nameA.localeCompare(nameB);
        });
    },
    [filterIds, searchQuery, selectedStatus],
  );

  const groupTenantsByStatus = useCallback((tenants: Tenant[]): TenantSection[] => {
    const groups = tenants.reduce((acc: Record<string, TenantSection>, tenant) => {
      const statusKey = tenant.status || 'unknown';
      if (!acc[statusKey]) {
        acc[statusKey] = {
          title: properCase(statusKey),
          data: [],
          count: 0,
        };
      }
      acc[statusKey].data.push(tenant);
      acc[statusKey].count++;
      return acc;
    }, {});

    // Sort status groups
    const statusOrder = ['active', 'former', 'inactive', 'blacklisted'];
    return Object.entries(groups)
      .sort((a, b) => statusOrder.indexOf(a[0]) - statusOrder.indexOf(b[0]))
      .map(([_, group]) => group);
  }, []);

  const sections = useMemo(() => {
    return groupTenantsByStatus(filterAndSortTenants(formattedTenants));
  }, [formattedTenants, filterAndSortTenants, groupTenantsByStatus]);

  const renderStatusHeader = ({ section }: { section: TenantSection }) => (
    <SectionGroup
      title={section.title}
      subtitle={`Total Tenants: ${section.count}`}
      isExpanded={expandedStatuses.has(section.title.toLowerCase())}
      onToggle={() => {
        setExpandedStatuses((prev: Set<string>) => {
          const next = new Set(prev);
          const key = section.title.toLowerCase();
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          return next;
        });
      }}
    />
  );

  const handleConvertToBooking = (tenant: Tenant) => {
    if (!tenant.email) {
      showSnackbar(
        'Tenant must have an email address to be converted to a booking',
        'error',
      );
      return;
    }
    setSelectedTenant(tenant);
    setConvertDialogVisible(true);
  };

  const handleConfirmConvertToBooking = async () => {
    if (!selectedTenant || !can('create', 'booking') || !selectedBusiness) {
      showSnackbar('You do not have permission to convert tenants to bookings', 'error');
      return;
    }

    if (!selectedTenant.email) {
      showSnackbar(
        'Tenant must have an email address to be converted to a booking',
        'error',
      );
      return;
    }

    try {
      setConvertLoading(true);
      // Get current user for reviewed_by field

      if (!user) throw new Error('User not found');

      // Find active contract for property info
      const tenantContracts = contracts.filter(c => c.tenant_id === selectedTenant.id);
      const activeContract = tenantContracts.find(c => isActiveContractStatus(c.status));
      let houseId: string | null = null;
      let propertyId: string | null = null;
      if (activeContract?.house_id) {
        houseId = activeContract.house_id;
        propertyId = houses.find(h => h.id === houseId)?.property_id || null;
      }

      // Create booking from tenant data
      const bookingData = {
        name: selectedTenant.name,
        phone: selectedTenant.phone,
        email: selectedTenant.email,
        gender: selectedTenant.gender,
        marital_status: selectedTenant.marital_status,
        nationality: selectedTenant.nationality,
        next_of_kin: selectedTenant.next_of_kin,
        address: selectedTenant.address,
        business_id: selectedBusiness.id,
        user_id: selectedTenant.user_id,
        status: 'converted',
        payment_details: { status: 'paid' },
        house_id: houseId,
        property_id: propertyId,
        deleted: false,
        converted_tenant_id: selectedTenant.id,
        metadata: {
          reviews: [
            {
              status: 'converted',
              reviewed_at: new Date().toISOString(),
              reviewed_by: user.id,
              action_type: 'convert',
              review_notes: `Converted from tenant ID: ${selectedTenant.id}`,
            },
          ],
        },
      };

      // Check for duplicate bookings with same email using local store
      let dupBookings: Booking[] | null = null;
      if (selectedTenant.email) {
        dupBookings = bookings.filter(
          b => b.email === selectedTenant.email && b.business_id === selectedBusiness.id,
        ) as Booking[];
      }

      if (dupBookings && dupBookings.length > 0) {
        setDuplicateTenants(dupBookings as Booking[]);
        setPendingBookingData(bookingData);
        // Always set updateComparison for diff view
        const differences = compareDataFields(bookingData, dupBookings[0]);
        setUpdateComparison({
          tenant: selectedTenant,
          booking: dupBookings[0],
          differences,
        });
        setDuplicateTenantDialogVisible(true);
        setConvertDialogVisible(false);
        return;
      }

      // Insert new booking via local-lite
      const newBookingId = generateUUID();
      const newBooking = {
        ...bookingData,
        id: newBookingId,
      };

      await insert('bookings', newBooking as any);

      try {
        if (isOnline) {
          await sendBookingApprovalNotification(
            newBooking as any,
            selectedBusiness as any,
          );
        }
      } catch (emailError) {
        console.error('Error sending booking emails:', emailError);
      }

      showSnackbar('Tenant converted to booking successfully!', 'success');
      setConvertDialogVisible(false);
      setSelectedTenant(null);
    } catch (error: any) {
      console.error('Error converting tenant to booking:', error);
      let errorMessage = error.message;
      if (error.message.includes('already exists')) {
        errorMessage = "A booking request already exists for this tenant's email address";
      } else if (error.message.includes('Authentication')) {
        errorMessage = 'Please log in again to continue';
      }
      showSnackbar(errorMessage, 'error');
    } finally {
      setConvertLoading(false);
    }
  };

  const compareDataFields = (booking: any, tenant: any) => {
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

    // Add implicit fields for display
    const tenantContracts = contracts.filter(c => c.tenant_id === tenant.id);
    const activeContract = tenantContracts.find(c => isActiveContractStatus(c.status));
    let tHouseId: string | null = null;
    let tPropertyId: string | null = null;
    let tHouseName = 'No Active Contract';
    let tPropertyName = 'No Active Contract';

    if (activeContract?.house_id) {
      tHouseId = activeContract.house_id;
      const house = houses.find(h => h.id === tHouseId);
      if (house) {
        tHouseName = house.house_number || 'Unknown House';
        tPropertyId = house.property_id || null;
        if (tPropertyId) {
          tPropertyName =
            properties.find(p => p.id === tPropertyId)?.name || 'Unknown Property';
        } else {
          tPropertyName = 'Unknown Property';
        }
      } else {
        tHouseName = 'Unknown House';
        tPropertyName = 'Unknown Property';
      }
    }

    if (booking.house_id !== tHouseId) {
      const bHouse = houses.find(h => h.id === booking.house_id);
      differences.push({
        field: 'house_id',
        label: 'House',
        booking: booking.house_id,
        tenant: tHouseId,
        displayBooking:
          bHouse?.house_number || (booking.house_id ? 'Unknown House' : '(empty)'),
        displayTenant: tHouseName,
      });
    }

    if (booking.property_id !== tPropertyId) {
      const bProperty = properties.find(p => p.id === booking.property_id);
      differences.push({
        field: 'property_id',
        label: 'Property',
        booking: booking.property_id,
        tenant: tPropertyId,
        displayBooking:
          bProperty?.name || (booking.property_id ? 'Unknown Property' : '(empty)'),
        displayTenant: tPropertyName,
      });
    }

    // Payment details
    const bPayment = booking.payment_details
      ? JSON.stringify(booking.payment_details)
      : '{}';
    const tPayment = JSON.stringify({ status: 'paid' });
    if (bPayment !== tPayment) {
      const bPaymentObj = booking.payment_details || {};
      const tPaymentObj = { status: 'paid' };
      const formatPayment = (p: any) => {
        if (!p || Object.keys(p).length === 0) return '(empty)';
        let str = p.status ? `Status: ${properCase(p.status)}` : '';
        if (p.note) str += `\nNote: ${p.note}`;
        return str || '(empty)';
      };

      differences.push({
        field: 'payment_details',
        label: 'Payment Details',
        booking: bPaymentObj,
        tenant: tPaymentObj,
        displayBooking: formatPayment(bPaymentObj),
        displayTenant: formatPayment(tPaymentObj),
      });
    }

    return differences;
  };

  const handleSyncConfirm = async (direction: 'to_tenant' | 'to_booking') => {
    if (!updateComparison) return;
    try {
      setUpdatingTenant(true);
      const { booking, tenant, differences } = updateComparison;

      if (direction === 'to_tenant') {
        const updates: any = {};
        const tenantAllowedFields = [
          'name',
          'phone',
          'email',
          'address',
          'gender',
          'marital_status',
          'nationality',
          'next_of_kin',
        ];

        differences.forEach((d: any) => {
          if (tenantAllowedFields.includes(d.field)) {
            updates[d.field] = d.booking;
          }
        });

        if (Object.keys(updates).length > 0) {
          await update('tenants', tenant.id, updates);
        }
        showSnackbar('Tenant updated from booking data', 'success');
      } else {
        const updates: any = {};
        differences.forEach((d: any) => {
          updates[d.field] = d.tenant;
        });

        // Ensure status and identifiers remain consistent
        updates.converted_tenant_id = tenant.id;
        updates.status = 'converted';
        updates.deleted = false;

        await update('bookings', booking.id, updates);
        showSnackbar('Booking updated from tenant data', 'success');
      }

      setDuplicateTenantDialogVisible(false);
      setUpdateComparison(null);
      setPendingBookingData(null);
    } catch (e: any) {
      showSnackbar(e.message, 'error');
    } finally {
      setUpdatingTenant(false);
    }
  };

  const handleSyncWithBooking = async (tenantToSync: Tenant) => {
    if (!selectedBusiness) return;
    try {
      setIsSyncMode(true);
      if (
        !tenantToSync?.convertedFromBooking ||
        tenantToSync.convertedFromBooking.length === 0
      ) {
        showSnackbar('This tenant is not linked to a booking to sync with.', 'info');
        return;
      }

      const bookingId = tenantToSync.convertedFromBooking[0].id;
      // We can use local store for this lookup too!
      const booking = bookings.find(b => b.id === bookingId);

      if (!booking) {
        throw new Error('Linked booking not found locally');
      }

      const differences = compareDataFields(booking, tenantToSync);

      setPendingBookingData({
        bookingData: {
          name: tenantToSync.name,
          phone: tenantToSync.phone,
          email: tenantToSync.email,
          address: tenantToSync.address,
          gender: tenantToSync.gender,
          marital_status: tenantToSync.marital_status,
          nationality: tenantToSync.nationality,
          next_of_kin: tenantToSync.next_of_kin,
          business_id: selectedBusiness.id,
          user_id: tenantToSync.user_id,
        },
        tenant: tenantToSync,
      });
      setUpdateComparison({ tenant: tenantToSync, booking, differences });
      setDuplicateTenantDialogVisible(true);
    } catch (e: any) {
      console.error('Sync compare failed:', e);
      showSnackbar(e?.message || 'Could not compare tenant with booking', 'error');
      setIsSyncMode(false);
    }
  };

  const handleOpenStatusUpdate = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setTempStatus(tenant.status || 'active');
    setStatusUpdateVisible(true);
  };

  const handleUpdateTenantStatus = async (statusOverride?: string) => {
    if (!selectedTenant || !selectedBusiness || updateStatusLoading) return;

    const finalStatus = statusOverride || tempStatus;

    try {
      setUpdateStatusLoading(true);

      await updateTenantStatus({
        tenantId: selectedTenant.id,
        newStatus: finalStatus,
      });

      setStatusUpdateVisible(false);

      showSnackbar('Tenant status updated successfully', 'success');
    } catch (error: any) {
      console.error('Error updating tenant status:', error);
      showSnackbar(error.message || 'Failed to update tenant status', 'error');
    } finally {
      setUpdateStatusLoading(false);
    }
  };

  const renderTenant = ({ item }: { item: Tenant }) => {
    const status = item.status || 'active';
    const statusColor = getStatusColor(status);
    return (
      <Surface style={[styles.tenantCard, { borderColor: statusColor, borderWidth: 1 }]}>
        <View style={[styles.watermark, { borderColor: statusColor }]}>
          <Text
            variant="headlineMedium"
            style={[styles.watermarkText, { color: statusColor }]}
          >
            {toAllCaps(status)}
          </Text>
        </View>

        <View key={`tenant-${item.id}`} style={styles.tenantHeader}>
          <View style={styles.tenantInfo}>
            <View style={styles.nameContainer}>
              <MaterialCommunityIcons
                name="account"
                size={20}
                color={colors.onSurfaceVariant}
              />
              <Text variant="titleMedium" style={styles.nameText}>
                {item.name}
              </Text>
            </View>
            <View style={styles.contactContainer}>
              <MaterialCommunityIcons
                name="email"
                size={16}
                color={colors.onSurfaceVariant}
              />
              <Text variant="bodySmall" style={styles.contactText}>
                {item.email || 'Not provided'}
              </Text>
            </View>
            <View style={styles.contactContainer}>
              <MaterialCommunityIcons
                name="phone"
                size={16}
                color={colors.onSurfaceVariant}
              />
              <Text variant="bodySmall" style={styles.contactText}>
                {item.phone || 'Not provided'}
              </Text>
            </View>
            {item.fullPropertyInfo && item.fullPropertyInfo !== 'Not assigned' && (
              <View style={[styles.propertyContainer, { width: '100%' }]}>
                <MaterialCommunityIcons
                  name="office-building"
                  size={16}
                  color={colors.onSurfaceVariant}
                />
                <Text
                  variant="bodySmall"
                  style={[styles.propertyText, { flex: 1, flexWrap: 'wrap' }]}
                  numberOfLines={0}
                >
                  {item.fullPropertyInfo}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.tenantActions}>
            <View style={styles.actionsColumn}>
              <Menu
                visible={menuVisible === item.id}
                onDismiss={() => setMenuVisible(null)}
                anchor={
                  <IconButton
                    icon="dots-vertical"
                    onPress={() => setMenuVisible(item.id)}
                    style={styles.menuButton}
                  />
                }
              >
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(null);
                    handleViewTenant(item);
                  }}
                  title="View Tenant"
                  leadingIcon="eye"
                />
                {can('edit', 'tenant') && (
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(null);
                      handleEditTenant(item);
                    }}
                    title="Edit Tenant"
                    leadingIcon="pencil"
                  />
                )}
                {item.convertedFromBooking && item.convertedFromBooking.length > 0 ? (
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(null);
                      handleSyncWithBooking(item);
                    }}
                    title="Sync Booking"
                    leadingIcon="sync"
                  />
                ) : (
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(null);
                      handleConvertToBooking(item);
                    }}
                    title="Convert Booking"
                    leadingIcon="account-convert"
                  />
                )}
                {can('edit', 'tenant') && (
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(null);
                      handleOpenStatusUpdate(item);
                    }}
                    title="Update Status"
                    leadingIcon="list-status"
                  />
                )}
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(null);
                    handleTenantLedger(item);
                  }}
                  title="Tenant Ledger"
                  leadingIcon={
                    ledgerLoading === item.id
                      ? () => <ActivityIndicator size="small" />
                      : 'book-account'
                  }
                  disabled={!!ledgerLoading}
                />
                {can('delete', 'tenant') && (
                  <>
                    <Divider />
                    <Menu.Item
                      onPress={() => {
                        setMenuVisible(null);
                        setSelectedTenant(item);
                        setDeleteDialogVisible(true);
                      }}
                      title="Delete Tenant"
                      leadingIcon="delete"
                      titleStyle={{ color: colors.error }}
                    />
                  </>
                )}
              </Menu>
              {item.convertedFromBooking && item.convertedFromBooking.length > 0 && (
                <SPressable
                  onPress={() => {
                    const booking = item.convertedFromBooking?.[0];
                    if (booking) handleViewBooking(booking);
                  }}
                >
                  <MaterialCommunityIcons
                    name="clipboard-account"
                    size={18}
                    color={colors.primary}
                  />
                </SPressable>
              )}
            </View>
          </View>
        </View>
      </Surface>
    );
  };

  if (accessLoading) {
    return <LoadingCard iconName="account-group" text="Loading tenants..." />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <BaseSearch
        placeholder="Search tenants"
        value={searchQuery}
        onChangeText={setSearchQuery}
        onClear={() => setSearchQuery('')}
        leftIcon="magnify"
        rightIcon="close-circle"
      />

      <View style={styles.filterContainer}>
        <FilterButtons
          options={[
            { label: 'All', value: 'all', icon: 'layers-outline' },
            { label: 'Active', value: 'active', icon: 'check-circle' },
            { label: 'Former', value: 'former', icon: 'history' },
            { label: 'Inactive', value: 'inactive', icon: 'cancel' },
          ]}
          selectedValue={selectedStatus}
          onValueChange={val => {
            const newStatus = (val || 'all') as string;
            setSelectedStatus(newStatus);
            if (newStatus === 'all') {
              router.setParams({ filterIds: '' });
            }
          }}
        />
      </View>

      <SectionList
        style={{ flex: 1 }}
        sections={sections}
        keyExtractor={item => item.id}
        contentContainerStyle={[
          styles.listContent,
          sections.length === 0 && styles.emptyContainer,
        ]}
        renderItem={({ item, section }) =>
          expandedStatuses.has(section.title.toLowerCase())
            ? renderTenant({ item })
            : null
        }
        renderSectionHeader={renderStatusHeader}
        stickySectionHeadersEnabled={false}
        removeClippedSubviews={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={10}
        extraData={{
          expandedStatuses,
          rawTenants,
          menuVisible,
          ledgerLoading,
          contractsByTenantId,
          housesById,
          propertiesById,
          bookings,
        }}
        ListEmptyComponent={
          <EmptyState icon="account-group-outline" title="No tenants found" />
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />

      <Portal>
        <BaseModal
          mode="confirm"
          visible={deleteDialogVisible}
          onDismiss={() => setDeleteDialogVisible(false)}
          onConfirm={handleDeleteTenant}
          title="Delete Tenant"
          message={`Are you sure you want to delete ${selectedTenant?.name}?\n\nThis will also terminate any active contracts and free up their houses.`}
          confirmText="Delete"
          cancelText="Cancel"
          loading={deleteLoading}
          destructive={true}
        />

        <BaseModal
          mode="confirm"
          visible={convertDialogVisible}
          onDismiss={() => setConvertDialogVisible(false)}
          onConfirm={handleConfirmConvertToBooking}
          title="Convert to Booking"
          message={`Create a booking record for ${selectedTenant?.name}?`}
          confirmText="Convert"
          cancelText="Cancel"
          loading={convertLoading}
        />

        {/* Status Update Modal */}
        <StatusUpdateModal
          visible={statusUpdateVisible}
          onDismiss={() => setStatusUpdateVisible(false)}
          title="Update Tenant Status"
          subtitle={selectedTenant ? `Tenant: ${selectedTenant.name}` : undefined}
          items={tenantStatusItems}
          onSelect={status => {
            handleUpdateTenantStatus(status);
          }}
        ></StatusUpdateModal>

        {duplicateTenantDialogVisible && updateComparison && (
          <BaseModal
            mode="modal"
            visible={duplicateTenantDialogVisible}
            loading={updatingTenant}
            onDismiss={() => {
              setDuplicateTenantDialogVisible(false);
              setUpdateComparison(null);
              setDuplicateTenants([]);
              setPendingBookingData(null);
            }}
            title={isSyncMode ? 'Sync with Booking' : 'Duplicate Booking Found'}
            subtitle={
              pendingBookingData
                ? `Booking: ${pendingBookingData.name || 'Found'} (${duplicateTenants.length} matches)`
                : 'Network and sync status'
            }
            actions={
              updateComparison.differences.length === 0
                ? [
                    {
                      label: 'Close',
                      onPress: () => {
                        setDuplicateTenantDialogVisible(false);
                        setUpdateComparison(null);
                        setDuplicateTenants([]);
                        setPendingBookingData(null);
                      },
                      mode: 'contained',
                      icon: 'close',
                    },
                  ]
                : [
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
                  ]
            }
            scrollable={true}
          >
            {updateComparison.differences.length > 0 ? (
              <>
                <View style={{ marginBottom: 16 }}>
                  <Text variant="bodyMedium">
                    {isSyncMode
                      ? 'Review changes from booking:'
                      : 'A booking request already exists for this email. Review and merge changes?'}
                  </Text>
                </View>
                <DiffViewer differences={updateComparison.differences} />
              </>
            ) : (
              <EmptyState
                icon="check-all"
                title="In Sync"
                description="No differences found between the tenant and the booking."
              />
            )}
          </BaseModal>
        )}
        {/* Booking Details Modal */}
        <BaseModal
          visible={bookingModalVisible}
          onDismiss={() => setBookingModalVisible(false)}
          title="Original Booking Details"
          subtitle="Manage your properties"
          mode="info"
        >
          {selectedBooking && (
            <View style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.primaryContainer,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 12,
                  alignSelf: 'stretch',
                  gap: 8,
                }}
              >
                <MaterialCommunityIcons
                  name="check-circle"
                  size={16}
                  color={colors.primary}
                />
                <Text
                  variant="labelLarge"
                  style={{
                    color: colors.onPrimaryContainer,
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                  }}
                >
                  {selectedBooking.status}
                </Text>
              </View>

              <View style={{ gap: 10 }}>
                {/* Contact Info */}
                <View
                  style={{
                    backgroundColor: colors.surfaceVariant,
                    padding: 16,
                    borderRadius: 12,
                    gap: 12,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <MaterialCommunityIcons
                      name="account-outline"
                      size={20}
                      color={colors.primary}
                    />
                    <View>
                      <Text variant="labelSmall" style={{ opacity: 0.5 }}>
                        NAME
                      </Text>
                      <Text variant="bodyLarge" style={{ fontWeight: '600' }}>
                        {selectedBooking.name}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <MaterialCommunityIcons
                      name="phone-outline"
                      size={20}
                      color={colors.primary}
                    />
                    <View>
                      <Text variant="labelSmall" style={{ opacity: 0.5 }}>
                        PHONE
                      </Text>
                      <Text variant="bodyLarge">{selectedBooking.phone || 'N/A'}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <MaterialCommunityIcons
                      name="email-outline"
                      size={20}
                      color={colors.primary}
                    />
                    <View>
                      <Text variant="labelSmall" style={{ opacity: 0.5 }}>
                        EMAIL
                      </Text>
                      <Text variant="bodyLarge">{selectedBooking.email || 'N/A'}</Text>
                    </View>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View
                    style={{
                      flex: 1,
                      backgroundColor: colors.surfaceVariant,
                      padding: 12,
                      borderRadius: 12,
                    }}
                  >
                    <Text variant="labelSmall" style={{ opacity: 0.5 }}>
                      GENDER
                    </Text>
                    <Text variant="bodyMedium">
                      {properCase(selectedBooking.gender || 'N/A')}
                    </Text>
                  </View>
                  <View
                    style={{
                      flex: 1,
                      backgroundColor: colors.surfaceVariant,
                      padding: 12,
                      borderRadius: 12,
                    }}
                  >
                    <Text variant="labelSmall" style={{ opacity: 0.5 }}>
                      NATIONALITY
                    </Text>
                    <Text variant="bodyMedium">
                      {properCase(selectedBooking.nationality || 'N/A')}
                    </Text>
                  </View>
                </View>

                {/* Next of Kin */}
                {selectedBooking.next_of_kin &&
                  ((selectedBooking.next_of_kin as any).name ||
                    (selectedBooking.next_of_kin as any).phone) && (
                    <View
                      style={{
                        backgroundColor: colors.surfaceVariant,
                        padding: 16,
                        borderRadius: 12,
                        gap: 12,
                      }}
                    >
                      <Text variant="titleSmall" style={{ color: colors.primary }}>
                        Next of Kin / Emergency Contact
                      </Text>

                      {(selectedBooking.next_of_kin as any).name && (
                        <View
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                        >
                          <MaterialCommunityIcons
                            name="account-group-outline"
                            size={20}
                            color={colors.primary}
                          />
                          <View>
                            <Text variant="labelSmall" style={{ opacity: 0.5 }}>
                              NAME
                            </Text>
                            <Text variant="bodyLarge" style={{ fontWeight: '600' }}>
                              {(selectedBooking.next_of_kin as any).name}
                            </Text>
                          </View>
                        </View>
                      )}

                      {(selectedBooking.next_of_kin as any).phone && (
                        <View
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                        >
                          <MaterialCommunityIcons
                            name="phone-outline"
                            size={20}
                            color={colors.primary}
                          />
                          <View>
                            <Text variant="labelSmall" style={{ opacity: 0.5 }}>
                              PHONE
                            </Text>
                            <Text variant="bodyLarge">
                              {(selectedBooking.next_of_kin as any).phone}
                            </Text>
                          </View>
                        </View>
                      )}

                      {(selectedBooking.next_of_kin as any).relationship && (
                        <View
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                        >
                          <MaterialCommunityIcons
                            name="heart-outline"
                            size={20}
                            color={colors.primary}
                          />
                          <View>
                            <Text variant="labelSmall" style={{ opacity: 0.5 }}>
                              RELATIONSHIP
                            </Text>
                            <Text variant="bodyLarge">
                              {(selectedBooking.next_of_kin as any).relationship}
                            </Text>
                          </View>
                        </View>
                      )}
                    </View>
                  )}
              </View>
            </View>
          )}
        </BaseModal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tenantCard: {
    margin: 8,
    padding: 12,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  watermark: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -50 }, { translateY: -10 }, { rotate: '-45deg' }],
    opacity: 0.1,
    zIndex: 1,
    borderWidth: 2,
    borderStyle: 'dashed',
    padding: 4,
    borderRadius: 8,
  },
  watermarkText: {
    fontSize: 24,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  tenantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  tenantInfo: {
    flex: 1,
    marginRight: 16,
  },
  tenantActions: {
    justifyContent: 'center',
  },
  actionsColumn: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  nameText: {
    flex: 1,
  },
  contactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  contactText: {
    flex: 1,
  },
  propertyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  propertyText: {
    fontStyle: 'italic',
  },
  menuButton: {
    margin: 0,
  },

  filterContainer: {
    paddingHorizontal: 2,
  },
  listContent: {
    paddingBottom: 24,
  },
  emptyContainer: {
    flexGrow: 1,
  },
});
