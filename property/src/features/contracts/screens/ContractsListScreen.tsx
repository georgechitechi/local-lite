import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { File } from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import type { BatchMutation } from 'local-lite';
import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  IconButton,
  Menu,
  Portal,
  Surface,
  Text,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import ContractActionModal, {
  type ContractActionType,
} from '@/features/contracts/components/ContractActionModal';
import { useIdleLock } from '@/providers/LockScreenProvider';
import AccessGuard from '@/shared/components/AccessGuard';
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
  useHousesById,
  useIsInitialSyncing,
  usePropertiesById,
  useReceipts,
  useSettings,
  useStoreRefresh,
  useTenantsById,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { sendContractEmail } from '@/shared/services/emailService';
import {
  formatDate,
  formatDateForDB,
  formatWithCurrency,
} from '@/shared/utils/formatters';
import { snakeCaseToTitleCase, toLowerCase } from '@/shared/utils/helper';
import {
  calculatePausedBreaks,
  calculateResumedBreaks,
  isActiveContractStatus,
  isContractPaused,
  isFormerContractStatus,
  resolveHouseStatusFromContracts,
} from '@/shared/utils/statusHelper';
import { generateContractPDF } from '@/templates/contractTemplate';

interface Contract {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  house_id?: string;
  tenant_id: string;
  monthlyRent?: number | string;
  tenantName?: string;
  propertyName?: string;
  roomNumber?: string;
  tenant?: {
    name?: string;
    email?: string;
  };
  house?: {
    house_number?: string;
    property?: {
      name?: string;
    };
    monthly_rent?: number | string;
  };
  metadata?: Record<string, any>;
}

interface ContractSection {
  title: string;
  data: Contract[];
  total: number;
}

