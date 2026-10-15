import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, IconButton, Surface, Text } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { MpesaStatementParser } from '@/features/receipts/utils/bankStatementParser';
import { MessageDuplicateChecker } from '@/features/tenants/utils/MessageDuplicateChecker';
import {
  findSuggestedTenants,
  type MatchResult,
} from '@/features/tenants/utils/tenantMatcher';
import { useAuth } from '@/providers/AuthProvider';
import { useIdleLock } from '@/providers/LockScreenProvider';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import { usePdfExtractor } from '@/shared/hooks/usePdfExtractor';
import { useCoreMutations } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type {
  BankTransaction,
  DBContract,
  DBTenant,
  PaymentMessage,
} from '@/shared/types/types';
import { formatDateForDB } from '@/shared/utils/formatters';
import { generateUUID } from '@/shared/utils/helper';
import { formatStandardMessage, smartParseDate } from '@/shared/utils/messageFormatter';
import { extractMessageMetadata } from '@/shared/utils/parsers';

interface ImportMessagesModalProps {
  visible: boolean;
  onDismiss: () => void;
  businessId: string;
  tenants: DBTenant[];
  contracts: DBContract[];
  allMessages: PaymentMessage[];
  paymentMessageReceipts: any[];
  receipts: any[];
  store?: any;
}

