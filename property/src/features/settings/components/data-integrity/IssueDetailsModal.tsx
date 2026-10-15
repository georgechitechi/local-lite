import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useState } from 'react';
import { View } from 'react-native';
import { IconButton, List, Menu, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDisplayDate } from '@/shared/utils/formatters';
import type { IntegrityIssue } from '@/shared/utils/integrityUtils';

interface IssueDetailsModalProps {
  issue: IntegrityIssue | null;
  visible: boolean;
  onDismiss: () => void;
  processing?: boolean;

  // Single Item Handlers
  onOpenRenewDialog?: (tenant: any) => void;
  onOpenFormerDialog?: (tenant: any) => void;
  onResolveHouseStatus?: (house: any) => void;
  onOpenUpdateCommissioningDialog?: (house: any) => void;
  onOpenUpdateContractStartDateDialog?: (house: any) => void;
  onAcceptReceiptAsIs?: (receipt: any) => void;
  onAcceptOccupiedBeforeBuiltAsIs?: (house: any) => void;
  onOpenChangeReceiptDateDialog?: (receipt: any) => void;
  onRelinkSingleReceipt?: (receipt: any) => void;
  onFixSingleItemAmount?: (item: any, type: 'message' | 'receipt') => void;
  onViewDetails: (item: any, issueId: string) => void;

  // Bulk Handlers
  onFixFormerFutureDates?: (items: any[]) => void;
  onFixOrphanedBookings?: (items: any[]) => void;
  onFixReceiptDates?: (items: any[]) => void;
  onAdjustContractsToCoverReceipts?: (items: any[]) => void;
  onAcceptAllReceiptDates?: (items: any[]) => void;
  onAcceptAllOccupiedBeforeBuilt?: (items: any[]) => void;
  onFixUnformattedAmounts?: (items: any[], type: 'message' | 'receipt') => void;
  onMaskPhoneNumbers?: (items: any[], type: 'message' | 'receipt') => void;
  onUppercaseReferences?: (items: any[]) => void;
  onSyncReceiptNotes?: (items: any[]) => void;
}

