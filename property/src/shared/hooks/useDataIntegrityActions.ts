import type { BatchMutation } from 'local-lite';
import { useState } from 'react';
import { useLocalClient } from '@/providers/SyncClientProvider';
import { formatDateForDB, formatDisplayDate } from '@/shared/utils/formatters';
import {
  formatAmountsInText,
  maskPhoneNumber,
  safeParseJSON,
} from '@/shared/utils/helper';
import {
  isActiveContractStatus,
  resolveHouseStatusFromContracts,
} from '@/shared/utils/statusHelper';

interface UseDataIntegrityActionsProps {
  allContracts: any[];
  allProperties: any[];
  allHouses?: any[];
  allReceipts?: any[];
  allBookings?: any[];
  allPaymentMessages: any[];
  allPaymentMessageReceipts: any[];
  contractsById: { get: (id: string) => any | undefined };
  contractsByTenant: { get: (id: string) => any[] | undefined };
  showSnackbar: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  runFullScan: () => Promise<any>;
  setCurrentModal: (modalId: string | null) => void;
}

export function useDataIntegrityActions({
  allContracts,
  allProperties,
  allHouses = [],
  allReceipts = [],
  allBookings: _allBookings = [],
  allPaymentMessages,
  allPaymentMessageReceipts,
  contractsById,
  contractsByTenant,
  showSnackbar,
  runFullScan,
  setCurrentModal,
}: UseDataIntegrityActionsProps) {
  const client = useLocalClient();
  const [processing, setProcessing] = useState(false);

  /**
   * Shared wrapper that handles the try/catch/setProcessing boilerplate
   * shared by every integrity-action handler.
   */
  const withProcessing = async (
    guard: boolean,
    fn: () => void | Promise<void>,
    successMsg: string,
    errorPrefix: string,
    returnModal?: string | null,
  ) => {
    if (!guard) return;
    try {
      setProcessing(true);
      await fn();
      if (successMsg) showSnackbar(successMsg, 'success');
      const results = await runFullScan();
      if (returnModal != null) {
        const remaining =
          results?.find((r: any) => r.id === returnModal)?.items?.length || 0;
        if (remaining > 0) {
          setCurrentModal(returnModal);
        } else {
          setCurrentModal(null);
        }
      }
    } catch (e: any) {
      showSnackbar(`${errorPrefix}: ${e.message}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  // 1. Data Cleanup (mask phone numbers, remove duplicate messages)
  const handleDataCleanup = () =>
    withProcessing(
      !!client,
      async () => {
        let msgDeleted = 0;
        let msgMasked = 0;
        let receiptMasked = 0;
        const mutations: BatchMutation[] = [];

        const msgs = [...allPaymentMessages];
        const seenMessageIds = new Set<string>();

        msgs.sort((a: any, b: any) => {
          const tA = new Date(a.created_at || 0).getTime();
          const tB = new Date(b.created_at || 0).getTime();
          return tB - tA;
        });

        msgs.forEach((msg: any) => {
          if (msg.deleted) return;
          let isDuplicate = false;
          if (msg.message_id) {
            if (seenMessageIds.has(msg.message_id)) {
              mutations.push({
                tableName: 'payment_messages',
                operation: 'DELETE',
                rowId: msg.id,
              });
              msgDeleted++;
              isDuplicate = true;
            } else {
              seenMessageIds.add(msg.message_id);
            }
          }
          if (!isDuplicate && msg.message_content) {
            const updated = maskPhoneNumber(msg.message_content);
            if (updated !== msg.message_content) {
              mutations.push({
                tableName: 'payment_messages',
                operation: 'UPDATE',
                rowId: msg.id,
                payload: { message_content: updated },
              });
              msgMasked++;
            }
          }
        });

        allReceipts.forEach((r: any) => {
          if (!r.deleted && r.notes) {
            const updated = maskPhoneNumber(r.notes);
            if (updated !== r.notes) {
              mutations.push({
                tableName: 'receipts',
                operation: 'UPDATE',
                rowId: r.id,
                payload: { notes: updated },
              });
              receiptMasked++;
            }
          }
        });

        if (mutations.length > 0 && client) {
          await client.batch(mutations);
        }

        showSnackbar(
          `Cleanup complete! Deleted ${msgDeleted} duplicates. Masked ${msgMasked} messages and ${receiptMasked} receipts.`,
          'success',
        );
      },
      '',
      'Cleanup failed',
    );

  // 2. Renew Contract
  const handleRenewContract = (tenant: any, newEndDate: Date) =>
    withProcessing(
      !!tenant?.latest_contract?.id,
      async () => {
        const contractId = tenant.latest_contract.id;
        const payload = {
          status: 'active',
          end_date: formatDateForDB(newEndDate),
        };
        if (client) {
          await client.update('contracts', contractId, payload);
        }
      },
      'Contract extended.',
      'Failed to renew',
    );

  // 3. Make Tenant Former
  const handleMakeFormer = (tenant: any, dateVacated: Date) =>
    withProcessing(
      !!tenant?.id,
      async () => {
        const mutations: BatchMutation[] = [];
        const endDate = formatDateForDB(dateVacated);

        // 1. Tenant status -> former
        mutations.push({
          tableName: 'tenants',
          operation: 'UPDATE',
          rowId: tenant.id,
          payload: { status: 'former' },
        });

        // 2. Active contracts -> terminated
        const activeContracts = (contractsByTenant.get(tenant.id) || []).filter(
          (c: any) => isActiveContractStatus(c.status),
        );

        const terminatedIds = new Set(activeContracts.map((c: any) => c.id));
        const contractsAfterUpdate = allContracts.map(c =>
          terminatedIds.has(c.id) ? { ...c, status: 'terminated', end_date: endDate } : c,
        );

        activeContracts.forEach((contract: any) => {
          mutations.push({
            tableName: 'contracts',
            operation: 'UPDATE',
            rowId: contract.id,
            payload: {
              status: 'terminated',
              end_date: endDate,
            },
          });
        });

        // 3. Update houses status
        const houseIds = [
          ...new Set(activeContracts.map((c: any) => c.house_id).filter(Boolean)),
        ] as string[];

        houseIds.forEach(houseId => {
          const houseData = allHouses.find((h: any) => h.id === houseId);
          const newStatus = resolveHouseStatusFromContracts(
            houseData?.status,
            contractsAfterUpdate,
            houseId,
          );
          mutations.push({
            tableName: 'houses',
            operation: 'UPDATE',
            rowId: houseId,
            payload: { status: newStatus },
          });
        });

        // 4. Also check tenant.latest_contract if not in activeContracts
        if (
          tenant.latest_contract &&
          !activeContracts.some((c: any) => c.id === tenant.latest_contract.id)
        ) {
          const latestContractId = tenant.latest_contract.id;
          mutations.push({
            tableName: 'contracts',
            operation: 'UPDATE',
            rowId: latestContractId,
            payload: {
              status: 'terminated',
              end_date: endDate,
            },
          });

          if (tenant.latest_contract.house_id) {
            const houseId = tenant.latest_contract.house_id;
            const houseData = allHouses.find((h: any) => h.id === houseId);
            const contractsAfterUpdate2 = allContracts.map(c =>
              c.id === latestContractId
                ? { ...c, status: 'terminated', end_date: endDate }
                : c,
            );
            const newStatus = resolveHouseStatusFromContracts(
              houseData?.status,
              contractsAfterUpdate2,
              houseId,
            );
            mutations.push({
              tableName: 'houses',
              operation: 'UPDATE',
              rowId: houseId,
              payload: { status: newStatus },
            });
          }
        }

        if (mutations.length > 0 && client) {
          await client.batch(mutations);
        }
      },
      'Tenant marked as former and contracts terminated.',
      'Failed to update tenant status',
    );

  // 4. Resolve House Status
  const handleResolveHouseStatus = (house: any) =>
    withProcessing(
      !!house?.id,
      async () => {
        const correctStatus = resolveHouseStatusFromContracts(
          house.status,
          allContracts,
          house.id,
        );
        if (house.status !== correctStatus) {
          if (client) {
            await client.update('houses', house.id, { status: correctStatus });
          }
          showSnackbar(
            `House status updated to ${correctStatus.replace(/_/g, ' ')}`,
            'success',
          );
        } else {
          showSnackbar('House status already matches active contracts.', 'info');
        }
      },
      '',
      'Failed to resolve status',
      'houseStatusMismatches',
    );

  // 5. Update Commissioning Date
  const handleUpdateCommissioningDate = (
    house: any,
    target: 'house' | 'property',
    newDate: Date,
  ) =>
    withProcessing(
      !!house,
      async () => {
        const dateStr = formatDateForDB(newDate);
        const mutations: BatchMutation[] = [];

        if (target === 'property' && house.property_id) {
          const property = allProperties.find((p: any) => p.id === house.property_id);
          const oldPropMeta = safeParseJSON<Record<string, any>>(property?.metadata, {});
          const newPropMeta = { ...oldPropMeta, effective_date: dateStr };

          mutations.push({
            tableName: 'properties',
            operation: 'UPDATE',
            rowId: house.property_id,
            payload: { metadata: newPropMeta },
          });

          const currentHouse = house;
          const currentHouseMeta = safeParseJSON<Record<string, any>>(
            currentHouse?.metadata,
            {},
          );
          if (currentHouseMeta.effective_date) {
            const oldHouseMeta = { ...currentHouseMeta };
            delete oldHouseMeta.effective_date;
            mutations.push({
              tableName: 'houses',
              operation: 'UPDATE',
              rowId: house.id,
              payload: { metadata: oldHouseMeta },
            });
          }

          if (mutations.length > 0 && client) {
            await client.batch(mutations);
          }

          showSnackbar(
            `Commissioning date updated to ${formatDisplayDate(dateStr)} for Property "${property?.name || 'Property'}".`,
            'success',
          );
        } else {
          const currentHouse = house;
          const oldMeta = safeParseJSON<Record<string, any>>(currentHouse?.metadata, {});
          const newMeta = { ...oldMeta, effective_date: dateStr };

          if (client) {
            await client.update('houses', house.id, { metadata: newMeta });
          }
          showSnackbar(
            `Commissioning date updated to ${formatDisplayDate(dateStr)} for House ${house.house_number}.`,
            'success',
          );
        }
      },
      '',
      'Failed to update commissioning date',
      'occupiedBeforeBuilt',
    );

  // 6. Update Contract Start Date
  const handleUpdateContractStartDate = (contract: any, newDate: Date) =>
    withProcessing(
      !!contract?.id,
      async () => {
        const dateStr = formatDateForDB(newDate);
        if (client) {
          await client.update('contracts', contract.id, { start_date: dateStr });
        }
        showSnackbar(
          `Contract start date updated to ${formatDisplayDate(dateStr)}.`,
          'success',
        );
      },
      '',
      'Failed to update contract start date',
      'occupiedBeforeBuilt',
    );

  const handleUpdateAllEarlyContractsStartDate = (contracts: any[], newDate: Date) =>
    withProcessing(
      contracts?.length > 0,
      async () => {
        const dateStr = formatDateForDB(newDate);
        const mutations: BatchMutation[] = contracts.map((c: any) => ({
          tableName: 'contracts',
          operation: 'UPDATE',
          rowId: c.id,
          payload: { start_date: dateStr },
        }));

        if (mutations.length > 0 && client) {
          await client.batch(mutations);
        }

        showSnackbar(
          `Updated start date to ${formatDisplayDate(dateStr)} for ${contracts.length} contract(s).`,
          'success',
        );
      },
      '',
      'Failed to update contracts',
      'occupiedBeforeBuilt',
    );

  // 6d. Accept Occupied Before Built As Is (Single)
  const handleAcceptOccupiedBeforeBuiltAsIs = (item: any) =>
    withProcessing(
      !!(item?.house?.id || item?.id),
      async () => {
        const houseId = item?.house?.id || item?.id;
        const existing = item?.house || item;
        const currentMeta = safeParseJSON<Record<string, any>>(existing?.metadata, {});
        const updatedMeta = { ...currentMeta, ignore_occupied_before_built: true };

        if (client) {
          await client.update('houses', houseId, { metadata: updatedMeta });
        }
      },
      'House occupancy accepted as is.',
      'Failed to accept house occupancy',
      'occupiedBeforeBuilt',
    );

  // 6e. Accept All Occupied Before Built As Is (Bulk)
  const handleAcceptAllOccupiedBeforeBuilt = (items: any[]) =>
    withProcessing(
      items?.length > 0,
      async () => {
        const mutations: BatchMutation[] = [];

        items.forEach((item: any) => {
          const houseId = item?.house?.id || item?.id;
          if (!houseId) return;
          const existing = item?.house || item;
          const currentMeta = safeParseJSON<Record<string, any>>(existing?.metadata, {});
          const updatedMeta = { ...currentMeta, ignore_occupied_before_built: true };
          mutations.push({
            tableName: 'houses',
            operation: 'UPDATE',
            rowId: houseId,
            payload: { metadata: updatedMeta },
          });
        });

        if (mutations.length > 0 && client) {
          await client.batch(mutations);
        }

        showSnackbar(`Accepted ${items.length} house(s) as is.`, 'success');
      },
      '',
      'Failed to accept houses',
      'occupiedBeforeBuilt',
    );

  // 7. Fix Former Future Dates
  const handleFixFormerFutureDates = (items: any[]) =>
    withProcessing(
      items?.length > 0,
      async () => {
        const todayStr = formatDateForDB(new Date());
        const mutations: BatchMutation[] = items.map((item: any) => ({
          tableName: 'contracts',
          operation: 'UPDATE',
          rowId: item.id,
          payload: { end_date: todayStr },
        }));

        if (mutations.length > 0 && client) {
          await client.batch(mutations);
        }

        showSnackbar(`Successfully updated ${items.length} contract(s).`, 'success');
      },
      '',
      'Failed to fix contracts',
      'formerFutureContracts',
    );

  // 8. Fix Receipt Dates (Re-link bulk)
  const handleFixReceiptDates = (items: any[]) =>
    withProcessing(
      items?.length > 0,
      async () => {
        let count = 0;
        const mutations: BatchMutation[] = [];

        items.forEach((item: any) => {
          if (item.better_contract_id) {
            mutations.push({
              tableName: 'receipts',
              operation: 'UPDATE',
              rowId: item.id,
              payload: { contract_id: item.better_contract_id },
            });
            count++;
          }
        });

        if (mutations.length > 0 && client) {
          await client.batch(mutations);
        }

        showSnackbar(`Successfully re-linked ${count} receipt(s).`, 'success');
      },
      '',
      'Failed to fix receipts',
      'receiptDateMismatches',
    );

  // 9. Re-link Single Receipt
  const handleRelinkSingleReceipt = (item: any) =>
    withProcessing(
      !!item?.better_contract_id,
      async () => {
        if (client) {
          await client.update('receipts', item.id, {
            contract_id: item.better_contract_id,
          });
        }
      },
      'Successfully re-linked receipt to matching contract.',
      'Failed to re-link receipt',
      'receiptDateMismatches',
    );

  // 10. Accept Receipt As Is (Single)
  const handleAcceptReceiptAsIs = (item: any) =>
    withProcessing(
      !!item?.id,
      async () => {
        const existing = item;
        const currentMeta = safeParseJSON<Record<string, any>>(existing?.metadata, {});
        const updatedMeta = { ...currentMeta, ignore_date_mismatch: true };

        if (client) {
          await client.update('receipts', item.id, { metadata: updatedMeta });
        }
      },
      'Receipt accepted as is.',
      'Failed to accept receipt',
      'receiptDateMismatches',
    );

  // 11. Accept All Receipts As Is
  const handleAcceptAllReceiptDates = (items: any[]) =>
    withProcessing(
      items?.length > 0,
      async () => {
        const mutations: BatchMutation[] = [];

        items.forEach((item: any) => {
          const existing = item;
          const currentMeta = safeParseJSON<Record<string, any>>(existing?.metadata, {});
          const updatedMeta = { ...currentMeta, ignore_date_mismatch: true };
          mutations.push({
            tableName: 'receipts',
            operation: 'UPDATE',
            rowId: item.id,
            payload: { metadata: updatedMeta },
          });
        });

        if (mutations.length > 0 && client) {
          await client.batch(mutations);
        }

        showSnackbar(`Accepted ${items.length} receipt(s) as is.`, 'success');
      },
      '',
      'Failed to accept receipts',
      'receiptDateMismatches',
    );

  // 12. Update Receipt Payment Date
  const handleUpdateReceiptPaymentDate = (receipt: any, newDate: Date) =>
    withProcessing(
      !!receipt?.id,
      async () => {
        const dateStr = formatDateForDB(newDate);
        if (client) {
          await client.update('receipts', receipt.id, { payment_date: dateStr });
        }
        showSnackbar(`Receipt date updated to ${formatDisplayDate(dateStr)}.`, 'success');
      },
      '',
      'Failed to update receipt date',
      'receiptDateMismatches',
    );

  // 13. Adjust Contracts to Cover Receipts
  const handleAdjustContractsToCoverReceipts = (items: any[]) =>
    withProcessing(
      items?.length > 0,
      async () => {
        const contractAdjustments: Record<string, { start?: string; end?: string }> = {};

        items.forEach((receipt: any) => {
          if (!receipt.contract_id) return;
          const c = contractsById.get(receipt.contract_id);
          if (!c) return;

          const pDate = formatDateForDB(receipt.payment_date);
          const adj = contractAdjustments[c.id] || {
            start: c.start_date,
            end: c.end_date,
          };

          if (pDate && adj.start && pDate < adj.start) adj.start = pDate;
          if (pDate && adj.end && pDate > adj.end) adj.end = pDate;

          contractAdjustments[c.id] = adj;
        });

        const mutations: BatchMutation[] = [];
        let count = 0;
        Object.entries(contractAdjustments).forEach(([id, adj]) => {
          mutations.push({
            tableName: 'contracts',
            operation: 'UPDATE',
            rowId: id,
            payload: { start_date: adj.start, end_date: adj.end },
          });
          count++;
        });

        if (mutations.length > 0 && client) {
          await client.batch(mutations);
        }

        showSnackbar(`Successfully adjusted ${count} contract(s).`, 'success');
      },
      '',
      'Failed to adjust contracts',
      'receiptDateMismatches',
    );

  // 14. Fix Orphaned Bookings
  const handleFixOrphanedBookings = (items: any[]) =>
    withProcessing(
      items?.length > 0,
      async () => {
        const mutations: BatchMutation[] = items.map((item: any) => ({
          tableName: 'bookings',
          operation: 'UPDATE',
          rowId: item.id,
          payload: {
            status: 'pending',
            converted_tenant_id: null,
          },
        }));

        if (mutations.length > 0 && client) {
          await client.batch(mutations);
        }

        showSnackbar(`Successfully reset ${items.length} booking(s).`, 'success');
      },
      '',
      'Failed to fix bookings',
      'orphanedBookings',
    );

  // 15. Fix Unformatted Amounts
  const handleFixUnformattedAmounts = (items: any[], type: 'message' | 'receipt') =>
    withProcessing(
      items?.length > 0,
      async () => {
        const mutations: BatchMutation[] = [];

        items.forEach((item: any) => {
          if (type === 'message' && item.message_content) {
            const formatted = formatAmountsInText(item.message_content);
            if (formatted !== item.message_content) {
              mutations.push({
                tableName: 'payment_messages',
                operation: 'UPDATE',
                rowId: item.id,
                payload: { message_content: formatted },
              });
            }
          } else if (type === 'receipt' && item.notes) {
            const formatted = formatAmountsInText(item.notes);
            if (formatted !== item.notes) {
              mutations.push({
                tableName: 'receipts',
                operation: 'UPDATE',
                rowId: item.id,
                payload: { notes: formatted },
              });
            }
          }
        });

        if (mutations.length > 0 && client) {
          await client.batch(mutations);
        }

        showSnackbar(
          `Successfully formatted amounts for ${items.length} item(s).`,
          'success',
        );
      },
      '',
      'Failed to format amounts',
      type === 'message' ? 'unformattedMsgAmounts' : 'unformattedReceiptAmounts',
    );

  const handleFixSingleItemAmount = (item: any, type: 'message' | 'receipt') =>
    withProcessing(
      !!item,
      async () => {
        if (type === 'message' && item.message_content) {
          const formatted = formatAmountsInText(item.message_content);
          if (client) {
            await client.update('payment_messages', item.id, {
              message_content: formatted,
            });
          }
        } else if (type === 'receipt' && item.notes) {
          const formatted = formatAmountsInText(item.notes);
          if (client) {
            await client.update('receipts', item.id, { notes: formatted });
          }
        }
      },
      'Amount formatted successfully.',
      'Failed to format amount',
      type === 'message' ? 'unformattedMsgAmounts' : 'unformattedReceiptAmounts',
    );

  // 16. Mask Phone Numbers
  const handleMaskPhoneNumbers = (items: any[], type: 'message' | 'receipt') =>
    withProcessing(
      items?.length > 0,
      async () => {
        const mutations: BatchMutation[] = [];

        items.forEach((item: any) => {
          if (type === 'message' && item.message_content) {
            const masked = maskPhoneNumber(item.message_content);
            if (masked !== item.message_content) {
              mutations.push({
                tableName: 'payment_messages',
                operation: 'UPDATE',
                rowId: item.id,
                payload: { message_content: masked },
              });
            }
          } else if (type === 'receipt' && item.notes) {
            const masked = maskPhoneNumber(item.notes);
            if (masked !== item.notes) {
              mutations.push({
                tableName: 'receipts',
                operation: 'UPDATE',
                rowId: item.id,
                payload: { notes: masked },
              });
            }
          }
        });

        if (mutations.length > 0 && client) {
          await client.batch(mutations);
        }

        showSnackbar(
          `Successfully masked phone numbers for ${items.length} item(s).`,
          'success',
        );
      },
      '',
      'Failed to mask phone numbers',
      type === 'message' ? 'unmaskedMsgPhones' : 'unmaskedReceiptPhones',
    );

  // 17. Uppercase References
  const handleUppercaseReferences = (items: any[]) =>
    withProcessing(
      items?.length > 0,
      async () => {
        const mutations: BatchMutation[] = [];

        items.forEach((item: any) => {
          if (!item.notes) return;
          let updated = item.notes;
          const matches = item.notes.match(/\b([a-zA-Z0-9]{10})\b/g);
          if (matches) {
            matches.forEach((m: string) => {
              if (/[a-zA-Z]/.test(m) && /[0-9]/.test(m) && m !== m.toUpperCase()) {
                updated = updated.replace(m, m.toUpperCase());
              }
            });
            if (updated !== item.notes) {
              mutations.push({
                tableName: 'receipts',
                operation: 'UPDATE',
                rowId: item.id,
                payload: { notes: updated },
              });
            }
          }
        });

        if (mutations.length > 0 && client) {
          await client.batch(mutations);
        }

        showSnackbar(
          `Successfully uppercased references for ${items.length} receipt(s).`,
          'success',
        );
      },
      '',
      'Failed to uppercase references',
      'lowercaseReceiptRefs',
    );

  // 18. Sync Receipt Notes
  const handleSyncReceiptNotes = (items: any[]) =>
    withProcessing(
      items?.length > 0,
      async () => {
        const mutations: BatchMutation[] = [];

        items.forEach((item: any) => {
          const links = allPaymentMessageReceipts.filter(
            (pmr: any) => pmr.receipt_id === item.id && !pmr.deleted,
          );
          const linkedMsgs = links
            .map((link: any) =>
              allPaymentMessages.find(
                (pm: any) => pm.id === link.payment_message_id && !pm.deleted,
              ),
            )
            .filter(Boolean);

          const newNotes = linkedMsgs
            .map((m: any) => m.message_content?.trim())
            .filter(Boolean)
            .join('\n\n');

          if (newNotes && newNotes !== item.notes) {
            mutations.push({
              tableName: 'receipts',
              operation: 'UPDATE',
              rowId: item.id,
              payload: { notes: newNotes },
            });
          }
        });

        if (mutations.length > 0 && client) {
          await client.batch(mutations);
        }

        showSnackbar(
          `Successfully synced notes for ${items.length} receipt(s).`,
          'success',
        );
      },
      '',
      'Failed to sync notes',
      'unsyncReceiptNotes',
    );

  return {
    processing,
    handleDataCleanup,
    handleRenewContract,
    handleMakeFormer,
    handleResolveHouseStatus,
    handleUpdateCommissioningDate,
    handleUpdateContractStartDate,
    handleUpdateAllEarlyContractsStartDate,
    handleAcceptOccupiedBeforeBuiltAsIs,
    handleAcceptAllOccupiedBeforeBuilt,
    handleFixFormerFutureDates,
    handleFixReceiptDates,
    handleRelinkSingleReceipt,
    handleAcceptReceiptAsIs,
    handleAcceptAllReceiptDates,
    handleUpdateReceiptPaymentDate,
    handleAdjustContractsToCoverReceipts,
    handleFixOrphanedBookings,
    handleFixUnformattedAmounts,
    handleFixSingleItemAmount,
    handleMaskPhoneNumbers,
    handleUppercaseReferences,
    handleSyncReceiptNotes,
  };
}