export default function ImportMessagesModal({
  visible,
  onDismiss,
  businessId,
  tenants,
  contracts,
  allMessages,
  paymentMessageReceipts,
  receipts,
  store,
}: ImportMessagesModalProps) {
  const { user } = useAuth();

  const colors = useThemeColors() as any;
  const { pickAndExtract } = usePdfExtractor();
  const { showSnackbar } = useSnackbar();
  const { insertMany } = useCoreMutations();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();

  const [transactions, setTransactions] = useState<
    (BankTransaction & { match?: MatchResult; isDuplicate?: boolean })[]
  >([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [showRawBlocks, setShowRawBlocks] = useState<Record<number, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [totalDetected, setTotalDetected] = useState(0);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  const handlePickFile = async () => {
    try {
      pauseAutoLock();
      const text = await pickAndExtract();
      if (text) {
        const parser = new MpesaStatementParser();
        const parsed = parser.parse(text).filter(t => t.amount >= 50);
        if (parsed.length === 0) {
          showSnackbar('No transactions detected in this PDF.', 'info');
        } else {
          // Sort transactions by date (newest first) using smart parsing
          parsed.sort((a, b) => {
            const dateA = smartParseDate(a.date) || new Date(0);
            const dateB = smartParseDate(b.date) || new Date(0);
            return dateB.getTime() - dateA.getTime();
          });

          const duplicateChecker = new MessageDuplicateChecker(allMessages);

          // Enrich with tenant matches for a better preview
          const enriched = parsed.map(trans => {
            const dateObj = smartParseDate(trans.date) || new Date();
            const yyyymmdd = formatDateForDB(dateObj);

            const content = formatStandardMessage({
              amount: trans.amount,
              name: trans.description,
              phone: trans.phone || 'UNKNOWN',
              ref: trans.mpesaCode || 'UNKNOWN',
              date: yyyymmdd,
            });

            const trimmedContent = content.trim();
            const ref = trans.mpesaCode || 'UNKNOWN';

            const isDuplicate = !!duplicateChecker.checkDuplicate(trimmedContent, ref);
            if (!isDuplicate) {
              duplicateChecker.add(trimmedContent, ref);
            }

            const suggestions = findSuggestedTenants(
              content,
              tenants,
              contracts,
              allMessages,
              paymentMessageReceipts,
              receipts,
            );

            return {
              ...trans,
              isDuplicate,
              match:
                suggestions.length > 0 && suggestions[0].confidence > 0.5
                  ? suggestions[0]
                  : undefined,
            };
          });

          const uniqueIndices = enriched
            .map((t, i) => (t.isDuplicate ? -1 : i))
            .filter(i => i !== -1);

          setTotalDetected(parsed.length);
          setTransactions(enriched);
          setSelectedIndices(new Set(uniqueIndices));
          showSnackbar(
            `Detected ${parsed.length} transactions, pending ${uniqueIndices.length}`,
            'success',
          );
        }
      }
    } finally {
      resumeAutoLock();
    }
  };

  const toggleSelection = (index: number) => {
    const next = new Set(selectedIndices);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelectedIndices(next);
  };

  const handleSelectAll = () => {
    const visibleIndices = transactions
      .map((t, i) => (filter === 'pending' && t.isDuplicate ? -1 : i))
      .filter(i => i !== -1);

    const allVisibleSelected =
      visibleIndices.length > 0 && visibleIndices.every(i => selectedIndices.has(i));

    if (allVisibleSelected) {
      const next = new Set(selectedIndices);
      for (const i of visibleIndices) next.delete(i);
      setSelectedIndices(next);
    } else {
      const next = new Set(selectedIndices);
      for (const i of visibleIndices) next.add(i);
      setSelectedIndices(next);
    }
  };

  const toggleRaw = (index: number) => {
    setShowRawBlocks(prev => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const handleImportSelected = async () => {
    const selected = transactions.filter((_, i) => selectedIndices.has(i));
    if (selected.length === 0) {
      showSnackbar('Please select at least one transaction', 'warning');
      return;
    }

    setImporting(true);
    try {
      if (!user) throw new Error('User not authenticated');

      let skippedCount = 0;
      const existingContents = new Set(
        allMessages.map(m => m.message_content.trim().toLowerCase()),
      );

      const existingIdentifiers = new Set(
        allMessages.map(m => {
          const meta = extractMessageMetadata(m.message_content);
          if (meta.ref) {
            return meta.ref.toLowerCase();
          }
          return m.message_content.trim().toLowerCase();
        }),
      );

      const newMessagesToInsert: any[] = [];

      for (const trans of selected) {
        const dateObj = smartParseDate(trans.date) || new Date();
        const yyyymmdd = formatDateForDB(dateObj);

        const messageContent = formatStandardMessage({
          amount: trans.amount,
          name: trans.description,
          phone: trans.phone || 'UNKNOWN',
          ref: trans.mpesaCode || 'UNKNOWN',
          date: yyyymmdd,
        });

        const trimmedContent = messageContent.trim();
        const ref = trans.mpesaCode || 'UNKNOWN';
        const identifier = ref.toLowerCase();

        if (
          existingContents.has(trimmedContent.toLowerCase()) ||
          (ref !== 'UNKNOWN' && existingIdentifiers.has(identifier))
        ) {
          skippedCount++;
          continue;
        }

        const newId = generateUUID();
        const newMessage = {
          id: newId,
          message_content: trimmedContent,
          transaction_date: yyyymmdd,
          business_id: businessId,
          user_id: user.id,
          metadata: {
            source: 'pdf_import',
            original_raw: trans.raw,
          },
        };

        newMessagesToInsert.push(newMessage);
        existingContents.add(trimmedContent.toLowerCase());
        if (ref !== 'UNKNOWN') {
          existingIdentifiers.add(identifier);
        }
      }

      if (newMessagesToInsert.length > 0) {
        await insertMany('payment_messages', newMessagesToInsert);
      }

      const totalCreated = selected.length - skippedCount;
      let statusMsg = `Imported ${totalCreated} messages.`;
      if (skippedCount > 0) statusMsg += ` (${skippedCount} duplicates skipped)`;

      showSnackbar(statusMsg, 'success');
      handleDismiss();
    } catch (error: any) {
      showSnackbar(`Import failed: ${error.message}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleDismiss = () => {
    setTransactions([]);
    setSelectedIndices(new Set());
    setShowRawBlocks({});
    setTotalDetected(0);
    onDismiss();
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={handleDismiss}
      title="PDF Statement Import"
      subtitle={
        totalDetected > 0
          ? `${totalDetected} detected transactions`
          : 'Extract and match payments from your M-Pesa PDF'
      }
      scrollable={true}
      actions={[
        {
          label: 'Cancel',
          onPress: handleDismiss,
          mode: 'outlined',
          disabled: importing,
        },
        {
          label: `Import ${selectedIndices.size || ''} Items`,
          onPress: handleImportSelected,
          mode: 'contained',
          loading: importing,
          disabled: importing || selectedIndices.size === 0,
        },
      ]}
    >
      <View style={styles.container}>
        {!transactions.length ? (
          <EmptyState
            icon="file"
            iconColor={colors.primary}
            title="No Statement Loaded"
            description="Upload a PDF bank statement to extract transactions automatically."
            actionLabel="Select PDF Statement"
            onAction={handlePickFile}
          />
        ) : (
          <View>
            <FilterButtons
              options={[
                { label: `All Detected (${transactions.length})`, value: 'all' },
                {
                  label: `Pending (${transactions.filter(t => !t.isDuplicate).length})`,
                  value: 'pending',
                },
              ]}
              selectedValue={filter}
              onValueChange={val => setFilter((val as 'pending' | 'all') || 'pending')}
              selectButton={{
                label:
                  selectedIndices.size > 0 &&
                  selectedIndices.size ===
                    transactions.filter(t => filter === 'all' || !t.isDuplicate).length
                    ? 'Deselect All'
                    : 'Select All',
                onPress: handleSelectAll,
              }}
              containerStyle={{
                marginBottom: 12,
                marginTop: -16,
                marginHorizontal: -16,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.outlineVariant,
              }}
            />

            {transactions.filter(t => !(filter === 'pending' && t.isDuplicate)).length ===
            0 ? (
              <EmptyState
                icon="check-all"
                iconColor={colors.primary}
                title="All Caught Up!"
                description="There are no new pending transactions to import."
              />
            ) : (
              transactions.map((item, index) => {
                if (filter === 'pending' && item.isDuplicate) return null;
                return (
                  <Card
                    key={index}
                    style={[
                      styles.previewCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.outlineVariant,
                      },
                    ]}
                    elevation={0}
                    onPress={() => toggleSelection(index)}
                  >
                    <Card.Content>
                      <View style={styles.cardHeader}>
                        <View style={styles.cardHeaderLeft}>
                          <Text variant="labelSmall" style={{ color: colors.primary }}>
                            {item.date}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text
                            variant="labelSmall"
                            style={{ fontWeight: 'bold', marginRight: 8 }}
                          >
                            KES {item.amount.toLocaleString()}
                          </Text>
                          <IconButton
                            icon={showRawBlocks[index] ? 'eye-off' : 'eye'}
                            size={16}
                            onPress={e => {
                              e.stopPropagation();
                              toggleRaw(index);
                            }}
                            style={{ margin: 0 }}
                          />
                        </View>
                      </View>

                      <Text variant="bodySmall" style={styles.messagePreview}>
                        {formatStandardMessage({
                          amount: item.amount,
                          name: item.description,
                          phone: item.phone || 'UNKNOWN',
                          ref: item.mpesaCode || 'UNKNOWN',
                          date: item.date,
                        })}
                      </Text>

                      {showRawBlocks[index] && (
                        <Surface
                          style={{
                            marginTop: 8,
                            padding: 8,
                            borderRadius: 4,
                            backgroundColor: colors.secondaryContainer,
                          }}
                          elevation={0}
                        >
                          <Text
                            variant="labelSmall"
                            style={{ color: colors.primary, marginBottom: 2 }}
                          >
                            RAW PDF ROW:
                          </Text>
                          <Text
                            variant="bodySmall"
                            style={{ fontStyle: 'italic', opacity: 0.8 }}
                          >
                            {item.raw}
                          </Text>
                        </Surface>
                      )}

                      <View style={styles.matchRow}>
                        <View
                          style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                        >
                          {item.match ? (
                            <>
                              <MaterialCommunityIcons
                                name="account-group-outline"
                                size={14}
                                color={colors.primary}
                                style={{ marginRight: 4 }}
                              />
                              <Text
                                variant="labelSmall"
                                style={{ color: colors.primary, fontWeight: 'bold' }}
                              >
                                {tenants.find(t => t.id === item.match?.tenantId)?.name ||
                                  'Matched'}
                                {item.match?.matchedValue && (
                                  <Text
                                    style={{
                                      fontWeight: 'normal',
                                      color: colors.onSurfaceVariant,
                                    }}
                                  >
                                    {` (${item.match.matchedValue})`}
                                  </Text>
                                )}
                              </Text>
                            </>
                          ) : (
                            <View style={{ height: 18 }} /> // Spacer to keep alignment
                          )}
                        </View>
                        {selectedIndices.has(index) && (
                          <MaterialCommunityIcons
                            name="check-circle"
                            size={20}
                            color={colors.primary}
                          />
                        )}
                      </View>
                    </Card.Content>
                  </Card>
                );
              })
            )}
          </View>
        )}
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  previewCard: {
    marginBottom: 8,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  messagePreview: {
    opacity: 0.8,
    lineHeight: 18,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
});
