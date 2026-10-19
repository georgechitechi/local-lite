import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import type { BatchMutation } from 'local-lite';
import { memo, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Checkbox,
  Chip,
  Divider,
  IconButton,
  Menu,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import ContractActionModal from '@/features/contracts/components/ContractActionModal';
import MergeContractsModal from '@/features/contracts/components/MergeContractsModal';
import BatchRenewModal from './management/BatchRenewModal';
import ContractCard from './management/ContractCard';
import ContractDrilldownModal from './management/ContractDrilldownModal';
import ReinstateTenantsModal from './management/ReinstateTenantsModal';
import type { Contract, ContractAction, Summary } from '@/features/contracts/types';
import PendingRentHousekeepingModal from '@/features/properties/components/PendingRentHousekeepingModal';
import SelectTenantModal from '@/features/tenants/components/SelectTenantModal';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import SPressable from '@/shared/components/SlightPressable';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import {
  useContracts,
  useCoreMutations,
  useHouses,
  useProperties,
  useStoreRefresh,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { supabase } from '@/shared/services/supabase';
import { formatDate, formatDateForDB } from '@/shared/utils/formatters';
import { properCase } from '@/shared/utils/helper';
import {
  calculatePausedBreaks,
  calculateResumedBreaks,
  isActiveContractStatus,
  isContractPaused,
  resolveHouseStatusFromContracts,
} from '@/shared/utils/statusHelper';
import { getAuthStateSnapshot } from '@/stores/authStore';
import { generateContractPDF } from '@/templates/contractTemplate';
import { generateTerminationPDF } from '@/templates/terminationTemplate';

interface ContractManagementModalProps {
  visible: boolean;
  onDismiss: () => void;
}

const ActionButton = ({
  icon,
  title,
  onPress,
  loading,
  disabled,
  mode = 'contained',
  textColor,
}: {
  icon: string;
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  mode?: 'contained' | 'outlined' | 'text';
  textColor?: string;
}) => (
  <Button
    mode={mode}
    icon={icon}
    onPress={onPress}
    loading={loading}
    disabled={disabled}
    style={styles.button}
    contentStyle={{ justifyContent: 'flex-start', paddingLeft: 16, height: 40 }}
    textColor={textColor}
  >
    {title}
  </Button>
);

export default function ContractManagementModal({
  visible,
  onDismiss,
}: ContractManagementModalProps) {
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const { checkOnline } = useOfflineCheck();
  const { requireCloudSync } = useLocalSync();
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  const { can } = useAccessControl();

  const canEdit = can('edit', 'contract');

  const [actionLoading, setActionLoading] = useState(false);
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [loadingContractId, setLoadingContractId] = useState<string | null>(null);
  const [renewDialogVisible, setRenewDialogVisible] = useState(false);
  const [batchRenewDialogVisible, setBatchRenewDialogVisible] = useState(false);
  const [selectedContractForRenewal, setSelectedContractForRenewal] =
    useState<Contract | null>(null);
  const [batchNewEndDate, setBatchNewEndDate] = useState(
    formatDateForDB(new Date(new Date().setFullYear(new Date().getFullYear() + 1))),
  );
  const [newEndDate, setNewEndDate] = useState(
    formatDateForDB(new Date(new Date().setFullYear(new Date().getFullYear() + 1))),
  );
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [newRentAmount, setNewRentAmount] = useState('');

  // Pause / Resume state
  const [actionDialogVisible, setActionDialogVisible] = useState(false);
  const [actionType, setActionType] = useState<ContractAction | null>(null);
  const [actionDate, setActionDate] = useState(formatDateForDB(new Date()));
  const [selectedContractForAction, setSelectedContractForAction] =
    useState<Contract | null>(null);
  const [terminateConfirmVisible, setTerminateConfirmVisible] = useState(false);
  const [showSendRemindersConfirm, setShowSendRemindersConfirm] = useState(false);
  const [selectedContractForReminder, setSelectedContractForReminder] =
    useState<Contract | null>(null);
  const [housekeepingModalVisible, setHousekeepingModalVisible] = useState(false);
  // Shared contract-list drilldown modal (used by both chips)
  const [contractListModal, setContractListModal] = useState<{
    title: string;
    subtitle: string;
    data: Contract[];
  } | null>(null);
  const [modalSearchQuery, setModalSearchQuery] = useState('');
  const [selectedListProperty, setSelectedListProperty] = useState<string>('all');
  const [selectedListType, setSelectedListType] = useState<string>('all');
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [mergeModalVisible, setMergeModalVisible] = useState(false);
  const [selectTenantVisible, setSelectTenantVisible] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [filterExpiringSoon, setFilterExpiringSoon] = useState(false);
  const [reinstateModalVisible, setReinstateModalVisible] = useState(false);
  const [reinstateDaysFilter, setReinstateDaysFilter] = useState('30');

  // Local-Lite Live Queries & Core Mutations
  const rawContracts = useContracts(selectedBusiness?.id);
  const tenants = useTenants(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const properties = useProperties(selectedBusiness?.id);
  const { batch: coreBatch, update: coreUpdate } = useCoreMutations();
  const { refreshing, onRefresh } = useStoreRefresh();

  // Map store contracts to view model
  const contracts = useMemo(() => {
    if (!rawContracts) return [];
    const today = new Date();

    return rawContracts
      .map((contract: any) => {
        const endDate = contract.end_date ? new Date(contract.end_date) : null;
        const daysUntilExpiry = endDate
          ? Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          : null;

        // Join data
        const tenant = (tenants || []).find((t: any) => t.id === contract.tenant_id);
        const house = (houses || []).find((h: any) => h.id === contract.house_id);
        const property = house
          ? (properties || []).find((p: any) => p.id === house.property_id)
          : null;

        return {
          ...contract,
          propertyName: property?.name || 'N/A',
          propertyId: property?.id,
          houseNumber: house?.house_number || 'N/A',
          houseType: house?.type,
          tenantName: tenant?.name || 'N/A',
          tenantEmail: tenant?.email || 'N/A',
          tenantStatus: tenant?.status,
          daysUntilExpiry,
          isPaused: isContractPaused(contract),
        };
      })
      .sort((a: any, b: any) => {
        const propCompare = (a.propertyName || '').localeCompare(b.propertyName || '');
        if (propCompare !== 0) return propCompare;
        return (a.houseNumber || '').localeCompare(b.houseNumber || '', undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      });
  }, [rawContracts, tenants, houses, properties]);

  const propertyOptions = useMemo(() => {
    const opts = [{ label: 'All', value: 'all' }];
    (properties || []).forEach(p => {
      opts.push({ label: p.name, value: p.id });
    });
    return opts;
  }, [properties]);

  const typeOptions = useMemo(() => {
    const opts = [{ label: 'All Types', value: 'all' }];
    const filteredHouses =
      selectedListProperty === 'all'
        ? houses || []
        : (houses || []).filter((h: any) => h.property_id === selectedListProperty);

    const uniqueTypes = new Set(filteredHouses.map((h: any) => h.type).filter(Boolean));
    Array.from(uniqueTypes).forEach(t => {
      opts.push({ label: properCase(t as string), value: t as string });
    });
    return opts;
  }, [houses, selectedListProperty]);

  const eligibleFormerTenants = useMemo(() => {
    if (!tenants || !rawContracts) return [];

    let limitDate: Date | null = null;
    if (reinstateDaysFilter !== 'all') {
      limitDate = new Date();
      limitDate.setDate(limitDate.getDate() - Number(reinstateDaysFilter));
    }

    return tenants
      .filter((t: any) => {
        if (t.status !== 'former') return false;
        if (limitDate && new Date(t.updated_at) < limitDate) return false;
        return true;
      })
      .map((t: any) => {
        const tenantContracts = rawContracts.filter((c: any) => c.tenant_id === t.id);
        tenantContracts.sort(
          (a: any, b: any) =>
            new Date(b.end_date || 0).getTime() - new Date(a.end_date || 0).getTime(),
        );
        const latestContract = tenantContracts[0];

        let houseNumber = 'N/A';
        let propertyName = 'N/A';
        let isHouseTaken = false;

        if (latestContract) {
          const house = (houses || []).find((h: any) => h.id === latestContract.house_id);
          houseNumber = house?.house_number || 'N/A';
          const property = house
            ? (properties || []).find((p: any) => p.id === house.property_id)
            : null;
          propertyName = property?.name || 'N/A';

          isHouseTaken = rawContracts.some(
            (c: any) =>
              c.house_id === latestContract.house_id &&
              c.tenant_id !== t.id &&
              isActiveContractStatus(c.status),
          );
        }

        return { ...t, latestContract, houseNumber, propertyName, isHouseTaken };
      })
      .filter((t: any) => t.latestContract)
      .sort((a: any, b: any) => {
        if (a.isHouseTaken === b.isHouseTaken) return 0;
        return a.isHouseTaken ? 1 : -1;
      });
  }, [tenants, rawContracts, houses, properties, reinstateDaysFilter]);

  const executeReinstate = async (tenantId: string, contractId: string) => {
    try {
      const newEndDate = new Date();
      newEndDate.setFullYear(newEndDate.getFullYear() + 1);
      const newEndDateStr = formatDateForDB(newEndDate);

      const mutations: BatchMutation[] = [
        {
          tableName: 'tenants',
          operation: 'UPDATE',
          payload: { status: 'active' },
          rowId: tenantId,
        },
        {
          tableName: 'contracts',
          operation: 'UPDATE',
          payload: {
            status: 'active',
            end_date: newEndDateStr,
          },
          rowId: contractId,
        },
      ];

      const contractData = rawContracts.find((c: any) => c.id === contractId);
      if (contractData && (contractData as any).house_id) {
        const houseId = (contractData as any).house_id;
        const houseData = houses.find((h: any) => h.id === houseId);
        const contractsAfterUpdate = rawContracts.map((c: any) =>
          c.id === contractId ? { ...c, status: 'active', end_date: newEndDateStr } : c,
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

      await coreBatch(mutations);
      showSnackbar('Tenant successfully reinstated for 1 year', 'success');
    } catch (_e) {
      showSnackbar('Failed to reinstate tenant', 'error');
    }
  };

  const handleSendRenewalReminders = async () => {
    if (!checkOnline('Send Reminders') || !requireCloudSync('Send Reminders')) return;
    setShowSendRemindersConfirm(true);
  };

  const executeSendRenewalReminders = async () => {
    // Dismiss confirm immediately before the async call
    setShowSendRemindersConfirm(false);
    try {
      setActionLoading(true);

      const { data, error } = await supabase.functions.invoke('contract-management', {
        headers: getAuthStateSnapshot().session
          ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
          : undefined,
        body: { action: 'scan' },
      });

      if (error) throw error;

      const message =
        data?.message ||
        `Renewal reminders processed (${data?.results?.length ?? 'see logs'})`;

      showSnackbar(message, 'success');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send reminders.';
      showSnackbar(errorMessage, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleViewContract = (contract: Contract) => {
    setMenuVisible(null);
    setLoadingContractId(contract.id);
    onDismiss();
    router.push(`/(tabs)/contracts/view/${contract.id}`);
    setTimeout(() => setLoadingContractId(null), 500);
  };

  const handlePauseContract = (contract: Contract) => {
    setMenuVisible(null);
    setSelectedContractForAction(contract);
    setActionType('pause');
    setActionDate(formatDateForDB(new Date()));
    setActionDialogVisible(true);
  };

  const handleResumeContract = (contract: Contract) => {
    setMenuVisible(null);
    setSelectedContractForAction(contract);
    setActionType('resume');
    setActionDate(formatDateForDB(new Date()));
    setActionDialogVisible(true);
  };

  const handleTerminateContract = (contract: Contract) => {
    setMenuVisible(null);
    setSelectedContractForAction(contract);
    setActionType('terminate');
    setActionDate(formatDateForDB(new Date()));
    setActionDialogVisible(true);
  };

  const executeContractAction = async () => {
    if (!actionType) return;
    if (
      actionType !== 'batch_pause' &&
      actionType !== 'batch_resume' &&
      !selectedContractForAction
    )
      return;

    if (actionType === 'terminate') {
      setTerminateConfirmVisible(true);
    } else {
      performAction();
    }
  };

  const performAction = async () => {
    if (!actionType) return;
    if (
      actionType !== 'batch_pause' &&
      actionType !== 'batch_resume' &&
      !selectedContractForAction
    )
      return;

    try {
      setActionLoading(true);
      if (actionType === 'batch_pause' || actionType === 'batch_resume') {
        const ids = Array.from(selectedListIds);

        const mutations: BatchMutation[] = [];
        if (actionType === 'batch_pause') {
          ids.forEach(contractId => {
            const c = rawContracts.find((rc: any) => rc.id === contractId);
            if (!c) return;
            mutations.push({
              tableName: 'contracts',
              operation: 'UPDATE',
              payload: {
                metadata: calculatePausedBreaks(c.metadata, actionDate),
              },
              rowId: contractId,
            });
          });
          await coreBatch(mutations);
          showSnackbar(`Successfully paused ${ids.length} contract(s)`, 'success');
        } else {
          // batch_resume
          ids.forEach(contractId => {
            const c = rawContracts.find((rc: any) => rc.id === contractId);
            if (!c) return;
            mutations.push({
              tableName: 'contracts',
              operation: 'UPDATE',
              payload: {
                metadata: calculateResumedBreaks(c.metadata, actionDate),
              },
              rowId: contractId,
            });
          });
          await coreBatch(mutations);
          showSnackbar(`Successfully resumed ${ids.length} contract(s)`, 'success');
        }

        setSelectedListIds(new Set());
      } else {
        const contract = selectedContractForAction;
        if (!contract) return;

        if (actionType === 'pause') {
          await coreUpdate('contracts', contract.id, {
            metadata: calculatePausedBreaks(contract.metadata, actionDate),
          });
          showSnackbar('Contract paused successfully', 'success');
        } else if (actionType === 'resume') {
          await coreUpdate('contracts', contract.id, {
            metadata: calculateResumedBreaks(contract.metadata, actionDate),
          });
          showSnackbar('Contract resumed successfully', 'success');
        } else if (actionType === 'terminate') {
          const selectedDateStr = actionDate;

          const mutations: BatchMutation[] = [
            {
              tableName: 'contracts',
              operation: 'UPDATE',
              payload: {
                status: 'terminated',
                end_date: selectedDateStr,
              },
              rowId: contract.id,
            },
          ];

          if ((contract as any).house_id) {
            const houseId = (contract as any).house_id;
            const houseData = houses.find((h: any) => h.id === houseId);
            const contractsAfterUpdate = rawContracts.map((c: any) =>
              c.id === contract.id ? { ...c, status: 'terminated' } : c,
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

          await coreBatch(mutations);

          let pdf_attachment_base64;
          let contract_pdf_base64;
          try {
            const tenantObj = (tenants || []).find(
              (t: any) => t.id === (contract as any).tenant_id,
            );
            const houseObj = (houses || []).find(
              (h: any) => h.id === (contract as any).house_id,
            );
            const propertyObj = houseObj
              ? (properties || []).find((p: any) => p.id === houseObj.property_id)
              : null;

            const terminationUri = await generateTerminationPDF(
              {
                tenant: tenantObj as any,
                property: propertyObj as any,
                contract: contract as any,
              },
              selectedBusiness,
              selectedDateStr,
            );

            const terminationFile = new File(terminationUri);
            pdf_attachment_base64 = terminationFile.base64Sync();

            const contractUri = await generateContractPDF(
              {
                tenant: tenantObj as any,
                property: propertyObj as any,
                contract: contract as any,
              },
              selectedBusiness,
              contract.metadata?.settings || {},
            );

            const contractFile = new File(contractUri);
            contract_pdf_base64 = contractFile.base64Sync();
          } catch (err) {
            console.error('Failed to generate PDF for attachment', err);
          }

          // Trigger edge function to send termination email
          const { error } = await supabase.functions.invoke('contract-management', {
            headers: getAuthStateSnapshot().session
              ? {
                Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}`,
              }
              : undefined,
            body: {
              action: 'terminate',
              contract_id: contract.id,
              termination_date: selectedDateStr,
              pdf_attachment_base64,
              contract_pdf_base64,
            },
          });

          if (error) throw error;
          showSnackbar('Contract terminated and tenant notified successfully', 'success');
        }
      }

      setActionDialogVisible(false);
      setSelectedContractForAction(null);
      setActionType(null);
    } catch (error) {
      console.error('Action failed', error);
      showSnackbar(`Failed to ${actionType} contract`, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendReminder = async (contract: Contract) => {
    if (!checkOnline('Send Reminder') || !requireCloudSync('Send Reminder')) return;
    setMenuVisible(null);
    setSelectedContractForReminder(contract);
  };

  const executeSendReminder = async () => {
    if (!selectedContractForReminder) return;
    const contract = selectedContractForReminder;

    // Dismiss confirm immediately before the async call
    setSelectedContractForReminder(null);
    setLoadingContractId(contract.id);
    try {
      setActionLoading(true);

      const { data, error } = await supabase.functions.invoke('contract-management', {
        headers: getAuthStateSnapshot().session
          ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
          : undefined,
        body: {
          action: 'renew',
          contract_id: contract.id,
        },
      });

      if (error) throw error;

      showSnackbar(data?.message || `Reminder sent to ${contract.tenantName}`, 'success');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send reminder.';
      showSnackbar(errorMessage, 'error');
    } finally {
      setActionLoading(false);
      setLoadingContractId(null);
    }
  };

  const handleRenewContract = (contract: Contract) => {
    setMenuVisible(null);
    if (contract.tenantStatus === 'blacklisted') {
      showSnackbar('Cannot renew contract for a blacklisted tenant', 'error');
      return;
    }
    setSelectedContractForRenewal(contract);
    setNewEndDate(
      formatDateForDB(new Date(new Date().setFullYear(new Date().getFullYear() + 1))),
    );
    setNewRentAmount(contract.rent_amount?.toString() || '');
    setRenewDialogVisible(true);
  };

  const handleConfirmRenewal = async () => {
    if (!checkOnline('Renew Contract') || !requireCloudSync('Renew Contract')) return;
    if (!selectedContractForRenewal) return;

    if (!newEndDate) {
      showSnackbar('Please enter a new end date', 'warning');
      return;
    }

    // Dismiss immediately so the UI is not blocked during the network call
    const contractSnapshot = selectedContractForRenewal;
    setRenewDialogVisible(false);
    setSelectedContractForRenewal(null);
    setLoadingContractId(contractSnapshot.id);

    try {
      setActionLoading(true);

      let renewalToken = contractSnapshot.renewal_token_expires_at
        ? await getRenewalToken(contractSnapshot.id)
        : null;

      if (!renewalToken) {
        const { data: tokenData, error: tokenError } = await supabase.rpc(
          'create_contract_renewal_token',
          {
            p_contract_id: contractSnapshot.id,
            p_expires_hours: 168,
          },
        );

        if (tokenError) throw tokenError;
        renewalToken = tokenData;
      }

      const { data, error } = await supabase.rpc('renew_contract', {
        p_token: renewalToken,
        p_new_end_date: newEndDate,
        p_new_rent_amount: newRentAmount ? parseFloat(newRentAmount) : undefined,
      });

      if (error) throw error;
      if (data && typeof data === 'object' && !(data as any).success) {
        throw new Error((data as any).message || 'Failed to renew contract.');
      }

      showSnackbar((data as any)?.message || `Contract renewed successfully.`, 'success');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to renew contract.';
      showSnackbar(errorMessage, 'error');
    } finally {
      setActionLoading(false);
      setLoadingContractId(null);
    }
  };

  const openBatchRenewalDialog = (alignAll = false) => {
    setFilterExpiringSoon(!alignAll);
    setBatchRenewDialogVisible(true);
  };

  const filteredContractsForBatch = useMemo(() => {
    const today = new Date();
    const limitDate = new Date();
    limitDate.setDate(today.getDate() + 45);
    const limitDateStr = formatDateForDB(limitDate);

    return contracts.filter(c => {
      if (c.tenantStatus === 'blacklisted') return false;
      const isValidStatus = isActiveContractStatus(c.status);
      if (!isValidStatus) return false;
      if (!filterExpiringSoon) return true;
      return c.end_date && c.end_date <= limitDateStr;
    });
  }, [contracts, filterExpiringSoon]);

  // Sync selected IDs when filter changes or modal opens
  useEffect(() => {
    if (batchRenewDialogVisible) {
      const newIds = filteredContractsForBatch.map(c => c.id);
      setSelectedBatchIds(prev => {
        if (prev.size === newIds.length && newIds.every(id => prev.has(id))) {
          return prev;
        }
        return new Set(newIds);
      });
    }
  }, [batchRenewDialogVisible, filteredContractsForBatch]);

  const toggleBatchSelection = (id: string) => {
    setSelectedBatchIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const executeBatchRenewal = async () => {
    if (selectedBatchIds.size === 0) {
      showSnackbar('Please select at least one contract', 'warning');
      return;
    }

    const ids = Array.from(selectedBatchIds);
    const NEW_END_DATE = batchNewEndDate;

    // Dismiss immediately — the batch write is local
    setBatchRenewDialogVisible(false);

    try {
      const mutations: BatchMutation[] = ids.map(contractId => ({
        tableName: 'contracts',
        operation: 'UPDATE',
        payload: {
          status: 'active',
          end_date: NEW_END_DATE,
        },
        rowId: contractId,
      }));
      await coreBatch(mutations);

      showSnackbar(
        `Successfully renewed ${ids.length} contract${ids.length !== 1 ? 's' : ''} to ${NEW_END_DATE}`,
        'success',
      );
    } catch {
      showSnackbar('Failed to batch renew contracts.', 'error');
    }
  };

  const getRenewalToken = async (contractId: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase
        .from('tokens')
        .select('token, metadata')
        .eq('type', 'contract_renewal');

      if (error || !data) return null;

      const now = new Date();
      const validRecord = data.find(row => {
        const meta = (row.metadata as Record<string, any>) || {};
        if (meta.contract_id !== contractId) return false;
        if (meta.used_at) return false;
        if (meta.expires_at && new Date(meta.expires_at) <= now) return false;
        return true;
      });

      return validRecord?.token || null;
    } catch {
      return null;
    }
  };

  const summary = useMemo((): Summary => {
    return contracts.reduce(
      (acc, contract) => {
        acc.byStatus[contract.status] = (acc.byStatus[contract.status] || 0) + 1;
        if (isActiveContractStatus(contract.status)) {
          acc.total += 1;
        }
        if (
          contract.daysUntilExpiry !== null &&
          contract.daysUntilExpiry >= 0 &&
          contract.daysUntilExpiry <= 45
        ) {
          acc.expiringSoon += 1;
        }
        return acc;
      },
      { total: 0, expiringSoon: 0, byStatus: {} } as Summary,
    );
  }, [contracts]);

  // Synchronize contract list modal with the latest contracts data
  useEffect(() => {
    setContractListModal(prev => {
      if (!prev) return prev;
      const updatedData = prev.data.map(
        c => contracts.find(newC => newC.id === c.id) || c,
      );
      return { ...prev, data: updatedData };
    });
  }, [contracts]);

  // All contracts counted by the "Expiring Soon" chip — no 10-item cap
  const allExpiringSoonContracts = useMemo(
    () =>
      contracts.filter(
        c =>
          c.daysUntilExpiry !== null && c.daysUntilExpiry >= 0 && c.daysUntilExpiry <= 45,
      ),
    [contracts],
  );

  // All active contracts — used by the Total chip drilldown
  const allActiveContracts = useMemo(
    () => contracts.filter(c => isActiveContractStatus(c.status)),
    [contracts],
  );

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Contract Management"
      subtitle="Manage property contracts"
      maxHeight="90%"
    >
      <ScrollView
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.summarySurface}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Status Overview
          </Text>
          <View style={styles.summaryRow}>
            <View style={{ flex: 1 }}>
              <Chip
                mode="outlined"
                icon="calendar"
                style={styles.summaryChip}
                textStyle={{ textAlign: 'left', flex: 1 }}
                onPress={() =>
                  setContractListModal({
                    title: 'Active Contracts',
                    subtitle: `${summary.total} contracts`,
                    data: allActiveContracts,
                  })
                }
              >
                Total: {summary.total}
              </Chip>
            </View>
            <View style={{ flex: 1 }}>
              <Chip
                mode="outlined"
                icon="clock-outline"
                style={styles.summaryChip}
                textStyle={{ textAlign: 'left', flex: 1 }}
                onPress={() =>
                  setContractListModal({
                    title: 'Expiring Soon',
                    subtitle: `${allExpiringSoonContracts.length} contracts within 45 days`,
                    data: allExpiringSoonContracts,
                  })
                }
              >
                Expiring Soon: {summary.expiringSoon}
              </Chip>
            </View>
          </View>
        </View>

        {canEdit && (
          <>
            <Divider />
            <View style={{ marginTop: 16 }}>
              <Text variant="titleMedium" style={styles.sectionTitle}>
                Renewal Automation
              </Text>
              <Text
                variant="bodySmall"
                style={{ color: colors.onSurfaceVariant, marginBottom: 12 }}
              >
                Trigger the scheduled functions manually when you need to send renewal
                reminders or clean up expired contracts.
              </Text>
              <View style={styles.buttonRow}>
                <ActionButton
                  mode="outlined"
                  icon="email-multiple-outline"
                  title="Send Renewal Reminders"
                  onPress={handleSendRenewalReminders}
                  loading={actionLoading}
                  disabled={actionLoading}
                />
                <ActionButton
                  mode="outlined"
                  icon="calendar-range"
                  title="Bulk Align Expiry Dates"
                  onPress={() => openBatchRenewalDialog(true)}
                  loading={actionLoading}
                  disabled={actionLoading}
                />
                <ActionButton
                  mode="outlined"
                  icon="call-merge"
                  title="Merge Multiple Contracts"
                  onPress={() => setSelectTenantVisible(true)}
                  loading={actionLoading}
                  disabled={actionLoading}
                  textColor={colors.primary}
                />
                <ActionButton
                  mode="outlined"
                  icon="account-convert"
                  title="Manage Former Tenants"
                  onPress={() => setReinstateModalVisible(true)}
                  loading={actionLoading}
                  disabled={actionLoading}
                  textColor={colors.primary}
                />
                <ActionButton
                  mode="outlined"
                  icon="broom"
                  title="Housekeeping - Pending Rent"
                  onPress={() => setHousekeepingModalVisible(true)}
                  loading={actionLoading}
                  disabled={actionLoading}
                  textColor={colors.primary}
                />
              </View>
            </View>
            <Divider style={{ marginVertical: 16 }} />
          </>
        )}
      </ScrollView>

      <BaseModal
        visible={renewDialogVisible}
        onDismiss={() => setRenewDialogVisible(false)}
        title="Renew Contract"
        subtitle="Manage property contracts"
        scrollable
        actions={[
          {
            label: 'Cancel',
            onPress: () => setRenewDialogVisible(false),
            mode: 'outlined',
          },
          {
            label: 'Renew',
            onPress: handleConfirmRenewal,
            mode: 'contained',
            loading: actionLoading || loadingContractId !== null,
          },
        ]}
      >
        {selectedContractForRenewal && (
          <View style={{ gap: 8 }}>
            <Text variant="bodyMedium">{selectedContractForRenewal.tenantName}</Text>
            <Text
              variant="bodySmall"
              style={{ color: colors.onSurfaceVariant, marginBottom: 12 }}
            >
              Current End: {formatDate(selectedContractForRenewal.end_date)}
            </Text>
            <DatePicker
              label="New End Date"
              value={newEndDate}
              onChange={d => d && setNewEndDate(d)}
            />
            <TextInput
              label="New Rent Amount"
              value={newRentAmount}
              onChangeText={setNewRentAmount}
              mode="outlined"
              keyboardType="numeric"
              style={{ marginTop: 12 }}
            />
          </View>
        )}
      </BaseModal>

      <BaseModal
        visible={showSendRemindersConfirm}
        onDismiss={() => setShowSendRemindersConfirm(false)}
        mode="confirm"
        title="Send Renewal Reminders"
        message="Send reminders to all tenants whose contracts are expiring soon?"
        onConfirm={executeSendRenewalReminders}
        loading={actionLoading}
      />

      <BaseModal
        visible={!!selectedContractForReminder}
        onDismiss={() => setSelectedContractForReminder(null)}
        mode="confirm"
        title="Send Reminder"
        message={`Send renewal reminder to ${selectedContractForReminder?.tenantName}?`}
        onConfirm={executeSendReminder}
        loading={actionLoading}
      />
      <BatchRenewModal
        visible={batchRenewDialogVisible}
        onDismiss={() => {
          setBatchRenewDialogVisible(false);
          setSelectedBatchIds(new Set());
        }}
        batchNewEndDate={batchNewEndDate}
        setBatchNewEndDate={setBatchNewEndDate}
        filterExpiringSoon={filterExpiringSoon}
        setFilterExpiringSoon={setFilterExpiringSoon}
        filteredContractsForBatch={filteredContractsForBatch}
        selectedBatchIds={selectedBatchIds}
        setSelectedBatchIds={setSelectedBatchIds}
        onExecuteBatchRenewal={executeBatchRenewal}
        actionLoading={actionLoading}
        colors={colors}
      />

      <ContractDrilldownModal
        contractListModal={contractListModal}
        onDismiss={() => setContractListModal(null)}
        modalSearchQuery={modalSearchQuery}
        setModalSearchQuery={setModalSearchQuery}
        selectedListProperty={selectedListProperty}
        setSelectedListProperty={setSelectedListProperty}
        selectedListType={selectedListType}
        setSelectedListType={setSelectedListType}
        propertyOptions={propertyOptions}
        typeOptions={typeOptions}
        selectedListIds={selectedListIds}
        setSelectedListIds={setSelectedListIds}
        menuVisible={menuVisible}
        setMenuVisible={setMenuVisible}
        onOpenActionDialog={(type, date) => {
          setActionType(type);
          setActionDate(date);
          setActionDialogVisible(true);
        }}
        onViewContract={handleViewContract}
        onRenewContract={handleRenewContract}
        onPauseContract={handlePauseContract}
        onResumeContract={handleResumeContract}
        onSendReminder={handleSendReminder}
        onTerminateContract={handleTerminateContract}
        colors={colors}
      />

      <PendingRentHousekeepingModal
        visible={housekeepingModalVisible}
        onDismiss={() => setHousekeepingModalVisible(false)}
      />

      {selectTenantVisible && (
        <SelectTenantModal
          visible={selectTenantVisible}
          onDismiss={() => setSelectTenantVisible(false)}
          tenants={tenants.filter(
            t => rawContracts.filter(c => c.tenant_id === t.id).length > 1,
          )}
          contracts={rawContracts}
          houses={houses}
          properties={properties}
          onSelect={selection => {
            const tenant = Array.isArray(selection) ? selection[0] : selection;
            if (!tenant) return;
            setSelectTenantVisible(false);
            setSelectedTenantId(tenant.id);
            setMergeModalVisible(true);
          }}
        />
      )}

      {selectedTenantId && (
        <MergeContractsModal
          visible={mergeModalVisible}
          onDismiss={() => {
            setMergeModalVisible(false);
            setSelectedTenantId(null);
          }}
          tenantId={selectedTenantId}
        />
      )}

      <ContractActionModal
        visible={actionDialogVisible}
        onDismiss={() => {
          setActionDialogVisible(false);
          setSelectedContractForAction(null);
          setActionType(null);
        }}
        actionType={actionType}
        subtitle={
          selectedContractForAction?.tenantName ||
          (selectedListIds.size > 0
            ? `${selectedListIds.size} Contracts Selected`
            : undefined)
        }
        actionDate={actionDate}
        onActionDateChange={setActionDate}
        onConfirm={executeContractAction}
        loading={actionLoading}
      />

      <BaseModal
        visible={terminateConfirmVisible}
        onDismiss={() => setTerminateConfirmVisible(false)}
        title="Confirm Termination"
        message="Are you sure you want to terminate this contract? This will immediately terminate the contract and notify the tenant."
        mode="confirm"
        icon="alert"
        destructive={true}
        confirmText="Terminate"
        cancelText="Cancel"
        onConfirm={() => {
          setTerminateConfirmVisible(false);
          performAction();
        }}
        onCancel={() => setTerminateConfirmVisible(false)}
      />

      <ReinstateTenantsModal
        visible={reinstateModalVisible}
        onDismiss={() => setReinstateModalVisible(false)}
        reinstateDaysFilter={reinstateDaysFilter}
        setReinstateDaysFilter={setReinstateDaysFilter}
        eligibleFormerTenants={eligibleFormerTenants}
        onExecuteReinstate={executeReinstate}
        colors={colors}
      />
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sectionTitle: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  buttonRow: {
    flexDirection: 'column',
    gap: 2,
  },
  button: {
    marginVertical: 4,
    width: '100%',
  },
  summarySurface: {
    paddingBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  summaryChip: {
    width: '100%',
    paddingVertical: 2,
  },
  contractCard: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    paddingHorizontal: 4,
  },
  contractHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  tenantInfo: {
    flex: 1,
  },
  tenantName: {
    fontWeight: 'bold',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuButton: {
    margin: -8,
  },
  reminderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  daysLeftText: {
    fontWeight: 'bold',
  },
});
