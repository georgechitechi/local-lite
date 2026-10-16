import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import type { BatchMutation } from 'local-lite';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Checkbox, Surface, Text } from 'react-native-paper';
import { formatReceiptNumber } from '@/features/receipts/utils/receiptHelper';
import BaseModal from '@/shared/components/BaseModal';
import { useCoreMutations } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { extractDuplicateGroups } from '@/shared/utils/integrityUtils';

interface DeduplicateRecordsModalProps {
  visible: boolean;
  onDismiss: () => void;
  businessId?: string;
  allPaymentMessages: any[];
  allExpenses: any[];
  allPaymentMessageReceipts: any[];
  receiptsById: { get: (id: string) => any | undefined };
  checkOnline: (action: string) => boolean;
  showSnackbar: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  onSuccess: () => void;
}

export default function DeduplicateRecordsModal({
  visible,
  onDismiss,
  businessId,
  allPaymentMessages,
  allExpenses,
  allPaymentMessageReceipts,
  receiptsById,
  checkOnline,
  showSnackbar,
  onSuccess,
}: DeduplicateRecordsModalProps) {
  const colors = useThemeColors();
  const { batch: coreBatch } = useCoreMutations();
  const [duplicateTab, setDuplicateTab] = useState<'payment_messages' | 'expenses'>(
    'payment_messages',
  );
  const [duplicateGroups, setDuplicateGroups] = useState<any[]>([]);
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<Set<string>>(
    new Set(),
  );
  const [loadingDuplicates, setLoadingDuplicates] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Transfer States
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferDetails, setTransferDetails] = useState<
    {
      dupId: string;
      keepId: string;
      receipts: {
        linkId: string;
        receipt_id: string;
        receiptNumber: string;
        amount?: number;
        date?: string;
        method?: string;
      }[];
    }[]
  >([]);

  const checkDuplicates = useCallback(
    (table: 'payment_messages' | 'expenses') => {
      if (!businessId || loadingDuplicates) return;
      setLoadingDuplicates(true);
      setSelectedDuplicateIds(new Set());

      const duplicateList = extractDuplicateGroups(
        table,
        allPaymentMessages,
        allExpenses,
      );
      setDuplicateGroups(duplicateList);

      const initialSelected = new Set<string>();
      duplicateList.forEach(group => {
        for (let i = 1; i < group.records.length; i++)
          initialSelected.add(group.records[i].id);
      });

      setSelectedDuplicateIds(initialSelected);
      setLoadingDuplicates(false);
    },
    [businessId, loadingDuplicates, allPaymentMessages, allExpenses],
  );

  useEffect(() => {
    if (visible) {
      setDuplicateTab('payment_messages');
      checkDuplicates('payment_messages');
    }
  }, [visible, checkDuplicates]);

  const handleInitiateDeleteDuplicates = async () => {
    if (selectedDuplicateIds.size === 0) return;
    if (duplicateTab !== 'payment_messages') {
      await executeDeleteDuplicates();
      return;
    }

    const transfers: typeof transferDetails = [];
    const idsToDelete = Array.from(selectedDuplicateIds);

    idsToDelete.forEach(id => {
      const group = duplicateGroups.find(g => g.records.some((r: any) => r.id === id));
      if (!group) return;

      const keepId = group.records[0].id;
      const linkedReceipts = allPaymentMessageReceipts?.filter(
        (pmr: any) => pmr.payment_message_id === id,
      );

      if (linkedReceipts && linkedReceipts.length > 0) {
        const hydratedReceipts = linkedReceipts.map((link: any) => {
          const receipt = receiptsById.get(link.receipt_id);
          return {
            linkId: link.id,
            receipt_id: link.receipt_id,
            receiptNumber: receipt ? formatReceiptNumber(receipt.id) : 'Unknown',
            amount: receipt?.amount,
            date: receipt?.payment_date,
            method: receipt?.payment_method,
          };
        });
        transfers.push({
          dupId: id,
          keepId,
          receipts: hydratedReceipts,
        });
      }
    });

    if (transfers.length > 0) {
      setTransferDetails(transfers);
      setShowTransferModal(true);
    } else {
      await executeDeleteDuplicates();
    }
  };

  const executeDeleteDuplicates = async () => {
    if (!checkOnline('Delete Duplicates')) return;
    try {
      setProcessing(true);

      const mutations: BatchMutation[] = [];
      if (transferDetails.length > 0) {
        transferDetails.forEach(transfer => {
          transfer.receipts.forEach(r => {
            const existingLink = allPaymentMessageReceipts?.find(
              (pmr: any) =>
                pmr.payment_message_id === transfer.keepId &&
                pmr.receipt_id === r.receipt_id,
            );
            if (existingLink) {
              mutations.push({
                tableName: 'payment_message_receipts',
                operation: 'DELETE',
                rowId: r.linkId,
              });
            } else {
              mutations.push({
                tableName: 'payment_message_receipts',
                operation: 'UPDATE',
                rowId: r.linkId,
                payload: { payment_message_id: transfer.keepId },
              });
            }
          });
        });
      }

      const idsToDelete = Array.from(selectedDuplicateIds);
      if (duplicateTab === 'payment_messages') {
        for (const id of idsToDelete) {
          mutations.push({
            tableName: 'payment_messages',
            operation: 'DELETE',
            rowId: id,
          });
        }
      } else {
        for (const id of idsToDelete) {
          mutations.push({
            tableName: 'expenses',
            operation: 'DELETE',
            rowId: id,
          });
        }
      }

      if (mutations.length > 0) {
        await coreBatch(mutations);
      }

      showSnackbar(`Deleted ${idsToDelete.length} duplicates.`, 'success');
      setSelectedDuplicateIds(new Set());
      setShowTransferModal(false);
      setTransferDetails([]);
      onDismiss();
      onSuccess();
    } catch (e: any) {
      showSnackbar(`Failed: ${e.message}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <BaseModal
        visible={visible && !showTransferModal}
        onDismiss={onDismiss}
        title="Deduplicate Records"
        subtitle="Manage your properties"
        actions={[
          { label: 'Cancel', onPress: onDismiss, mode: 'outlined' },
          {
            label: `Delete (${selectedDuplicateIds.size})`,
            onPress: handleInitiateDeleteDuplicates,
            mode: 'contained',
            buttonColor: colors.error,
            disabled: selectedDuplicateIds.size === 0 || processing,
            loading: processing,
          },
        ]}
      >
        <View style={{ flexDirection: 'row', padding: 8 }}>
          <Button
            mode={duplicateTab === 'payment_messages' ? 'contained' : 'outlined'}
            onPress={() => {
              setDuplicateTab('payment_messages');
              checkDuplicates('payment_messages');
            }}
            style={{ flex: 1, marginRight: 4 }}
          >
            Messages
          </Button>
          <Button
            mode={duplicateTab === 'expenses' ? 'contained' : 'outlined'}
            onPress={() => {
              setDuplicateTab('expenses');
              checkDuplicates('expenses');
            }}
            style={{ flex: 1 }}
          >
            Expenses
          </Button>
        </View>
        <ScrollView style={{ maxHeight: 400 }}>
          {duplicateGroups.length === 0 ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <MaterialCommunityIcons
                name="check-circle-outline"
                size={48}
                color={(colors as any).success}
                style={{ opacity: 0.4 }}
              />
              <Text variant="bodySmall" style={{ marginTop: 12, opacity: 0.6 }}>
                No duplicate {duplicateTab.replace('_', ' ')} found.
              </Text>
            </View>
          ) : (
            duplicateGroups.map(group => (
              <Surface
                key={group.id}
                style={{ margin: 8, padding: 8, borderRadius: 8, elevation: 1 }}
              >
                <Text
                  variant="labelMedium"
                  numberOfLines={duplicateTab === 'payment_messages' ? undefined : 1}
                >
                  {duplicateTab === 'payment_messages' && group.records.length > 0
                    ? group.records[0].message_content
                    : group.title}
                </Text>
                {group.records.map((item: any, idx: number) => {
                  const isLinked =
                    duplicateTab === 'payment_messages' &&
                    allPaymentMessageReceipts?.some(
                      (pmr: any) => pmr.payment_message_id === item.id,
                    );
                  return (
                    <View
                      key={item.id}
                      style={{ flexDirection: 'row', alignItems: 'center' }}
                    >
                      <Checkbox.Android
                        status={
                          selectedDuplicateIds.has(item.id) ? 'checked' : 'unchecked'
                        }
                        onPress={() => {
                          const next = new Set(selectedDuplicateIds);
                          if (next.has(item.id)) {
                            next.delete(item.id);
                          } else {
                            next.add(item.id);
                          }
                          setSelectedDuplicateIds(next);
                        }}
                      />
                      <Text
                        variant="bodySmall"
                        style={{
                          flex: 1,
                          color: isLinked ? colors.primary : undefined,
                          fontWeight: isLinked ? 'bold' : 'normal',
                        }}
                      >
                        {idx === 0 ? '[Keep] ' : '[Dup] '}
                        {item.id.substring(0, 8)}
                        {isLinked ? ' (Linked to Receipt)' : ''}
                      </Text>
                    </View>
                  );
                })}
              </Surface>
            ))
          )}
        </ScrollView>
      </BaseModal>

      {/* Transfer Receipt Links Modal */}
      <BaseModal
        visible={showTransferModal}
        onDismiss={() => setShowTransferModal(false)}
        title="Transfer Receipt Links"
        subtitle="Manage payments and receipts"
        actions={[
          {
            label: 'Cancel',
            onPress: () => setShowTransferModal(false),
            mode: 'outlined',
          },
          {
            label: 'Confirm & Delete',
            onPress: executeDeleteDuplicates,
            mode: 'contained',
            buttonColor: colors.error,
            loading: processing,
          },
        ]}
      >
        <Text variant="bodyMedium" style={{ marginBottom: 16 }}>
          The messages you are deleting have linked receipts. The links will be safely
          transferred to the kept messages:
        </Text>
        <ScrollView>
          {transferDetails.map(transfer => (
            <Surface
              key={transfer.dupId}
              style={{ marginBottom: 12, padding: 12, borderRadius: 8, elevation: 1 }}
            >
              <Text variant="labelMedium" style={{ color: colors.primary }}>
                Moving {transfer.receipts.length} receipt(s)
              </Text>
              <Text variant="bodySmall" style={{ marginTop: 4 }}>
                From: {transfer.dupId.substring(0, 8)}
              </Text>
              <Text variant="bodySmall">To: {transfer.keepId.substring(0, 8)}</Text>
              <View style={{ marginTop: 8 }}>
                {transfer.receipts.map((r, i) => (
                  <View key={i} style={{ marginLeft: 8, marginBottom: 8 }}>
                    <Text variant="bodySmall" style={{ fontWeight: 'bold' }}>
                      • Receipt #{r.receiptNumber}
                    </Text>
                    <Text variant="bodySmall" style={{ opacity: 0.7, marginLeft: 12 }}>
                      Amount: {r.amount?.toLocaleString() ?? '0'} | Date:{' '}
                      {r.date ?? 'N/A'} | Method: {r.method ?? 'N/A'}
                    </Text>
                  </View>
                ))}
              </View>
            </Surface>
          ))}
        </ScrollView>
      </BaseModal>
    </>
  );
}
