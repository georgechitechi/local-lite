const setMpesaPaymentModalVisible = (value: UIState['mpesaPaymentModalVisible']) =>
  setUIField('mpesaPaymentModalVisible', value);

import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import * as Print from 'expo-print';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Button, IconButton, Menu, Portal, Surface, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import MpesaPaymentModal from '@/features/payments/components/MpesaPaymentModal';
import {
  formatReceiptStatusLabel,
  formatRefundText,
  getReceiptStatusColor,
  type PaymentPeriod,
  resolveReceiptWaiverAndRent,
} from '@/features/receipts/utils/receiptHelper';
import { scopeRecordsForTenant } from '@/shared/access';
import BaseModal from '@/shared/components/BaseModal';
import BaseSearch from '@/shared/components/BaseSearch';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import LoadingCard from '@/shared/components/LoadingCard';
import SectionGroup from '@/shared/components/SectionGroup';
import SPressable from '@/shared/components/SlightPressable';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useCurrency } from '@/shared/hooks/useCurrency';
import {
  useContractsWithLoading,
  useCoreIndexMap,
  useCoreMutations,
  useHousesWithLoading,
  useIsInitialSyncing,
  usePaymentMessageReceiptsWithLoading,
  usePaymentMessagesWithLoading,
  usePropertiesWithLoading,
  useReceiptRefundsWithLoading,
  useReceiptsWithLoading,
  useStoreRefresh,
  useTenantsWithLoading,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { sendReceiptEmail } from '@/shared/services/emailService';
import type {
  Receipt as StoreReceipt,
  Tenant as StoreTenant,
} from '@/shared/types/types';
import { formatPeriod, formatWithCurrency, parsePeriod } from '@/shared/utils/formatters';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import { setUIField, type UIState, useUIState } from '@/stores/uiStore';
import {
  generateAndShareReceipt,
  generateReceiptHTML,
} from '@/templates/receiptTemplate';

interface NextOfKin {
  name?: string;
  phone?: string;
  email?: string;
  relationship?: string;
  [key: string]: any;
}

interface LinkedPaymentMessage {
  id: string;
  message_content: string;
  [key: string]: any;
}

interface Tenant extends Omit<StoreTenant, 'next_of_kin'> {
  next_of_kin?: NextOfKin[];
}

interface Receipt extends Omit<StoreReceipt, 'payment_period' | 'tenant'> {
  tenantName?: string;
  propertyName?: string;
  houseNumber?: string;
  displayStatus?: string;
  netAmount?: number;
  linked_payment_messages?: LinkedPaymentMessage[];
  payment_period?: PaymentPeriod;
  tenant?: Tenant;
  hasWaiver?: boolean;
  waiverType?: 'full' | 'partial' | null;
  targetRent?: number;
  contractRent?: number;
  contract?: {
    house?: {
      house_number?: string;
      property?: {
        name?: string;
      };
    };
  };
}

interface ReceiptSection {
  title: string;
  data: Receipt[];
  total: number;
  stats: Record<string, number>;
  date: Date;
}

export default function ReceiptsScreen() {
  const router = useRouter();
  const { selectedBusiness } = useBusiness();
  const {
    tenantId,
    loading: accessLoading,
    can,
    isAdmin,
    isStaff,
    isTenantOnly,
  } = useAccessControl();
  const colors = useThemeColors() as any;

  // Core Table Live Queries & Mutations (local-lite)
  const { data: rawReceipts, loading: receiptsLoading } = useReceiptsWithLoading(
    selectedBusiness?.id,
  );
  const { data: tenants, loading: tenantsLoading } = useTenantsWithLoading(
    selectedBusiness?.id,
  );
  const { data: contracts, loading: contractsLoading } = useContractsWithLoading(
    selectedBusiness?.id,
  );
  const { data: houses, loading: housesLoading } = useHousesWithLoading(
    selectedBusiness?.id,
  );
  const { data: properties, loading: propertiesLoading } = usePropertiesWithLoading(
    selectedBusiness?.id,
  );
  const { delete: deleteRecord, update } = useCoreMutations();

  const { data: paymentMessages } = usePaymentMessagesWithLoading(selectedBusiness?.id);
  const { data: paymentMessageReceipts } = usePaymentMessageReceiptsWithLoading(
    selectedBusiness?.id,
  );

  // Core refunds query
  const { data: receiptRefunds, loading: refundsLoading } = useReceiptRefundsWithLoading(
    selectedBusiness?.id,
  );
  const { refreshing, onRefresh } = useStoreRefresh();
  const isInitialSyncing = useIsInitialSyncing();

  // Index maps for instantaneous O(1) relational lookups
  const housesById = useCoreIndexMap(houses);
  const propertiesById = useCoreIndexMap(properties);
  const tenantsById = useCoreIndexMap(tenants);
  const contractsById = useCoreIndexMap(contracts);

  const isTablesLoading =
    receiptsLoading ||
    tenantsLoading ||
    contractsLoading ||
    housesLoading ||
    propertiesLoading ||
    refundsLoading;

  const params = useLocalSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [expandedPeriods, setExpandedPeriods] = useState<Set<string>>(new Set());
  const [warningVisible, setWarningVisible] = useState(false);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);
  const [displayedMonths, setDisplayedMonths] = useState(5);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [emailProgress, setEmailProgress] = useState(0);
  const [emailProgressLabel, setEmailProgressLabel] = useState('');
  const [receiptToEmail, setReceiptToEmail] = useState<Receipt | null>(null);
  const { showSnackbar } = useSnackbar();
  const [sentInfoReceipt, setSentInfoReceipt] = useState<Receipt | null>(null);
  const [showSentInfoModal, setShowSentInfoModal] = useState(false);

  const mpesaPaymentModalVisible = useUIState(s => s.mpesaPaymentModalVisible);

  const activeContract = useMemo(() => {
    if (!tenantId) return null;
    return contracts.find(
      c => c.tenant_id === tenantId && isActiveContractStatus(c.status),
    );
  }, [contracts, tenantId]);

  // Aggregate Data
  const formattedReceipts = useMemo(() => {
    // 1. Filter by tenant permissions
    let filteredReceipts = scopeRecordsForTenant(rawReceipts, {
      tenantId,
      isTenantOnly,
    });

    // 2. Filter by contract_id if provided in params
    const contractId = Array.isArray(params.contract_id)
      ? params.contract_id[0]
      : params.contract_id;
    if (contractId) {
      filteredReceipts = filteredReceipts.filter(r => r.contract_id === contractId);
    }

    return filteredReceipts.map(receipt => {
      // Join Related Data via O(1) index maps
      const tenant = receipt.tenant_id ? tenantsById.get(receipt.tenant_id) : undefined;
      const contract = receipt.contract_id
        ? contractsById.get(receipt.contract_id)
        : undefined;
      const house = contract?.house_id ? housesById.get(contract.house_id) : undefined;
      const property = house?.property_id
        ? propertiesById.get(house.property_id)
        : undefined;

      const houseNumber = house?.house_number || 'Unknown';
      const propertyName = property?.name || 'Unknown';

      // Join Payment Messages
      const messsageLinks = paymentMessageReceipts.filter(
        link => link.receipt_id === receipt.id,
      );

      // Deduplicate by payment_message_id to avoid UI duplication
      const uniqueMsgIds = new Set<string>();
      const linkedMessages = messsageLinks
        .map(link => {
          if (uniqueMsgIds.has(link.payment_message_id)) return null;
          uniqueMsgIds.add(link.payment_message_id);

          const msg = paymentMessages.find(m => m.id === link.payment_message_id);
          return msg ? ({ ...msg } as LinkedPaymentMessage) : null;
        })
        .filter((m): m is LinkedPaymentMessage => m !== null);

      const totalAmount = parseFloat(String(receipt.amount || 0));
      const refundedAmount = parseFloat(String(receipt.refunded_amount || 0));

      const { hasWaiver, waiverType, targetRent, contractRent, status } =
        resolveReceiptWaiverAndRent({
          receipt: receipt as any,
          contract,
          rawReceipts,
        });

      const displayStatus = receipt.is_refunded
        ? 'refunded'
        : refundedAmount > 0
          ? 'partial_refund'
          : status;

      const parsedPeriod = parsePeriod(receipt.payment_period);
      const paymentPeriod: PaymentPeriod =
        parsedPeriod.month > 0 && parsedPeriod.year > 0
          ? parsedPeriod
          : receipt.payment_date
            ? {
                month: new Date(receipt.payment_date).getMonth() + 1,
                year: new Date(receipt.payment_date).getFullYear(),
              }
            : { month: 0, year: 0 };

      return {
        ...receipt,
        payment_period: paymentPeriod,
        tenant: tenant
          ? ({
              ...tenant,
              next_of_kin: (tenant.next_of_kin as unknown as NextOfKin[]) || [],
            } as Tenant)
          : undefined,
        tenantName: tenant?.name || 'Unknown Tenant',
        propertyName,
        houseNumber,
        displayStatus,
        netAmount: Math.max(0, totalAmount - refundedAmount),
        linked_payment_messages: linkedMessages,
        hasWaiver,
        waiverType,
        targetRent,
        contractRent,
        // Maintain nested structure for template compatibility if needed
        contract: {
          house: {
            house_number: houseNumber,
            property: {
              name: propertyName,
            },
          },
        },
      } as Receipt;
    });
  }, [
    rawReceipts,
    tenantsById,
    contractsById,
    housesById,
    propertiesById,
    paymentMessages,
    paymentMessageReceipts,
    isTenantOnly,
    tenantId,
    params.contract_id,
  ]);

  // Handle search and contract_id parameter from router
  useEffect(() => {
    if (params.search && params.search !== searchQuery) {
      setSearchQuery(params.search as string);
    } else if (params.contract_id && contracts.length > 0 && !searchQuery) {
      const contract = contracts.find(c => c.id === params.contract_id);
      if (contract) {
        const tenant = tenants.find(t => t.id === contract.tenant_id);
        const tenantName = tenant?.name || 'Unknown Tenant';
        setSearchQuery(tenantName);
        router.setParams({ contract_id: undefined, search: undefined } as any);
      }
    }
  }, [params.search, params.contract_id, searchQuery, contracts, tenants, router]);

  const handleEditReceipt = (receipt: Receipt) => {
    if (selectedBusiness) {
      router.push(`/receipts/edit/${receipt.id}`);
    }
  };

  const handleViewReceipt = (receipt: Receipt) => {
    if (selectedBusiness) {
      router.push(`/receipts/view/${receipt.id}`);
    }
  };

  const handleDeleteReceipt = async () => {
    if (!can('delete', 'receipt')) {
      showSnackbar('You do not have permission to delete receipts', 'error');
      return;
    }
    if (!selectedReceipt || !selectedBusiness?.id) return;

    try {
      setDeleteLoading(true);

      // Use local-lite delete for soft delete
      await deleteRecord('receipts', selectedReceipt.id);

      setDeleteDialogVisible(false);
      setSelectedReceipt(null);
      showSnackbar('Receipt deleted successfully', 'success');
    } catch (error) {
      console.error('Error deleting receipt:', error);
      showSnackbar('Failed to delete receipt', 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  const buildReceiptForPdf = (receipt: any, relatedRefunds: any[]) => {
    const paymentPeriod: { month: number; year: number } = receipt.payment_period || {
      month: new Date(receipt.payment_date).getMonth() + 1,
      year: new Date(receipt.payment_date).getFullYear(),
    };

    return {
      ...receipt,
      id: receipt.id,
      tenant_id: receipt.tenant?.id,
      amount: parseFloat(String(receipt.amount || 0)),
      paymentStatus: receipt.displayStatus || receipt.status || 'paid',
      paymentDate: receipt.payment_date,
      payment_period: paymentPeriod,
      tenantName: receipt.tenantName || receipt.tenant?.name || 'Unknown',
      tenantPhone: receipt.tenant?.phone || 'N/A',
      tenantEmail: receipt.tenant?.email || 'N/A',
      roomNumber: receipt.houseNumber,
      propertyName: receipt.propertyName,
      createdAt: receipt.created_at || new Date(),
      linked_payment_messages: receipt.linked_payment_messages || [],
      refunds: relatedRefunds,
      target_rent: receipt.targetRent, // Ensure balance is calculated correctly!
      contract: {
        rent_amount: receipt.contractRent,
        house: {
          house_number: receipt.houseNumber,
        },
      },
    };
  };

  const handleShareReceipt = async (receipt: Receipt) => {
    if (selectedBusiness) {
      try {
        const relatedRefunds = receiptRefunds.filter(r => r.receipt_id === receipt.id);
        const receiptData = buildReceiptForPdf(receipt, relatedRefunds);
        await generateAndShareReceipt(receiptData, selectedBusiness);
      } catch (error: any) {
        console.error('Share receipt error:', error);
        showSnackbar(`Failed to generate receipt: ${error.message}`, 'error');
      }
    }
  };

  const handleSendEmailInitiate = (receipt: Receipt) => {
    setReceiptToEmail(receipt);
    setEmailModalVisible(true);
    setEmailProgress(0);
    setEmailProgressLabel('');
  };

  const handleSendEmail = async (targetReceipt?: Receipt | any) => {
    const receiptToUse =
      targetReceipt && typeof targetReceipt === 'object' && 'id' in targetReceipt
        ? (targetReceipt as Receipt)
        : receiptToEmail;

    if (!selectedBusiness || !receiptToUse) return;

    setEmailModalVisible(false);

    try {
      setSendingEmail(receiptToUse.id);
      const tenant = {
        name: receiptToUse.tenantName || 'Tenant',
        email: receiptToUse.tenant?.email || '',
      };

      if (!tenant.email) {
        showSnackbar('Tenant has no email address on file.', 'error');
        return;
      }

      const relatedRefunds = receiptRefunds.filter(r => r.receipt_id === receiptToUse.id);
      const receiptForPdf = buildReceiptForPdf(receiptToUse, relatedRefunds);

      const html = generateReceiptHTML(
        receiptForPdf as any,
        selectedBusiness as any,
        defaultCurrency as any,
      );

      const { base64 } = await Print.printToFileAsync({ html, base64: true });
      await sendReceiptEmail(receiptToUse, tenant as any, base64);

      // Update local store with sent status
      const metadata = {
        ...((receiptToUse.metadata as any) || {}),
        sent_at: new Date().toISOString(),
      };
      await update('receipts', receiptToUse.id, { metadata });

      showSnackbar(`Receipt emailed to ${tenant.name}!`, 'success');
    } catch (error: any) {
      console.error('Error sending email:', error);
      showSnackbar(`Failed to send email: ${error.message}`, 'error');
    } finally {
      setSendingEmail(null);
    }
  };

  const filterAndSortReceipts = useCallback(
    (receipts: Receipt[]): Receipt[] => {
      let filtered = receipts.filter(receipt => {
        const matchesSearch =
          receipt.tenantName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          receipt.houseNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          receipt.propertyName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          receipt.amount.toString().includes(searchQuery) ||
          (Array.isArray(receipt.tenant?.next_of_kin) &&
            (receipt.tenant?.next_of_kin as NextOfKin[])?.some(
              (kin: NextOfKin) =>
                kin.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                kin.phone?.toLowerCase().includes(searchQuery.toLowerCase()),
            )) ||
          // Search in linked payment messages
          receipt.linked_payment_messages?.some((message: LinkedPaymentMessage) =>
            message.message_content.toLowerCase().includes(searchQuery.toLowerCase()),
          );

        const matchesStatus =
          selectedStatus === 'all' ||
          selectedStatus === 'sent' ||
          selectedStatus === 'not_sent' ||
          (selectedStatus === 'promo'
            ? !!receipt.promotion_id
            : selectedStatus === 'waived'
              ? !!receipt.hasWaiver
              : receipt.displayStatus === selectedStatus);

        return matchesSearch && matchesStatus;
      });

      // If user is staff (not admin), show only receipts from the past two months (by payment_period)
      if (isStaff && !isAdmin) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        let prevMonth = currentMonth - 1;
        let prevMonthYear = currentYear;
        if (prevMonth === 0) {
          prevMonth = 12;
          prevMonthYear = currentYear - 1;
        }
        filtered = filtered.filter(receipt => {
          const period = receipt.payment_period;
          if (!period?.year || !period.month) return false;
          return (
            (period.year === currentYear && period.month === currentMonth) ||
            (period.year === prevMonthYear && period.month === prevMonth)
          );
        });
      }

      if (selectedStatus === 'not_sent') {
        filtered = filtered.filter(
          receipt => !receipt.metadata || !(receipt.metadata as any).sent_at,
        );
      }

      if (selectedStatus === 'sent') {
        filtered = filtered.filter(
          receipt => receipt.metadata && (receipt.metadata as any).sent_at,
        );
      }

      return filtered.sort(
        (a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime(),
      );
    },
    [searchQuery, selectedStatus, isStaff, isAdmin],
  );

  const groupReceiptsByPeriod = useCallback(
    (receipts: Receipt[]): ReceiptSection[] => {
      const groups = receipts.reduce((acc: Record<string, ReceiptSection>, receipt) => {
        if (!receipt.payment_period?.month || !receipt.payment_period.year) return acc;
        const period = formatPeriod(receipt.payment_period);
        if (!acc[period]) {
          acc[period] = {
            title: period,
            data: [],
            total: 0,
            stats: {},
            date: new Date(receipt.payment_period.year, receipt.payment_period.month - 1),
          };
        }
        acc[period].data.push(receipt);
        acc[period].total +=
          receipt.netAmount ??
          Math.max(
            0,
            parseFloat(String(receipt.amount || 0)) -
              parseFloat(String(receipt.refunded_amount || 0)),
          );
        const statusKey = receipt.displayStatus || receipt.status || 'paid';
        acc[period].stats[statusKey] = (acc[period].stats[statusKey] || 0) + 1;
        return acc;
      }, {});

      const sortedGroups = Object.values(groups).sort(
        (a, b) => b.date.getTime() - a.date.getTime(),
      );

      // Limit to displayed months unless we're filtering by a specific contract or searching
      return params.contract_id || searchQuery
        ? sortedGroups
        : sortedGroups.slice(0, displayedMonths);
    },
    [displayedMonths, params.contract_id, searchQuery],
  );

  // Memoize sections to prevent infinite re-renders with sticky headers
  const sections = useMemo(() => {
    return groupReceiptsByPeriod(filterAndSortReceipts(formattedReceipts));
  }, [formattedReceipts, filterAndSortReceipts, groupReceiptsByPeriod]);

  // Auto-expand periods by default or when filtering by contract_id
  useEffect(() => {
    if (sections.length > 0) {
      setExpandedPeriods(prev => {
        if (prev.size === 0) {
          return new Set(sections.map(s => s.title));
        }
        return prev;
      });
    }
  }, [sections]);

  const renderPeriodHeader = ({ section }: { section: ReceiptSection }) => (
    <SectionGroup
      title={section.title}
      subtitle={
        <Text variant="bodySmall">
          {isAdmin && (
            <>
              Total:{' '}
              {defaultCurrency
                ? formatWithCurrency(section.total, defaultCurrency)
                : section.total.toString()}{' '}
              •{' '}
            </>
          )}
          {section.data.length} {section.data.length === 1 ? 'Receipt' : 'Receipts'}
        </Text>
      }
      isExpanded={expandedPeriods.has(section.title)}
      onToggle={() => {
        setExpandedPeriods(prev => {
          const next = new Set(prev);
          if (next.has(section.title)) {
            next.delete(section.title);
          } else {
            next.add(section.title);
          }
          return next;
        });
      }}
    />
  );

  const renderReceipt = ({ item }: { item: Receipt }) => {
    const refundedAmount = parseFloat(String(item.refunded_amount || 0));
    const netAmount =
      item.netAmount !== undefined && item.netAmount !== null
        ? parseFloat(String(item.netAmount))
        : Math.max(0, parseFloat(String(item.amount || 0)) - refundedAmount);
    const hasRefund = refundedAmount > 0;

    return (
      <Surface
        style={[
          styles.receiptCard,
          {
            borderColor: getStatusColor(item.displayStatus || ''),
            borderWidth: 1,
          },
        ]}
      >
        <View
          style={[
            styles.watermark,
            { borderColor: getStatusColor(item.displayStatus || '') },
          ]}
        >
          <Text
            variant="headlineMedium"
            style={[
              styles.watermarkText,
              { color: getStatusColor(item.displayStatus || '') },
            ]}
          >
            {formatReceiptStatusLabel(item.displayStatus || '')}
          </Text>
        </View>

        <View key={`receipt-${item.id}`} style={styles.receiptHeader}>
          <View style={styles.tenantInfo}>
            <View style={styles.nameContainer}>
              <MaterialCommunityIcons
                name="account"
                size={20}
                color={colors.onSurfaceVariant}
              />
              <Text variant="titleMedium" style={styles.nameText}>
                {item.tenantName}
              </Text>
            </View>
            <View style={styles.propertyContainer}>
              <MaterialCommunityIcons
                name="home"
                size={16}
                color={colors.onSurfaceVariant}
              />
              <Text
                variant="bodySmall"
                style={[styles.propertyText, { color: colors.onSurfaceVariant }]}
              >
                {item.propertyName && item.propertyName !== 'Unknown'
                  ? item.houseNumber && item.houseNumber !== 'Unknown'
                    ? `${item.propertyName} - Room ${item.houseNumber}`
                    : item.propertyName
                  : item.houseNumber && item.houseNumber !== 'Unknown'
                    ? `Room ${item.houseNumber}`
                    : 'Unassigned Property'}
              </Text>
            </View>
            <View style={styles.dateContainer}>
              <MaterialCommunityIcons
                name="calendar"
                size={16}
                color={colors.onSurfaceVariant}
              />
              <Text
                variant="bodySmall"
                style={[
                  styles.dateText,
                  { color: colors.onSurfaceVariant, flexShrink: 1 },
                ]}
              >
                Period:{' '}
                {item.payment_period && item.payment_period.month > 0
                  ? formatPeriod(item.payment_period)
                  : 'N/A'}
                {hasRefund && (
                  <Text style={{ color: colors.error, fontStyle: 'italic' }}>
                    {' '}
                    {formatRefundText(refundedAmount, defaultCurrency, item.refunded_at)}
                  </Text>
                )}
              </Text>
            </View>
            {item.hasWaiver &&
              !(
                item.waiverType === 'partial' &&
                item.contractRent &&
                item.amount >= item.contractRent - 0.1
              ) && (
                <View style={styles.dateContainer}>
                  <MaterialCommunityIcons
                    name="calendar-check"
                    size={16}
                    color={colors.primary}
                  />
                  <Text
                    variant="bodySmall"
                    style={[
                      styles.dateText,
                      { color: colors.primary, fontWeight: 'bold' },
                    ]}
                  >
                    {item.waiverType === 'full'
                      ? 'Full Waiver Applied'
                      : 'Partial Waiver Applied'}
                  </Text>
                </View>
              )}
            <View style={styles.dateContainer}>
              <MaterialCommunityIcons
                name="clock"
                size={16}
                color={colors.onSurfaceVariant}
              />
              <Text
                variant="bodySmall"
                style={[styles.dateText, { color: colors.onSurfaceVariant }]}
              >
                Payment Date: {new Date(item.payment_date).toLocaleDateString()}
              </Text>
            </View>
          </View>
          <View style={styles.amountContainer}>
            <Text variant="titleMedium" style={styles.amount}>
              {defaultCurrency
                ? formatWithCurrency(netAmount, defaultCurrency)
                : netAmount.toString()}
            </Text>
            <View style={styles.rightColumn}>
              <Menu
                visible={menuVisible === item.id}
                onDismiss={() => setMenuVisible(null)}
                anchor={
                  <IconButton
                    icon="dots-vertical"
                    size={20}
                    onPress={() => setMenuVisible(item.id)}
                    style={styles.menuButton}
                  />
                }
              >
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(null);
                    handleViewReceipt(item);
                  }}
                  title="View Receipt"
                  leadingIcon="eye"
                />
                {can('edit', 'receipt') && (
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(null);
                      handleEditReceipt(item);
                    }}
                    title="Edit Receipt"
                    leadingIcon="pencil"
                  />
                )}
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(null);
                    handleShareReceipt(item);
                  }}
                  title="Share PDF"
                  leadingIcon="share"
                />
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(null);
                    handleSendEmailInitiate(item);
                  }}
                  title="Send Email"
                  disabled={!!sendingEmail || !item.tenant?.email}
                  leadingIcon="email"
                />
                {can('delete', 'receipt') && (
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(null);
                      setSelectedReceipt(item);
                      setDeleteDialogVisible(true);
                    }}
                    title="Delete Receipt"
                    leadingIcon="delete"
                    titleStyle={{ color: colors.error }}
                  />
                )}
              </Menu>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {item.metadata && (item.metadata as any).sent_at && (
                  <SPressable
                    onPress={() => {
                      setSentInfoReceipt(item);
                      setShowSentInfoModal(true);
                    }}
                    style={[styles.linkedMessagesIcon, { marginTop: 0 }]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <MaterialCommunityIcons
                        name="email-check"
                        size={12}
                        color={colors.success}
                      />
                      <Text
                        variant="bodySmall"
                        style={[styles.linkedMessagesCount, { color: colors.success }]}
                      >
                        Sent
                      </Text>
                    </View>
                  </SPressable>
                )}
                {getLinkedMessagesCount(item.linked_payment_messages) > 0 && (
                  <View style={[styles.linkedMessagesIcon, { marginTop: 0 }]}>
                    <MaterialCommunityIcons
                      name="message-text"
                      size={12}
                      color={colors.primary}
                    />
                    <Text
                      variant="bodySmall"
                      style={[styles.linkedMessagesCount, { color: colors.primary }]}
                    >
                      {getLinkedMessagesCount(item.linked_payment_messages)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>
      </Surface>
    );
  };

  const getLinkedMessagesCount = (
    linkedPaymentMessages?: LinkedPaymentMessage[],
  ): number => {
    if (
      !linkedPaymentMessages ||
      !Array.isArray(linkedPaymentMessages) ||
      linkedPaymentMessages.length === 0
    ) {
      return 0;
    }
    return linkedPaymentMessages.length;
  };

  const getStatusColor = (status: string): string =>
    getReceiptStatusColor(status, colors);

  const handleLoadMore = useCallback(() => {
    setLoadingMore(true);
    setDisplayedMonths(prev => prev + 5);
    setTimeout(() => setLoadingMore(false), 500);
  }, []);

  // Calculate total available months AFTER filtering but BEFORE slicing
  const totalFilteredMonths = useMemo(() => {
    const filtered = filterAndSortReceipts(formattedReceipts);
    const groups = filtered.reduce((acc: Record<string, any>, receipt) => {
      if (!receipt.payment_period?.month || !receipt.payment_period.year) return acc;
      const period = formatPeriod(receipt.payment_period);
      acc[period] = true;
      return acc;
    }, {});
    return Object.keys(groups).length;
  }, [formattedReceipts, filterAndSortReceipts]);

  const totalMonths = totalFilteredMonths;

  if (accessLoading || isTablesLoading) {
    return <LoadingCard iconName="receipt" text="Loading receipts..." />;
  }

  if (isTenantOnly && !tenantId) {
    return (
      <EmptyState
        icon="account-lock-outline"
        title="Permission Denied"
        description="You do not have permission to view receipts. Please contact your administrator to be assigned as a tenant."
        style={{ backgroundColor: colors.background }}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <BaseSearch
        placeholder="Search receipts..."
        value={searchQuery}
        onChangeText={setSearchQuery}
        onClear={() => {
          setSearchQuery('');
          router.setParams({ contract_id: undefined } as any);
        }}
        rightIcon="close-circle"
        leftIcon="magnify"
      />

      <View style={styles.filterContainer}>
        <FilterButtons
          options={[
            { label: 'All', value: 'all', icon: 'layers-outline' },
            { label: 'Fully Paid', value: 'paid', icon: 'check-circle' },
            { label: 'Partial', value: 'partial', icon: 'clock-outline' },
            { label: 'Sent', value: 'sent', icon: 'email-check-outline' },
            { label: 'Not Sent', value: 'not_sent', icon: 'message-alert-outline' },
            { label: 'Partial Refund', value: 'partial_refund', icon: 'cash-refund' },
            { label: 'Refunded', value: 'refunded', icon: 'cash-refund' },
            { label: 'Waived', value: 'waived', icon: 'calendar-check' },
            { label: 'Promotions', value: 'promo', icon: 'tag-outline' },
          ]}
          selectedValue={selectedStatus}
          onValueChange={val => setSelectedStatus(val || 'all')}
        />
      </View>

      <SectionList
        style={{ flex: 1 }}
        sections={sections}
        extraData={{ formattedReceipts, expandedPeriods, menuVisible }}
        keyExtractor={item => item.id}
        contentContainerStyle={[
          styles.listContent,
          sections.length === 0 && styles.emptyContainer,
        ]}
        renderItem={({ item, section }) =>
          expandedPeriods.has(section.title) ? renderReceipt({ item }) : null
        }
        renderSectionHeader={renderPeriodHeader}
        stickySectionHeadersEnabled={false}
        removeClippedSubviews={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={10}
        ListEmptyComponent={
          refreshing || isInitialSyncing ? (
            <LoadingCard iconName="receipt" text="Loading receipts..." />
          ) : (
            <EmptyState
              icon="receipt"
              title={
                isTenantOnly ? 'No receipts found for your account' : 'No receipts found'
              }
            />
          )
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />

      {/* Load More Button */}
      {isAdmin &&
        !params.contract_id &&
        !searchQuery &&
        displayedMonths < totalMonths &&
        totalMonths > 0 && (
          <View style={styles.loadMoreContainer}>
            <Button
              mode="outlined"
              onPress={handleLoadMore}
              loading={loadingMore}
              disabled={loadingMore}
              style={styles.loadMoreButton}
              icon="chevron-down"
            >
              Load More ({totalMonths - displayedMonths} month
              {totalMonths - displayedMonths !== 1 ? 's' : ''} remaining)
            </Button>
          </View>
        )}

      <Portal>
        <BaseModal
          visible={emailModalVisible}
          onDismiss={() => !sendingEmail && setEmailModalVisible(false)}
          mode="confirm"
          title="Send Receipt Email"
          message={`Would you like to send this receipt to ${receiptToEmail?.tenantName} at ${receiptToEmail?.tenant?.email}?`}
          confirmText="Send Now"
          onConfirm={handleSendEmail}
          loading={!!sendingEmail}
          showProgress={!!sendingEmail}
          progress={emailProgress}
          progressLabel={emailProgressLabel}
        />

        <BaseModal
          mode="info"
          visible={warningVisible}
          onDismiss={() => setWarningVisible(false)}
          title="Cannot Create Receipt"
          subtitle="Manage payments and receipts"
          message="Unable to create receipt. Please check your data and try again."
        />

        <BaseModal
          mode="confirm"
          visible={deleteDialogVisible}
          onDismiss={() => setDeleteDialogVisible(false)}
          onConfirm={handleDeleteReceipt}
          title="Delete Receipt"
          message={`Are you sure you want to delete receipt #${selectedReceipt?.id.slice(-6).toUpperCase()}? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          loading={deleteLoading}
          destructive={true}
        />
        <BaseModal
          visible={showSentInfoModal}
          onDismiss={() => setShowSentInfoModal(false)}
          title="Delivery Info"
          mode="info"
        >
          {sentInfoReceipt && (
            <View style={{ gap: 12 }}>
              {/* Recipient Row */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <MaterialCommunityIcons
                  name="email-outline"
                  size={22}
                  color={colors.primary}
                  style={{ opacity: 0.8 }}
                />
                <View>
                  <Text
                    variant="labelSmall"
                    style={{ opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1 }}
                  >
                    Sent To
                  </Text>
                  <Text variant="bodyLarge" style={{ fontWeight: '500' }}>
                    {sentInfoReceipt.tenant?.email}
                  </Text>
                </View>
              </View>

              {/* Timestamp Row */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <MaterialCommunityIcons
                  name="clock-check-outline"
                  size={22}
                  color={colors.success}
                  style={{ opacity: 0.8 }}
                />
                <View>
                  <Text
                    variant="labelSmall"
                    style={{ opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1 }}
                  >
                    Delivered At
                  </Text>
                  <Text variant="bodyLarge" style={{ fontWeight: '500' }}>
                    {new Date((sentInfoReceipt.metadata as any).sent_at).toLocaleString(
                      undefined,
                      {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      },
                    )}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </BaseModal>

        {activeContract && (
          <MpesaPaymentModal
            visible={mpesaPaymentModalVisible}
            onDismiss={() => setMpesaPaymentModalVisible(false)}
            pendingAmount={parseFloat(String(activeContract.rent_amount)) || 0}
            contractId={activeContract.id}
            tenantId={activeContract.tenant_id || ''}
            businessId={selectedBusiness?.id || ''}
            tenantName={tenants.find(t => t.id === tenantId)?.name || 'Tenant'}
            initialPhone={tenants.find(t => t.id === tenantId)?.phone || ''}
          />
        )}
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  receiptCard: {
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
    opacity: 0.3,
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
  receiptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  tenantInfo: {
    flex: 1,
    marginRight: 16,
  },
  amountContainer: {
    alignItems: 'flex-end',
  },
  rightColumn: {
    alignItems: 'flex-end',
    position: 'relative',
    justifyContent: 'flex-start',
  },
  linkedMessagesIcon: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    gap: 4,
  },
  linkedMessagesCount: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  dateText: {
    marginTop: 2,
  },
  menuButton: {
    margin: 0,
    marginTop: 4,
  },
  loadMoreContainer: {
    padding: 16,
    alignItems: 'center',
  },
  loadMoreButton: {
    width: '100%',
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
  propertyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  propertyText: {
    flex: 1,
  },
  dateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  amount: {
    fontWeight: 'bold',
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
