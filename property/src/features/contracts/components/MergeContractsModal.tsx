import type { BatchMutation } from 'local-lite';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Checkbox, Divider, List, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import {
  useContracts,
  useCoreMutations,
  useReceiptsByContractId,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { HolidayBreak } from '@/shared/types/types';
import { formatDate, formatDateForDB } from '@/shared/utils/formatters';
import { generateUUID, parseMetadata } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';

interface MergeContractsModalProps {
  visible: boolean;
  onDismiss: () => void;
  tenantId: string;
  onSuccess?: () => void;
}

export default function MergeContractsModal({
  visible,
  onDismiss,
  tenantId,
  onSuccess,
}: MergeContractsModalProps) {
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const { showSnackbar } = useSnackbar();
  const allContracts = useContracts(selectedBusiness?.id);
  const tenants = useTenants(selectedBusiness?.id);
  const receiptsByContractId = useReceiptsByContractId(selectedBusiness?.id);
  const { batch } = useCoreMutations();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);

  const tenant = useMemo(() => tenants.find(t => t.id === tenantId), [tenants, tenantId]);

  const tenantContracts = useMemo(() => {
    return allContracts
      .filter(c => c.tenant_id === tenantId)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [allContracts, tenantId]);

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleMerge = async () => {
    if (selectedIds.size < 2) {
      showSnackbar('Please select at least 2 contracts to merge', 'info');
      return;
    }

    setMerging(true);
    try {
      const selectedContracts = tenantContracts.filter(c => selectedIds.has(c.id));

      // 1. Identify Range
      const sorted = [...selectedContracts].sort((a, b) =>
        a.start_date.localeCompare(b.start_date),
      );
      const firstContract = sorted[0];
      const lastContract = sorted[sorted.length - 1];
      const overallStart = firstContract.start_date;
      const overallEnd = lastContract.end_date;

      // 2. Consolidate breaks
      let mergedBreaks: HolidayBreak[] = [];
      sorted.forEach(c => {
        const metadata = parseMetadata(c.metadata);
        const breaks = metadata.breaks || [];
        mergedBreaks = [...mergedBreaks, ...breaks];
      });

      // 3. Find gaps and add breaks
      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];

        const currentEndStr = current.end_date;
        if (!currentEndStr) continue;

        const currentEnd = new Date(currentEndStr);
        const nextStart = new Date(next.start_date);

        // If gap is > 1 day
        const diffDays =
          (nextStart.getTime() - currentEnd.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 1.1) {
          const gapStart = new Date(currentEnd);
          gapStart.setDate(gapStart.getDate() + 1);

          const gapEnd = new Date(nextStart);
          gapEnd.setDate(gapEnd.getDate() - 1);

          if (gapStart <= gapEnd) {
            const gapBreak: HolidayBreak = {
              id: generateUUID(),
              start_date: formatDateForDB(gapStart),
              end_date: formatDateForDB(gapEnd),
              reason: 'Merged Contracts',
              is_partial: false,
              created_at: new Date().toISOString(),
            };
            mergedBreaks.push(gapBreak);
          }
        }
      }

      // 4. Build atomic batch mutation
      const targetContract =
        sorted.find(c => isActiveContractStatus(c.status)) || lastContract;
      const sourceContracts = sorted.filter(c => c.id !== targetContract.id);

      const mutations: BatchMutation[] = [];

      // Update target contract (the one we keep)
      const targetMetadata = parseMetadata(targetContract.metadata);
      mutations.push({
        tableName: 'contracts',
        operation: 'UPDATE',
        rowId: targetContract.id,
        payload: {
          start_date: overallStart,
          end_date: overallEnd,
          metadata: {
            ...targetMetadata,
            breaks: mergedBreaks,
          },
        },
      });

      // Move receipts to target contract
      sourceContracts.forEach(sc => {
        const sourceReceipts = receiptsByContractId?.get(sc.id as string) || [];
        sourceReceipts.forEach(r => {
          mutations.push({
            tableName: 'receipts',
            operation: 'UPDATE',
            rowId: r.id,
            payload: {
              contract_id: targetContract.id,
            },
          });
        });
      });

      // Delete source contracts
      sourceContracts.forEach(sc => {
        mutations.push({
          tableName: 'contracts',
          operation: 'DELETE',
          rowId: sc.id,
        });
      });

      await batch(mutations);

      showSnackbar(`Merged ${selectedIds.size} contracts successfully`, 'success');
      onSuccess?.();
      onDismiss();
    } catch (error: any) {
      console.error('Merge error:', error);
      showSnackbar(`Failed to merge contracts: ${error.message}`, 'error');
    } finally {
      setMerging(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Merge Lease History"
      mode="confirm"
      confirmText={merging ? 'Merging...' : 'Merge Selected'}
      onConfirm={handleMerge}
      loading={merging}
    >
      <View style={styles.container}>
        <Text variant="bodyMedium" style={styles.description}>
          Select multiple contracts to combine them into a single timeline. Gaps between
          contracts will be filled with holiday breaks.
        </Text>

        <Text variant="titleSmall" style={styles.tenantName}>
          Tenant: {tenant?.name}
        </Text>

        <KeyboardScroll style={styles.list} useSafeArea={false}>
          {tenantContracts.length === 0 ? (
            <EmptyState icon="file-document-outline" title="No contracts available" />
          ) : (
            tenantContracts.map(contract => (
              <React.Fragment key={contract.id}>
                <List.Item
                  title={`${formatDate(contract.start_date)} - ${formatDate(contract.end_date)}`}
                  description={`Status: ${(contract.status || '').toUpperCase()} • Rent: ${contract.rent_amount}`}
                  left={_props => (
                    <Checkbox.Android
                      status={selectedIds.has(contract.id) ? 'checked' : 'unchecked'}
                      onPress={() => toggleSelection(contract.id)}
                    />
                  )}
                  onPress={() => toggleSelection(contract.id)}
                />
                <Divider />
              </React.Fragment>
            ))
          )}
        </KeyboardScroll>

        <View
          style={[
            styles.warningBox,
            {
              backgroundColor: colors.warningContainer,
              borderColor: colors.warningContainerBorder,
            },
          ]}
        >
          <Text
            variant="labelSmall"
            style={[styles.warningText, { color: colors.onWarningContainer }]}
          >
            Warning: All payments from selected contracts will be reassigned to the merged
            contract. Deleted contracts cannot be easily restored.
          </Text>
        </View>
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 4,
  },
  description: {
    marginBottom: 16,
    opacity: 0.7,
  },
  tenantName: {
    marginBottom: 12,
    fontWeight: 'bold',
  },
  list: {
    maxHeight: 300,
  },
  warningBox: {
    marginTop: 16,
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  warningText: {
    lineHeight: 16,
  },
});