export default function IssueDetailsModal({
  issue,
  visible,
  onDismiss,
  processing = false,
  onOpenRenewDialog,
  onOpenFormerDialog,
  onResolveHouseStatus,
  onOpenUpdateCommissioningDialog,
  onOpenUpdateContractStartDateDialog,
  onAcceptReceiptAsIs,
  onAcceptOccupiedBeforeBuiltAsIs,
  onOpenChangeReceiptDateDialog,
  onRelinkSingleReceipt,
  onFixSingleItemAmount,
  onViewDetails,
  onFixFormerFutureDates,
  onFixOrphanedBookings,
  onFixReceiptDates,
  onAdjustContractsToCoverReceipts,
  onAcceptAllReceiptDates,
  onAcceptAllOccupiedBeforeBuilt,
  onFixUnformattedAmounts,
  onMaskPhoneNumbers,
  onUppercaseReferences,
  onSyncReceiptNotes,
}: IssueDetailsModalProps) {
  const colors = useThemeColors();
  const [menuVisible, setMenuVisible] = useState<string | null>(null);

  if (!issue) return null;

  const modalActions: any[] = [];

  if (issue.id === 'formerFutureContracts' && (issue.items?.length || 0) > 0) {
    modalActions.push({
      label: 'Set All to Today',
      onPress: () => onFixFormerFutureDates?.(issue.items),
      mode: 'contained',
      loading: processing,
      disabled: processing,
    });
  }

  if (issue.id === 'orphanedBookings' && (issue.items?.length || 0) > 0) {
    modalActions.push({
      label: 'Reset All to Pending',
      onPress: () => onFixOrphanedBookings?.(issue.items),
      mode: 'contained',
      loading: processing,
      disabled: processing,
    });
  }

  if (issue.id === 'occupiedBeforeBuilt' && (issue.items?.length || 0) > 0) {
    modalActions.push({
      label: 'Accept All as Is',
      onPress: () => onAcceptAllOccupiedBeforeBuilt?.(issue.items),
      mode: 'outlined',
      loading: processing,
      disabled: processing,
    });
  }

  if (issue.id === 'receiptDateMismatches' && (issue.items?.length || 0) > 0) {
    const fixableCount = issue.items.filter(i => i.better_contract_id).length;
    if (fixableCount > 0) {
      modalActions.push({
        label: `Re-link ${fixableCount} Receipts`,
        onPress: () => onFixReceiptDates?.(issue.items),
        mode: 'contained',
        loading: processing,
        disabled: processing,
      });
    }

    modalActions.push({
      label: 'Adjust Contracts to Match',
      onPress: () => onAdjustContractsToCoverReceipts?.(issue.items),
      mode: fixableCount > 0 ? 'outlined' : 'contained',
      loading: processing,
      disabled: processing,
    });

    modalActions.push({
      label: 'Accept All as Is',
      onPress: () => onAcceptAllReceiptDates?.(issue.items),
      mode: 'outlined',
      loading: processing,
      disabled: processing,
    });
  }

  if (issue.id === 'unformattedMsgAmounts' && (issue.items?.length || 0) > 0) {
    modalActions.push({
      label: 'Format Amounts',
      onPress: () => onFixUnformattedAmounts?.(issue.items, 'message'),
      mode: 'contained',
      loading: processing,
      disabled: processing,
    });
  }

  if (issue.id === 'unformattedReceiptAmounts' && (issue.items?.length || 0) > 0) {
    modalActions.push({
      label: 'Format Amounts',
      onPress: () => onFixUnformattedAmounts?.(issue.items, 'receipt'),
      mode: 'contained',
      loading: processing,
      disabled: processing,
    });
  }

  if (issue.id === 'unmaskedMsgPhones' && (issue.items?.length || 0) > 0) {
    modalActions.push({
      label: 'Mask Phone Numbers',
      onPress: () => onMaskPhoneNumbers?.(issue.items, 'message'),
      mode: 'contained',
      loading: processing,
      disabled: processing,
    });
  }

  if (issue.id === 'unmaskedReceiptPhones' && (issue.items?.length || 0) > 0) {
    modalActions.push({
      label: 'Mask Phone Numbers',
      onPress: () => onMaskPhoneNumbers?.(issue.items, 'receipt'),
      mode: 'contained',
      loading: processing,
      disabled: processing,
    });
  }

  if (issue.id === 'lowercaseReceiptRefs' && (issue.items?.length || 0) > 0) {
    modalActions.push({
      label: 'Uppercase References',
      onPress: () => onUppercaseReferences?.(issue.items),
      mode: 'contained',
      loading: processing,
      disabled: processing,
    });
  }

  if (issue.id === 'unsyncReceiptNotes' && (issue.items?.length || 0) > 0) {
    modalActions.push({
      label: 'Sync Notes',
      onPress: () => onSyncReceiptNotes?.(issue.items),
      mode: 'contained',
      loading: processing,
      disabled: processing,
    });
  }

  if (modalActions.length === 0) {
    modalActions.push({
      label: 'Close',
      onPress: onDismiss,
      mode: 'contained',
    });
  }

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title={issue.title}
      subtitle={issue.description}
      scrollable
      actions={modalActions}
    >
      <View style={{ paddingBottom: 20 }}>
        {(issue.items?.length || 0) === 0 ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <MaterialCommunityIcons
              name="check-decagram"
              size={60}
              color={(colors as any).success}
              style={{ opacity: 0.5 }}
            />
            <Text
              variant="bodyMedium"
              style={{ marginTop: 16, opacity: 0.6, textAlign: 'center' }}
            >
              This area of your data is healthy.
            </Text>
          </View>
        ) : (
          issue.items.map((item, idx) => {
            const id = item.id || `item-${idx}`;
            return (
              <List.Item
                key={id}
                title={item.name || item.house_number || item.id || 'Unknown Item'}
                description={props => (
                  <View {...props}>
                    {item.status && (
                      <Text variant="bodySmall">Status: {item.status}</Text>
                    )}
                    {item.amount && (
                      <Text variant="bodySmall">
                        Amount: {item.amount.toLocaleString()}
                      </Text>
                    )}
                    {item.payment_date && (
                      <Text variant="bodySmall">
                        Receipt Date: {formatDisplayDate(item.payment_date)}
                      </Text>
                    )}
                    {item.contract_start && (
                      <Text variant="bodySmall">
                        Contract: {formatDisplayDate(item.contract_start)} to{' '}
                        {formatDisplayDate(item.contract_end) || '?'}
                      </Text>
                    )}
                    {item.better_contract_label && (
                      <Text
                        variant="bodySmall"
                        style={{ color: (colors as any).success }}
                      >
                        Suggested: {item.better_contract_label}
                      </Text>
                    )}
                    {item.start_date && (
                      <Text variant="bodySmall">
                        Start: {formatDisplayDate(item.start_date)}
                      </Text>
                    )}
                    {item.end_date && (
                      <Text variant="bodySmall">
                        End: {formatDisplayDate(item.end_date)}
                      </Text>
                    )}
                    {item.event_date && (
                      <Text variant="bodySmall">
                        Event Date: {formatDisplayDate(item.event_date)}
                      </Text>
                    )}
                    {item.valid_from && (
                      <Text variant="bodySmall">
                        From: {formatDisplayDate(item.valid_from)}
                      </Text>
                    )}
                    {item.valid_until && (
                      <Text variant="bodySmall">
                        Until: {formatDisplayDate(item.valid_until)}
                      </Text>
                    )}
                    {item.issue && (
                      <Text variant="bodySmall" style={{ color: colors.error }}>
                        {item.issue}
                      </Text>
                    )}
                    {item.message_content && (
                      <Text
                        variant="bodySmall"
                        style={{ marginTop: 4, fontStyle: 'italic', opacity: 0.8 }}
                      >
                        &quot;{item.message_content}&quot;
                      </Text>
                    )}
                    {item.notes && (
                      <Text
                        variant="bodySmall"
                        style={{ marginTop: 4, fontStyle: 'italic', opacity: 0.8 }}
                      >
                        &quot;{item.notes}&quot;
                      </Text>
                    )}
                  </View>
                )}
                right={_props => (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Menu
                      visible={menuVisible === item.id}
                      onDismiss={() => setMenuVisible(null)}
                      anchor={
                        <IconButton
                          icon="dots-vertical"
                          onPress={() => setMenuVisible(item.id)}
                        />
                      }
                    >
                      {issue.id === 'tenantsWithoutContracts' && (
                        <>
                          <Menu.Item
                            onPress={() => {
                              setMenuVisible(null);
                              onOpenRenewDialog?.(item);
                            }}
                            title="Renew Contract"
                            disabled={!item.latest_contract}
                          />
                          <Menu.Item
                            onPress={() => {
                              setMenuVisible(null);
                              onOpenFormerDialog?.(item);
                            }}
                            title="Make Tenant Former"
                          />
                        </>
                      )}
                      {issue.id === 'houseStatusMismatches' && (
                        <Menu.Item
                          onPress={() => {
                            setMenuVisible(null);
                            onResolveHouseStatus?.(item);
                          }}
                          title="Auto-Resolve Status"
                          leadingIcon="auto-fix"
                          disabled={processing}
                        />
                      )}
                      {issue.id === 'occupiedBeforeBuilt' && (
                        <>
                          <Menu.Item
                            leadingIcon="check-circle-outline"
                            onPress={() => {
                              setMenuVisible(null);
                              onAcceptOccupiedBeforeBuiltAsIs?.(item);
                            }}
                            title="Accept As Is"
                            disabled={processing}
                          />
                          <Menu.Item
                            leadingIcon="calendar-edit"
                            onPress={() => {
                              setMenuVisible(null);
                              onOpenUpdateCommissioningDialog?.(item);
                            }}
                            title="Update Commissioning Date"
                            disabled={processing}
                          />
                          <Menu.Item
                            leadingIcon="file-document-edit-outline"
                            onPress={() => {
                              setMenuVisible(null);
                              onOpenUpdateContractStartDateDialog?.(item);
                            }}
                            title="Update Contract Start Date"
                            disabled={processing}
                          />
                        </>
                      )}
                      {issue.id === 'receiptDateMismatches' && (
                        <>
                          <Menu.Item
                            leadingIcon="check-circle-outline"
                            onPress={() => {
                              setMenuVisible(null);
                              onAcceptReceiptAsIs?.(item);
                            }}
                            title="Accept As Is"
                            disabled={processing}
                          />
                          <Menu.Item
                            leadingIcon="calendar-edit"
                            onPress={() => {
                              setMenuVisible(null);
                              onOpenChangeReceiptDateDialog?.(item);
                            }}
                            title="Change Receipt Date"
                          />
                          {item.better_contract_id && (
                            <Menu.Item
                              leadingIcon="link-variant"
                              onPress={() => {
                                setMenuVisible(null);
                                onRelinkSingleReceipt?.(item);
                              }}
                              title="Re-link to Matching Contract"
                            />
                          )}
                        </>
                      )}
                      {(issue.id === 'unformattedMsgAmounts' ||
                        issue.id === 'unformattedReceiptAmounts') && (
                        <Menu.Item
                          leadingIcon="format-letter-case"
                          onPress={() => {
                            setMenuVisible(null);
                            onFixSingleItemAmount?.(
                              item,
                              issue.id === 'unformattedMsgAmounts'
                                ? 'message'
                                : 'receipt',
                            );
                          }}
                          title="Format Amount"
                        />
                      )}
                      {item.id && (
                        <Menu.Item
                          leadingIcon="eye"
                          title="View Details"
                          onPress={() => {
                            setMenuVisible(null);
                            onViewDetails(item, issue.id);
                          }}
                        />
                      )}
                    </Menu>
                  </View>
                )}
                style={{
                  borderBottomWidth: 1,
                  borderBottomColor: colors.outlineVariant,
                }}
              />
            );
          })
        )}
      </View>
    </BaseModal>
  );
}