export default function ContractsScreen() {
  const router = useRouter();
  const { selectedBusiness } = useBusiness();
  const { loading: accessLoading, can } = useAccessControl();
  const colors = useThemeColors();
  const { pauseAutoLock } = useIdleLock();
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const params = useLocalSearchParams<{ search?: string }>();
  const [searchQuery, setSearchQuery] = useState(params.search || '');
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Update search query when params change (if they differ from current state)
  React.useEffect(() => {
    if (params.search && params.search !== searchQuery) {
      setSearchQuery(params.search as string);
      // Consume the parameter to prevent re-triggering on manual clear
      router.setParams({ search: undefined } as any);
    }
  }, [params.search, searchQuery, router]);

  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(
    new Set(['active', 'expiring_soon', 'expired', 'terminated', 'unknown']),
  );
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [statusUpdateDialogVisible, setStatusUpdateDialogVisible] = useState(false);
  const [selectedStatusToUpdate, setSelectedStatusToUpdate] = useState<string>('');
  const [emailLoading, setEmailLoading] = useState<string | null>(null);
  const [showSentInfoModal, setShowSentInfoModal] = useState(false);
  const [sentInfoContract, setSentInfoContract] = useState<Contract | null>(null);
  const [sendConfirmVisible, setSendConfirmVisible] = useState(false);
  const [actionModalVisible, setActionModalVisible] = useState(false);
  const [actionType, setActionType] = useState<ContractActionType | null>(null);
  const [actionDate, setActionDate] = useState(formatDateForDB(new Date()));
  const [selectedContractForAction, setSelectedContractForAction] =
    useState<Contract | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Local-Lite Live Queries & Core Mutations
  const rawContracts = useContracts(selectedBusiness?.id);
  const receipts = useReceipts(selectedBusiness?.id);
  const settings = useSettings(selectedBusiness?.id);
  const { batch, update } = useCoreMutations();
  const { refreshing, onRefresh } = useStoreRefresh();
  const isInitialSyncing = useIsInitialSyncing();

  const housesById = useHousesById(selectedBusiness?.id);
  const propertiesById = usePropertiesById(selectedBusiness?.id);
  const tenantsById = useTenantsById(selectedBusiness?.id);

  const contracts = useMemo(() => {
    if (!rawContracts) return [];

    return rawContracts.map(contract => {
      const house = contract.house_id ? housesById.get(contract.house_id) : undefined;
      const property = house?.property_id
        ? propertiesById.get(house.property_id)
        : undefined;
      const tenant = contract.tenant_id ? tenantsById.get(contract.tenant_id) : undefined;

      return {
        ...contract,
        tenant,
        tenantName:
          typeof tenant?.name === 'string' && tenant.name
            ? tenant.name
            : 'Unknown Tenant',
        propertyName:
          typeof property?.name === 'string' && property.name
            ? property.name
            : 'Unknown Property',
        roomNumber: house?.house_number != null ? String(house.house_number) : 'N/A',
        monthlyRent: contract.rent_amount || house?.monthly_rent || 0,
        status: typeof contract.status === 'string' ? contract.status : 'unknown',
      };
    }) as Contract[];
  }, [rawContracts, housesById, propertiesById, tenantsById]);

  const contractStatusItems = useMemo(
    () => [
      {
        id: 'active',
        title: 'Active',
        color: (colors as any).success,
        disabled: selectedContract?.status === 'active',
      },
      {
        id: 'expiring_soon',
        title: 'Expiring Soon',
        color: (colors as any).warning,
        disabled: selectedContract?.status === 'expiring_soon',
      },
      {
        id: 'expired',
        title: 'Expired',
        color: (colors as any).warning,
        disabled: selectedContract?.status === 'expired',
      },
      {
        id: 'terminated',
        title: 'Terminated',
        color: colors.error,
        disabled: selectedContract?.status === 'terminated',
      },
    ],
    [selectedContract, colors],
  );

  // Memoized sections: filter + group in one pass
  const sections = useMemo(() => {
    const filtered = contracts
      .filter(contract => {
        const matchesSearch =
          toLowerCase(contract.tenantName || '').includes(
            toLowerCase(deferredSearchQuery),
          ) ||
          toLowerCase(contract.roomNumber || '').includes(
            toLowerCase(deferredSearchQuery),
          ) ||
          toLowerCase(contract.propertyName || '').includes(
            toLowerCase(deferredSearchQuery),
          );

        let matchesStatus = false;
        const normStatus = toLowerCase(contract.status || '');
        if (selectedStatus === 'all') {
          matchesStatus = true;
        } else if (selectedStatus === 'paused') {
          matchesStatus = isContractPaused(contract);
        } else if (selectedStatus === 'active') {
          matchesStatus = normStatus === 'active' && !isContractPaused(contract);
        } else {
          matchesStatus = normStatus === toLowerCase(selectedStatus);
        }

        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => {
        const propA = String(a.propertyName || '');
        const propB = String(b.propertyName || '');
        if (propA < propB) return -1;
        if (propA > propB) return 1;

        const roomA = String(a.roomNumber || '');
        const roomB = String(b.roomNumber || '');

        const numA = parseInt(roomA, 10);
        const numB = parseInt(roomB, 10);
        if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) {
          return numA - numB;
        }

        if (roomA < roomB) return -1;
        if (roomA > roomB) return 1;
        return 0;
      });

    const groups = filtered.reduce((acc: Record<string, ContractSection>, contract) => {
      if (!acc[contract.status]) {
        acc[contract.status] = {
          title: snakeCaseToTitleCase(contract.status),
          data: [],
          total: 0,
        };
      }
      acc[contract.status].data.push(contract);
      acc[contract.status].total += parseFloat(String(contract.monthlyRent || 0));
      return acc;
    }, {});

    const statusOrder = ['active', 'expiring_soon', 'expired', 'terminated'];
    return Object.entries(groups)
      .sort((a, b) => {
        const aIndex = statusOrder.indexOf(a[0]);
        const bIndex = statusOrder.indexOf(b[0]);
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      })
      .map(([_, group]) => group);
  }, [contracts, deferredSearchQuery, selectedStatus]);

  // Auto-expand sections by default
  React.useEffect(() => {
    if (sections.length > 0) {
      setExpandedStatuses(prev => {
        if (prev.size === 0) {
          return new Set(sections.map(s => s.title.toLowerCase()));
        }
        return prev;
      });
    }
  }, [sections]);

  const renderStatusHeader = useCallback(
    ({ section }: { section: ContractSection }) => (
      <SectionGroup
        title={snakeCaseToTitleCase(section.title)}
        subtitle={
          can('view', 'report')
            ? `Total Monthly Rent: ${defaultCurrency ? formatWithCurrency(section.total, defaultCurrency) : section.total}`
            : `Total Contracts: ${section.data.length}`
        }
        isExpanded={expandedStatuses.has(section.title.toLowerCase())}
        onToggle={() => {
          setExpandedStatuses(prev => {
            const next = new Set(prev);
            if (next.has(section.title.toLowerCase())) {
              next.delete(section.title.toLowerCase());
            } else {
              next.add(section.title.toLowerCase());
            }
            return next;
          });
        }}
        containerStyle={styles.statusHeader}
      />
    ),
    [expandedStatuses, can, defaultCurrency],
  );

  const getStatusWatermarkColor = (status: string): string => {
    if (isActiveContractStatus(status)) {
      if (status === 'expiring_soon') return colors.info;
      return colors.success;
    }
    if (isFormerContractStatus(status)) {
      if (status === 'expired') return colors.warning;
      return colors.error;
    }
    return colors.onSurfaceVariant;
  };

  const renderContract = ({ item }: { item: Contract }) => {
    const statusColor = getStatusWatermarkColor(item.status);

    return (
      <Surface
        style={[
          styles.contractCard,
          {
            borderColor: isContractPaused(item) ? colors.warning : statusColor,
            borderWidth: 1,
          },
        ]}
      >
        {isContractPaused(item) && (
          <View style={[styles.watermark, { borderColor: colors.warning }]}>
            <Text
              variant="headlineMedium"
              style={[styles.watermarkText, { color: colors.warning }]}
            >
              PAUSED
            </Text>
          </View>
        )}
        <View key={`contract-${item.id}`} style={styles.contractHeader}>
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
              <Text variant="bodySmall" style={styles.propertyText}>
                {`${item.propertyName} - Room ${item.roomNumber}`}
              </Text>
            </View>
            <View style={styles.dateContainer}>
              <MaterialCommunityIcons
                name="calendar-start"
                size={16}
                color={colors.onSurfaceVariant}
              />
              <Text variant="bodySmall" style={styles.dateText}>
                Start Date: {formatDate(item.start_date)}
              </Text>
            </View>
            <View style={styles.dateContainer}>
              <MaterialCommunityIcons
                name="calendar-end"
                size={16}
                color={colors.onSurfaceVariant}
              />
              <Text variant="bodySmall" style={styles.dateText}>
                End Date: {formatDate(item.end_date)}
              </Text>
            </View>
          </View>
          <View style={styles.rentContainer}>
            <Text variant="titleMedium">
              {defaultCurrency
                ? formatWithCurrency(
                    parseFloat(String(item.monthlyRent || 0)),
                    defaultCurrency,
                  )
                : item.monthlyRent?.toString()}
            </Text>
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
                  router.push(`/contracts/view/${item.id}`);
                }}
                title="View Contract"
                leadingIcon="eye"
              />
              <Menu.Item
                onPress={() => {
                  setMenuVisible(null);
                  router.push(`/contracts/edit/${item.id}`);
                }}
                title="Edit Contract"
                leadingIcon="pencil"
              />
              <Menu.Item
                onPress={() => {
                  setMenuVisible(null);
                  router.push(`/receipts?contract_id=${item.id}`);
                }}
                title="View Receipts"
                leadingIcon="receipt"
              />
              <Menu.Item
                onPress={() => {
                  setMenuVisible(null);
                  setSelectedContract(item);
                  setSelectedStatusToUpdate(item.status);
                  setStatusUpdateDialogVisible(true);
                }}
                title="Update Status"
                leadingIcon="list-status"
              />
              {isActiveContractStatus(item.status) &&
                (!isContractPaused(item) ? (
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(null);
                      handlePauseContract(item);
                    }}
                    title="Pause Contract"
                    leadingIcon="pause-circle-outline"
                  />
                ) : (
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(null);
                      handleResumeContract(item);
                    }}
                    title="Resume Contract"
                    leadingIcon="play-circle-outline"
                  />
                ))}
              <Menu.Item
                onPress={() => {
                  setMenuVisible(null);
                  pauseAutoLock();
                  handleSendEmail(item);
                }}
                title="Send Email"
                leadingIcon={
                  emailLoading === item.id
                    ? () => <ActivityIndicator size="small" />
                    : 'email-fast-outline'
                }
                disabled={!!emailLoading}
              />
              <Menu.Item
                onPress={() => {
                  setMenuVisible(null);
                  pauseAutoLock();
                  handleSharePDF(item);
                }}
                title="Share PDF"
                leadingIcon="share-variant-outline"
              />
              {can('delete', 'contract') && (
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(null);
                    setSelectedContract(item);
                    setDeleteDialogVisible(true);
                  }}
                  title="Delete Contract"
                  leadingIcon="delete"
                  titleStyle={{ color: colors.error }}
                />
              )}
            </Menu>

            {item.metadata && (item.metadata as any).sent_at && (
              <SPressable
                onPress={() => {
                  setSentInfoContract(item);
                  setShowSentInfoModal(true);
                }}
                style={{ marginTop: 4 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text
                    variant="labelSmall"
                    style={{ color: colors.success, fontSize: 12 }}
                  >
                    Sent
                  </Text>
                  <MaterialCommunityIcons
                    name="email-check-outline"
                    size={16}
                    color={colors.success}
                  />
                </View>
              </SPressable>
            )}
          </View>
        </View>
      </Surface>
    );
  };

  const handleDelete = async () => {
    if (!selectedContract || !selectedBusiness?.id) return;

    // Check for linked receipts before deletion
    const linkedReceipts = receipts.filter(r => r.contract_id === selectedContract.id);

    if (linkedReceipts.length > 0) {
      setDeleteDialogVisible(false);
      showSnackbar(
        `This contract has ${linkedReceipts.length} linked receipt(s). Please delete or reassign the receipts first before deleting the contract.`,
        'error',
        {
          label: 'View Receipts',
          onPress: () => router.push(`/receipts?contract_id=${selectedContract.id}`),
        },
      );
      return;
    }

    setDeleteLoading(true);
    try {
      const mutations: BatchMutation[] = [];

      // Step 1: Update house status if applicable
      if (selectedContract.house_id) {
        const houseId = selectedContract.house_id;
        const houseData = housesById.get(houseId);
        const remainingContracts = rawContracts.filter(c => c.id !== selectedContract.id);
        mutations.push({
          tableName: 'houses',
          operation: 'UPDATE',
          payload: {
            ...houseData,
            status: resolveHouseStatusFromContracts(
              houseData?.status,
              remainingContracts,
              houseId,
            ),
          },
          rowId: houseId,
        });
      }

      // Step 2: Delete the contract (Soft Delete)
      mutations.push({
        tableName: 'contracts',
        operation: 'UPDATE',
        payload: {
          status: 'terminated',
          deleted: true,
        },
        rowId: selectedContract.id,
      });

      await batch(mutations);

      setDeleteDialogVisible(false);
      showSnackbar('Contract deleted successfully', 'success');
    } catch (error) {
      console.error('Error deleting contract:', error);
      showSnackbar('Failed to delete contract', 'error');
    } finally {
      setDeleteLoading(false);
      setSelectedContract(null);
    }
  };

  const handleStatusUpdate = async (statusOverride?: string) => {
    if (!selectedContract || !selectedBusiness?.id) return;

    const finalStatus = statusOverride || selectedStatusToUpdate;
    if (!finalStatus) return;

    try {
      setLoading(true);

      const updateData: any = {
        status: finalStatus,
      };

      // If terminating, set end date to today
      if (finalStatus === 'terminated') {
        updateData.end_date = formatDateForDB(new Date());
      }

      const mutations: BatchMutation[] = [
        {
          tableName: 'contracts',
          operation: 'UPDATE',
          payload: updateData,
          rowId: selectedContract.id,
        },
      ];

      // Update house status if needed
      if (selectedContract.house_id) {
        const houseId = selectedContract.house_id;
        const houseData = housesById.get(houseId);
        const contractsAfterUpdate = rawContracts.map(c =>
          c.id === selectedContract.id ? { ...c, status: finalStatus } : c,
        );
        mutations.push({
          tableName: 'houses',
          operation: 'UPDATE',
          payload: {
            ...houseData,
            status: resolveHouseStatusFromContracts(
              houseData?.status,
              contractsAfterUpdate,
              houseId,
            ),
          },
          rowId: houseId,
        });
      }

      await batch(mutations);

      setStatusUpdateDialogVisible(false);
      showSnackbar('Contract status updated successfully', 'success');
    } catch (error) {
      console.error('Error updating contract status:', error);
      showSnackbar('Failed to update contract status', 'error');
    } finally {
      setLoading(false);
      setSelectedContract(null);
    }
  };

  const handlePauseContract = (contract: Contract) => {
    setSelectedContractForAction(contract);
    setActionType('pause');
    setActionDate(formatDateForDB(new Date()));
    setActionModalVisible(true);
  };

  const handleResumeContract = (contract: Contract) => {
    setSelectedContractForAction(contract);
    setActionType('resume');
    setActionDate(formatDateForDB(new Date()));
    setActionModalVisible(true);
  };

  const executeContractAction = async () => {
    if (!selectedContractForAction || !actionType) return;

    try {
      setActionLoading(true);
      if (actionType === 'pause') {
        await update('contracts', selectedContractForAction.id, {
          metadata: calculatePausedBreaks(selectedContractForAction.metadata, actionDate),
        });
        showSnackbar('Contract paused successfully', 'success');
      } else if (actionType === 'resume') {
        await update('contracts', selectedContractForAction.id, {
          metadata: calculateResumedBreaks(
            selectedContractForAction.metadata,
            actionDate,
          ),
        });
        showSnackbar('Contract resumed successfully', 'success');
      }
      setActionModalVisible(false);
    } catch (error) {
      console.error(`Error ${actionType}ing contract:`, error);
      showSnackbar(`Failed to ${actionType} contract`, 'error');
    } finally {
      setActionLoading(false);
      setSelectedContractForAction(null);
      setActionType(null);
    }
  };

  const handleSendEmail = async (contract: Contract) => {
    const tenant = contract.tenant_id ? tenantsById.get(contract.tenant_id) : undefined;
    if (!tenant?.email) {
      showSnackbar('Tenant has no email address configured', 'error');
      return;
    }
    setSelectedContract(contract);
    setSendConfirmVisible(true);
  };

  const confirmSendEmail = async () => {
    const contract = selectedContract;
    if (!contract || !selectedBusiness?.id) return;

    const tenant = contract.tenant_id ? tenantsById.get(contract.tenant_id) : undefined;
    if (!tenant?.email) return;

    setSendConfirmVisible(false);
    setEmailLoading(contract.id);
    try {
      // 1. Get contract settings
      const settingsData = settings.find(s => s.setting_key === 'contract_settings');
      const contractSettings = (settingsData?.setting_value as any) || {};

      // 2. Prepare contract data for PDF generator
      const house = contract.house_id ? housesById.get(contract.house_id) : undefined;
      const property = house?.property_id
        ? propertiesById.get(house.property_id)
        : undefined;

      const contractData = {
        tenant: tenant as any,
        property: property as any,
        contract: {
          ...contract,
          rent_amount: Number(contract.monthlyRent || 0),
          house: house as any,
        },
      };

      // 3. Generate PDF URI
      const uri = await generateContractPDF(
        contractData as any,
        selectedBusiness as any,
        contractSettings,
      );

      // 4. Read as base64
      const pdfBase64 = await new File(uri).base64();

      // 5. Send email
      await sendContractEmail(
        { name: tenant.name, email: tenant.email },
        selectedBusiness,
        contract.id,
        pdfBase64,
      );

      // 6. Update metadata
      await update('contracts', contract.id, {
        metadata: {
          ...(contract.metadata || {}),
          sent_at: new Date().toISOString(),
        },
      });

      showSnackbar('Contract emailed successfully', 'success');
    } catch (error: any) {
      console.error('Error sending contract email:', error);
      showSnackbar(`Failed to send email: ${error.message}`, 'error');
    } finally {
      setEmailLoading(null);
    }
  };

  const handleSharePDF = async (contract: Contract) => {
    if (!contract || !selectedBusiness?.id) return;

    try {
      setLoading(true);
      // 1. Get contract settings
      const settingsData = settings.find(s => s.setting_key === 'contract_settings');
      const contractSettings = (settingsData?.setting_value as any) || {};

      // 2. Prepare contract data for PDF generator
      const house = contract.house_id ? housesById.get(contract.house_id) : undefined;
      const property = house?.property_id
        ? propertiesById.get(house.property_id)
        : undefined;

      const contractData = {
        tenant: contract.tenant_id
          ? (tenantsById.get(contract.tenant_id) as any)
          : undefined,
        property: property as any,
        contract: {
          ...contract,
          rent_amount: Number(contract.monthlyRent || 0),
          house: house as any,
        },
      };

      // 3. Generate and share
      const uri = await generateContractPDF(
        contractData as any,
        selectedBusiness as any,
        contractSettings,
      );

      if (uri) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Share Contract: ${contract.tenantName}`,
          UTI: 'com.adobe.pdf',
        });
        showSnackbar('Contract PDF shared successfully', 'success');
      }
    } catch (error: any) {
      console.error('Error sharing contract PDF:', error);
      showSnackbar(`Failed to share PDF: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (loading || accessLoading) {
    return <LoadingCard iconName="account-cash" text="Loading contracts..." />;
  }

  return (
    <AccessGuard roles={['admin']}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <BaseSearch
          placeholder="Search contracts"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onClear={() => {
            setSearchQuery('');
            router.setParams({ search: undefined } as any);
          }}
          rightIcon="close-circle"
          leftIcon="magnify"
        />

        <View style={styles.filterContainer}>
          <FilterButtons
            options={[
              { label: 'All', value: 'all', icon: 'layers-outline' },
              { label: 'Active', value: 'active', icon: 'check-circle' },
              { label: 'Paused', value: 'paused', icon: 'pause-circle-outline' },
              { label: 'Expiring Soon', value: 'expiring_soon', icon: 'clock-alert' },
              { label: 'Expired', value: 'expired', icon: 'clock-outline' },
              { label: 'Terminated', value: 'terminated', icon: 'close-circle' },
            ]}
            selectedValue={selectedStatus}
            onValueChange={val => setSelectedStatus((val || 'all') as any)}
          />
        </View>

        <SectionList
          style={{ flex: 1 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          sections={sections}
          extraData={{ contracts, expandedStatuses, menuVisible }}
          keyExtractor={item => item.id}
          contentContainerStyle={[
            styles.listContent,
            sections.length === 0 && styles.emptyContainer,
          ]}
          renderItem={({ item, section }) =>
            expandedStatuses.has(section.title.toLowerCase())
              ? renderContract({ item })
              : null
          }
          renderSectionHeader={renderStatusHeader}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={10}
          removeClippedSubviews={false}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            refreshing || isInitialSyncing ? (
              <LoadingCard iconName="file-document-outline" text="Loading contracts..." />
            ) : (
              <EmptyState icon="file-document-outline" title="No contracts found" />
            )
          }
        />

        <Portal>
          <BaseModal
            mode="confirm"
            visible={deleteDialogVisible}
            onDismiss={() => setDeleteDialogVisible(false)}
            onConfirm={handleDelete}
            title="Delete Contract"
            message={`Are you sure you want to delete this contract? This action cannot be undone.`}
            confirmText="Delete"
            cancelText="Cancel"
            loading={deleteLoading}
            destructive={true}
          />

          <StatusUpdateModal
            visible={statusUpdateDialogVisible}
            onDismiss={() => setStatusUpdateDialogVisible(false)}
            title="Update Contract Status"
            subtitle={
              selectedContract ? `Tenant: ${selectedContract.tenantName}` : undefined
            }
            items={contractStatusItems}
            onSelect={status => {
              handleStatusUpdate(status);
            }}
          />

          <BaseModal
            mode="confirm"
            visible={sendConfirmVisible}
            onDismiss={() => setSendConfirmVisible(false)}
            onConfirm={confirmSendEmail}
            title="Send Contract"
            message={`Are you sure you want to email this contract to ${selectedContract?.tenantName} (${selectedContract?.tenant?.email})?`}
            confirmText="Send Email"
            cancelText="Cancel"
            icon="email"
          />

          <BaseModal
            visible={showSentInfoModal}
            onDismiss={() => setShowSentInfoModal(false)}
            title="Contract Delivery Info"
            mode="info"
          >
            {sentInfoContract && (
              <View style={{ gap: 12 }}>
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
                    marginBottom: 4,
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
                    Contract Shared
                  </Text>
                </View>

                <View
                  style={{
                    backgroundColor: colors.surfaceVariant,
                    padding: 16,
                    borderRadius: 12,
                    gap: 12,
                  }}
                >
                  {/* Recipient Row */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <MaterialCommunityIcons
                      name="email-outline"
                      size={20}
                      color={colors.primary}
                    />
                    <View>
                      <Text
                        variant="labelSmall"
                        style={{ opacity: 0.5, textTransform: 'uppercase' }}
                      >
                        Sent To
                      </Text>
                      <Text variant="bodyLarge" style={{ fontWeight: '600' }}>
                        {sentInfoContract.tenant?.email || 'N/A'}
                      </Text>
                    </View>
                  </View>

                  {/* Timestamp Row */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <MaterialCommunityIcons
                      name="clock-check-outline"
                      size={20}
                      color={colors.success}
                    />
                    <View>
                      <Text
                        variant="labelSmall"
                        style={{ opacity: 0.5, textTransform: 'uppercase' }}
                      >
                        Shared On
                      </Text>
                      <Text variant="bodyLarge" style={{ fontWeight: '600' }}>
                        {new Date(
                          (sentInfoContract.metadata as any).sent_at,
                        ).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            )}
          </BaseModal>

          <ContractActionModal
            visible={actionModalVisible}
            onDismiss={() => {
              setActionModalVisible(false);
              setSelectedContractForAction(null);
              setActionType(null);
            }}
            actionType={actionType}
            subtitle={selectedContractForAction?.tenantName}
            actionDate={actionDate}
            onActionDateChange={setActionDate}
            onConfirm={executeContractAction}
            loading={actionLoading}
          />
        </Portal>
      </View>
    </AccessGuard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contractCard: {
    margin: 8,
    padding: 16,
    borderRadius: 12,
    position: 'relative',
    overflow: 'hidden',
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
  contractHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  tenantInfo: {
    flex: 1,
    marginRight: 16,
  },
  rentContainer: {
    alignItems: 'flex-end',
  },
  dateText: {
    marginTop: 2,
  },
  menuButton: {
    margin: 0,
    marginTop: 4,
  },
  statusHeader: {
    marginBottom: 1,
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
    marginBottom: 2,
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
