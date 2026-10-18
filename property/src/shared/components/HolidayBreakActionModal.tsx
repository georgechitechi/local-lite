import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Checkbox, Text, TextInput } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import LoadingOverlay from '@/shared/components/LoadingOverlay';
import SlightPressable from '@/shared/components/SlightPressable';
import {
  useContracts,
  useCoreMutations,
  useReceipts,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDateForDB, parsePeriod } from '@/shared/utils/formatters';
import { generateUUID, parseMetadata } from '@/shared/utils/helper';

interface HolidayBreakActionModalProps {
  visible: boolean;
  onDismiss: () => void;
  // If editing an existing break
  editingBreak?: any | null;
  // If applying to specific contracts
  targetContractIds?: string[];
  // If bulk applying (from holidays settings)
  selectedContractsCount?: number;
  onSelectContracts?: () => void;
  // Callback after success
  onSuccess?: () => void;
  // Tenant name for display
  tenantName?: string | null;
}

export default function HolidayBreakActionModal({
  visible,
  onDismiss,
  editingBreak,
  targetContractIds,
  selectedContractsCount = 0,
  onSelectContracts,
  onSuccess,
  tenantName,
}: HolidayBreakActionModalProps) {
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const contracts = useContracts(selectedBusiness?.id);
  const receipts = useReceipts(selectedBusiness?.id);
  const { update: updateContract, updateMany } = useCoreMutations();
  const activeTenants = useTenants(selectedBusiness?.id);
  const { showSnackbar } = useSnackbar();

  const [startDate, setStartDate] = useState<string | null>(formatDateForDB(new Date()));
  const [endDate, setEndDate] = useState<string | null>(formatDateForDB(new Date()));
  const [reason, setReason] = useState('Holiday Break');
  const [isPartial, setIsPartial] = useState(false);
  const [saving, setSaving] = useState(false);

  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  const handleDismiss = () => {
    setStartDate(formatDateForDB(new Date()));
    setEndDate(formatDateForDB(new Date()));
    setReason('Holiday Break');
    setIsPartial(false);
    setInitializedKey(null);
    onDismiss();
  };

  useEffect(() => {
    if (!visible) return;

    const targetKey = editingBreak?.id ?? 'create';
    if (initializedKey === targetKey) return;

    if (editingBreak) {
      setStartDate(editingBreak.start_date);
      setEndDate(editingBreak.end_date);
      setReason(editingBreak.reason || 'Holiday Break');
      setIsPartial(!!editingBreak.is_partial);
    } else {
      setStartDate(formatDateForDB(new Date()));
      setEndDate(formatDateForDB(new Date()));
      setReason('Holiday Break');
      setIsPartial(false);
    }
    setInitializedKey(targetKey);
  }, [visible, editingBreak, initializedKey]);

  const handleApply = async () => {
    const finalContractIds = targetContractIds || [];

    if (!editingBreak && finalContractIds.length === 0 && selectedContractsCount === 0) {
      showSnackbar('Please select at least one contract.', 'error');
      return;
    }

    if (!startDate || !endDate) {
      showSnackbar('Please select both start and end dates.', 'error');
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      showSnackbar('Start date cannot be after end date.', 'error');
      return;
    }

    // Check for payments in the affected period
    const start = new Date(startDate);
    const end = new Date(endDate);
    const affectedMonths: { month: number; year: number }[] = [];
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    while (current <= end) {
      affectedMonths.push({
        month: current.getMonth() + 1,
        year: current.getFullYear(),
      });
      current.setMonth(current.getMonth() + 1);
    }

    // Only block if NOT a partial waiver
    if (!isPartial) {
      const tenantsWithPayments: string[] = [];

      // Determine which contracts to check
      if (editingBreak) {
        const contract = contracts.find(c => c.id === editingBreak.contractId);
        if (contract) {
          const hasPayment = receipts.some(r => {
            if (r.contract_id !== contract.id || r.is_refunded) return false;
            const period = parsePeriod(r.payment_period);
            if (!period?.month || !period.year) return false;
            return affectedMonths.some(
              m => m.month === period.month && m.year === period.year,
            );
          });
          if (hasPayment) tenantsWithPayments.push(editingBreak.tenantName || 'Tenant');
        }
      } else if (targetContractIds && targetContractIds.length > 0) {
        for (const contractId of targetContractIds) {
          const contract = contracts.find(c => c.id === contractId);
          if (contract) {
            const tenant = activeTenants.find(t => t.id === contract.tenant_id);
            const hasPayment = receipts.some(r => {
              if (r.contract_id !== contract.id || r.is_refunded) return false;
              const period = parsePeriod(r.payment_period);
              if (!period?.month || !period.year) return false;
              return affectedMonths.some(
                m => m.month === period.month && m.year === period.year,
              );
            });
            if (hasPayment) tenantsWithPayments.push(tenant?.name || 'Unknown');
          }
        }
      }

      if (tenantsWithPayments.length > 0) {
        showSnackbar(
          `Cannot apply full holiday break. Existing payments found for: ${tenantsWithPayments.join(', ')}. Use Partial Waiver instead.`,
          'error',
        );
        return;
      }
    }

    setSaving(true);
    try {
      if (editingBreak) {
        // Handle Edit
        const contract = contracts.find(c => c.id === editingBreak.contractId);
        if (contract) {
          const metadata = parseMetadata(contract.metadata);
          const breaks = (metadata.breaks || []).map((b: any) =>
            b.id === editingBreak.id
              ? {
                  ...b,
                  start_date: startDate,
                  end_date: endDate,
                  reason,
                  is_partial: isPartial,
                  created_at: b.created_at || new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }
              : b,
          );
          if (updateContract) {
            await updateContract('contracts', editingBreak.contractId, {
              metadata: {
                ...metadata,
                breaks,
              },
            });
          }
          showSnackbar('Holiday break updated successfully.', 'success');
        }
      } else {
        // Handle Create (Single or Bulk)
        const contractIds = finalContractIds;
        const updates: Array<{ id: string; payload: Record<string, any> }> = [];
        for (const contractId of contractIds) {
          const tenantContract = contracts.find(c => c.id === contractId);
          if (tenantContract) {
            const currentMetadata = parseMetadata(tenantContract.metadata);
            const currentBreaks = currentMetadata.breaks || [];
            const newBreak = {
              id: generateUUID(),
              start_date: startDate,
              end_date: endDate,
              reason,
              is_partial: isPartial,
              created_at: new Date().toISOString(),
            };
            updates.push({
              id: tenantContract.id,
              payload: {
                metadata: {
                  ...currentMetadata,
                  breaks: [...currentBreaks, newBreak],
                },
              },
            });
          }
        }

        if (updates.length > 0 && updateMany) {
          await updateMany('contracts', updates);
          showSnackbar(
            `Holiday break applied to ${updates.length} tenant(s).`,
            'success',
          );
        }
      }

      onSuccess?.();
      handleDismiss();
    } catch (error) {
      console.error('Error applying holiday break:', error);
      showSnackbar('Failed to apply holiday break.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={handleDismiss}
      title={editingBreak ? 'Edit Holiday Break' : 'Apply Holiday Break'}
      subtitle={
        editingBreak
          ? `Update details for ${editingBreak.tenantName}`
          : tenantName
            ? `Applying break for ${tenantName}`
            : 'Set a period during which tenants are not charged rent.'
      }
      maxHeight="80%"
      scrollable={true}
      actions={[
        { label: 'Cancel', onPress: handleDismiss, mode: 'outlined' },
        {
          label: editingBreak ? 'Update' : 'Apply',
          onPress: handleApply,
          mode: 'contained',
          loading: saving,
          disabled:
            !editingBreak &&
            targetContractIds?.length === 0 &&
            selectedContractsCount === 0,
        },
      ]}
    >
      <View style={styles.container}>
        <TextInput
          label="Reason (e.g. April Break)"
          value={reason}
          onChangeText={setReason}
          mode="outlined"
          style={styles.input}
        />
        <DatePicker
          label="Start Date"
          value={startDate}
          onChange={setStartDate}
          style={styles.input}
        />
        <DatePicker
          label="End Date"
          value={endDate}
          onChange={setEndDate}
          style={styles.input}
        />

        <SlightPressable
          onPress={() => setIsPartial(!isPartial)}
          style={styles.checkboxContainer}
        >
          <View style={styles.checkboxRow}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyLarge">Partial Waiver</Text>
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                If enabled, rent is pro-rated for the month.
              </Text>
            </View>
            <Checkbox.Android
              status={isPartial ? 'checked' : 'unchecked'}
              color={colors.primary}
            />
          </View>
        </SlightPressable>

        {!editingBreak && onSelectContracts && (
          <View style={styles.selectionSection}>
            <Text
              variant="labelLarge"
              style={{ color: colors.onSurfaceVariant, marginBottom: 4 }}
            >
              Selected Contracts
            </Text>
            <Button
              mode="outlined"
              onPress={onSelectContracts}
              icon="file-document-plus"
              contentStyle={{ justifyContent: 'flex-start', height: 45 }}
            >
              {selectedContractsCount === 0
                ? 'Tap to select contracts...'
                : `${selectedContractsCount} contract(s) selected`}
            </Button>
          </View>
        )}
      </View>
      <LoadingOverlay visible={saving} message="Applying break..." />
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
    gap: 8,
  },
  input: {
    marginBottom: 4,
  },
  checkboxContainer: {
    marginVertical: 8,
    padding: 8,
    borderRadius: 8,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectionSection: {
    marginTop: 8,
  },
});
