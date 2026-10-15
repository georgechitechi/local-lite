import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Divider,
  IconButton,
  Menu,
  Portal,
  Surface,
  Text,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import LinkAmountModalComponent from '@/features/receipts/components/LinkAmountModal';
import LinkReceiptModal from '@/features/receipts/components/LinkReceiptModal';
import ReceiptsFromMessageModal from '@/features/receipts/components/ReceiptsFromMessageModal';
import ImportMessagesModal from '@/features/tenants/components/ImportMessagesModal';
import { findSuggestedTenants } from '@/features/tenants/utils/tenantMatcher';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import { useCurrency } from '@/shared/hooks/useCurrency';
import {
  useContracts,
  useCoreMutations,
  useHouses,
  usePaymentMessageReceipts,
  usePaymentMessages,
  useProperties,
  useReceipts,
  useReceiptsById,
  useStoreRefresh,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { PaymentMessage as StorePaymentMessage } from '@/shared/types/types';
import { formatDate } from '@/shared/utils/formatters';
import { generateUUID } from '@/shared/utils/helper';
import { extractMessageMetadata } from '@/shared/utils/parsers';
import PaymentMessageDetailsModal from './PaymentMessageDetailsModal';
import PaymentMessageModal from './PaymentMessageModal';

interface PaymentMessagesListModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect?: (message: StorePaymentMessage) => void;
  mode?: 'selection' | 'management';
  title?: string;
}

type StatusFilter = 'all' | 'linked' | 'unlinked';

export default function PaymentMessagesListModal({
  visible,
  onDismiss,
  onSelect,
  mode = 'management',
  title = 'Payment Messages',
}: PaymentMessagesListModalProps) {
  const { user } = useAuth();

  const colors = useThemeColors();
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { selectedBusiness } = useBusiness();
  const allMessages = usePaymentMessages(selectedBusiness?.id);
  const paymentMessageReceipts = usePaymentMessageReceipts(selectedBusiness?.id);
  const contracts = useContracts(selectedBusiness?.id);
  const receipts = useReceipts(selectedBusiness?.id);
  const receiptsById = useReceiptsById(selectedBusiness?.id);
  const { insert, update, delete: deleteRecord } = useCoreMutations();
  const tenants = useTenants(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const properties = useProperties(selectedBusiness?.id);
  const { refreshing, onRefresh } = useStoreRefresh();
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState<Record<string, boolean>>({});
  const [displayLimit, setDisplayLimit] = useState(10);

  // Action states
  const [selectedMessage, setSelectedMessage] = useState<StorePaymentMessage | null>(
    null,
  );
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [createReceiptModalVisible, setCreateReceiptModalVisible] = useState(false);
  const [linkReceiptModalVisible, setLinkReceiptModalVisible] = useState(false);
  const [showAmountModal, setShowAmountModal] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [linkingAmount, setLinkingAmount] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [viewDetailsVisible, setViewDetailsVisible] = useState(false);
  const [pdfModalVisible, setPdfModalVisible] = useState(false);
  const [suggestionModalVisible, setSuggestionModalVisible] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    const visibleIds = filteredMessages.map(m => m.id);
    const allVisibleSelected = visibleIds.every(id => selectedIds.has(id));

    const next = new Set(selectedIds);
    if (allVisibleSelected && visibleIds.length > 0) {
      // Deselect all visible items
      for (const id of visibleIds) next.delete(id);
    } else {
      // Select all visible items
      for (const id of visibleIds) next.add(id);
    }
    setSelectedIds(next);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0 || !selectedBusiness?.id) return;

    // Set parameters for confirmation modal
    setShowDeleteConfirm(true);
    // We'll handle the actual deletion in the onConfirm of the delete modal
  };

  // Joined data for View Details
  const handleUnlinkMessage = async (message: StorePaymentMessage): Promise<void> => {

    const messageReceiptIds = paymentMessageReceipts.filter(
      pmr => pmr.payment_message_id === message.id,
    );

    if (messageReceiptIds.length === 0) {
      showSnackbar('This message is not linked to any receipt.', 'info');
      return;
    }

    setUnlinkMessageParams(message);
    setShowUnlinkConfirm(true);
  };

  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
  const [unlinkMessageParams, setUnlinkMessageParams] =
    useState<StorePaymentMessage | null>(null);

  // Derived messages with link status
  const messages = allMessages.map(msg => {
    const linkedCount = paymentMessageReceipts.filter(
      pmr =>
        pmr.payment_message_id === msg.id && receipts.some(r => r.id === pmr.receipt_id),
    ).length;
    return { ...msg, linkedCount };
  });

  messages.sort((a, b) => {
    // Prioritize unlinked messages
    if (a.linkedCount === 0 && b.linkedCount > 0) return -1;
    if (a.linkedCount > 0 && b.linkedCount === 0) return 1;

    // Then sort by date (newest first)
    return (
      new Date(b.transaction_date || '').getTime() -
      new Date(a.transaction_date || '').getTime()
    );
  });

  let filteredMessages = messages;

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filteredMessages = filteredMessages.filter(m =>
      m.message_content.toLowerCase().includes(q),
    );
  }

  if (statusFilter === 'linked') {
    filteredMessages = filteredMessages.filter(m => m.linkedCount > 0);
  } else if (statusFilter === 'unlinked') {
    filteredMessages = filteredMessages.filter(m => m.linkedCount === 0);
  }

  const handleDelete = async (message: StorePaymentMessage) => {
    setDeleteMessageParams(message);
    setShowDeleteConfirm(true);
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteMessageParams, setDeleteMessageParams] =
    useState<StorePaymentMessage | null>(null);

  const handleLinkToExistingReceipt = async (amount: string) => {
    if (!selectedBusiness?.id || !selectedMessage || !selectedReceiptId) return;

    try {
      setSaving(true);

      if (!user?.id) {
        showSnackbar('User not authenticated', 'error');
        return;
      }

      const junctionId = generateUUID();
      await insert('payment_message_receipts', {
        id: junctionId,
        payment_message_id: selectedMessage.id,
        receipt_id: selectedReceiptId,
        business_id: selectedBusiness.id,
        user_id: user.id,
      });

      const receiptData = receiptsById.get(selectedReceiptId);
      if (receiptData) {
        const contract = contracts.find((c: any) => c.id === receiptData.contract_id);

        const extractedAmount = parseFloat(amount.replace(/,/g, '')) || 0;
        const currentAmount = Number(receiptData.amount || 0);
        const newAmount = currentAmount + extractedAmount;

        const rentAmount = Number(contract?.rent_amount || 0);
        const newStatus = newAmount >= rentAmount ? 'paid' : 'partial';

        const existingNotes = receiptData.notes || '';
        const snippet = selectedMessage.message_content;
        const noteToAppend = `${snippet}`;

        const alreadyHasSnippet =
          typeof existingNotes === 'string' && existingNotes.includes(noteToAppend);

        const updates: any = {
          amount: newAmount,
          status: newStatus,
        };

        if (!alreadyHasSnippet) {
          updates.notes = existingNotes
            ? `${existingNotes}\n\n${noteToAppend}`
            : noteToAppend;
        }

        await update('receipts', selectedReceiptId, updates);
      }

      showSnackbar('Message linked to receipt successfully.', 'success');
      setLinkReceiptModalVisible(false);
      setSelectedReceiptId(null);
      setLinkingAmount('');
      setShowAmountModal(false);
      setSelectedMessage(null);
    } catch (error) {
      console.error('Error linking message to receipt:', error);
      showSnackbar('Failed to link message to receipt', 'error');
    } finally {
      setSaving(false);
    }
  };

  const renderMessageItem = (message: any) => {
    const isLinked = message.linkedCount > 0;

    return (
      <Card
        key={message.id}
        style={[
          styles.messageCard,
          { backgroundColor: colors.surface },
          mode === 'selection' && styles.selectionCard,
        ]}
        onPress={() => {
          if (mode === 'management') {
            handleToggleSelect(message.id);
          } else {
            onSelect?.(message);
          }
        }}
        mode="outlined"
      >
        <Card.Content style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <View style={styles.dateContainer}>
              <MaterialCommunityIcons
                name="calendar"
                size={14}
                color={colors.onSurfaceVariant}
              />
              <Text
                variant="labelSmall"
                style={[styles.dateText, { color: colors.onSurfaceVariant }]}
              >
                {formatDate(message.transaction_date || '')}
              </Text>
              <Text
                variant="labelSmall"
                style={{
                  color: isLinked ? colors.success : colors.warning,
                  marginLeft: 8,
                  fontWeight: 'bold',
                }}
              >
                • {isLinked ? 'Linked' : 'Unlinked'}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {(() => {
                const suggestion = findSuggestedTenants(
                  message.message_content ?? '',
                  tenants,
                  contracts,
                  allMessages,
                  paymentMessageReceipts,
                  receipts,
                )[0];

                if (suggestion && suggestion.confidence > 0.6) {
                  const tenant = tenants.find((t: any) => t.id === suggestion.tenantId);
                  return (
                    <IconButton
                      icon="auto-fix"
                      size={16}
                      style={{ margin: 0, marginRight: 4 }}
                      iconColor={isLinked ? colors.success : colors.warning}
                      onPress={() => {
                        setActiveSuggestion({
                          tenantName: tenant?.name || 'Unknown',
                          reason: suggestion.reason,
                          source: suggestion.matchedSource,
                          value: suggestion.matchedValue,
                          message: message,
                        });
                        setSuggestionModalVisible(true);
                      }}
                    />
                  );
                }
                return (
                  <IconButton
                    icon="help-circle-outline"
                    size={16}
                    style={{ margin: 0, marginRight: 4 }}
                    iconColor={colors.onSurfaceVariant}
                    onPress={() => {
                      setActiveSuggestion({
                        reason:
                          'The system could not find a confident match for this payment.\n\nIt may have been deposited by an admin or staff.\nYou can manually link it by clicking on the receipt.',
                        message: message,
                      });
                      setSuggestionModalVisible(true);
                    }}
                  />
                );
              })()}

              {mode === 'management' && (
                <Menu
                  visible={!!menuVisible[message.id]}
                  onDismiss={() =>
                    setMenuVisible(prev => ({ ...prev, [message.id]: false }))
                  }
                  anchor={
                    <IconButton
                      icon="dots-vertical"
                      size={20}
                      onPress={() =>
                        setMenuVisible(prev => ({ ...prev, [message.id]: true }))
                      }
                      style={{ margin: -10 }}
                    />
                  }
                >
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(prev => ({ ...prev, [message.id]: false }));
                      setSelectedMessage(message);
                      setViewDetailsVisible(true);
                    }}
                    title="View Message"
                    leadingIcon="eye-outline"
                  />
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(prev => ({ ...prev, [message.id]: false }));
                      setSelectedMessage(message);
                      setEditModalVisible(true);
                    }}
                    title="Edit Message"
                    leadingIcon="pencil-outline"
                  />
                  <Divider />
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(prev => ({ ...prev, [message.id]: false }));
                      setSelectedMessage(message);
                      setCreateReceiptModalVisible(true);
                    }}
                    title="Create Receipt"
                    leadingIcon="receipt-text-plus-outline"
                  />
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(prev => ({ ...prev, [message.id]: false }));
                      setSelectedMessage(message);
                      setLinkReceiptModalVisible(true);
                    }}
                    title="Link Receipt"
                    leadingIcon="link-variant"
                  />
                  {(() => {
                    if (message.linkedCount > 0) return null;

                    const suggestion = findSuggestedTenants(
                      message.message_content,
                      tenants,
                      contracts,
                      allMessages,
                      paymentMessageReceipts,
                      receipts,
                    )[0];
                    const hasSuggestedMatch = suggestion && suggestion.confidence > 0.6;

                    if (hasSuggestedMatch) return null;

                    return (
                      <Menu.Item
                        onPress={() => {
                          setMenuVisible(prev => ({ ...prev, [message.id]: false }));
                          const parsed = extractMessageMetadata(message.message_content);
                          onDismiss();
                          router.push({
                            pathname: '/(tabs)/tenants/create',
                            params: {
                              name: parsed.name || '',
                              phone: parsed.phone || '',
                            },
                          });
                        }}
                        title="Create Tenant"
                        leadingIcon="account-plus-outline"
                      />
                    );
                  })()}
                  <Divider />
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(prev => ({ ...prev, [message.id]: false }));
                      handleDelete(message);
                    }}
                    title="Delete Message"
                    leadingIcon="delete-outline"
                    titleStyle={{ color: colors.error }}
                  />
                </Menu>
              )}
            </View>
          </View>

          <Text variant="bodyMedium" style={styles.messageText}>
            {message.message_content}
          </Text>

          {selectedIds.has(message.id) && (
            <View style={styles.selectionIndicator}>
              <MaterialCommunityIcons
                name="check-circle"
                size={18}
                color={colors.primary}
              />
            </View>
          )}
        </Card.Content>
      </Card>
    );
  };

  return (
    <Portal>
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title={title}
        subtitle="Manage payments and receipts"
        edgeToEdge
        maxHeight="90%"
        scrollable={false}
        search={
          showSearch
            ? {
                placeholder: 'Search messages...',
                value: searchQuery,
                onChangeText: setSearchQuery,
                onClear: () => setSearchQuery(''),
              }
            : null
        }
        headerRight={
          <IconButton
            icon={showSearch ? 'magnify-minus' : 'magnify'}
            onPress={() => {
              if (showSearch) setSearchQuery('');
              setShowSearch(!showSearch);
            }}
            size={22}
          />
        }
      >
        <View style={styles.container}>
          <View
            style={[styles.filterContainer, { borderBottomColor: colors.outlineVariant }]}
          >
            <FilterButtons
              options={[
                { label: 'All', value: 'all', icon: 'layers-outline' },
                { label: 'Unlinked', value: 'unlinked', icon: 'link-off' },
                { label: 'Linked', value: 'linked', icon: 'link' },
              ]}
              selectedValue={statusFilter}
              onValueChange={value => setStatusFilter(value as StatusFilter)}
              selectButton={(() => {
                const allSelected =
                  filteredMessages.length > 0 &&
                  filteredMessages.every(m => selectedIds.has(m.id));
                return {
                  label: allSelected ? 'Deselect all' : 'Select all',
                  icon: allSelected
                    ? 'checkbox-multiple-marked'
                    : 'checkbox-multiple-blank-outline',
                  onPress: handleSelectAll,
                };
              })()}
            />
          </View>

          <View style={[styles.statsRow, { borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.statItem}>
              <Text variant="labelSmall" style={{ color: colors.warning }}>
                {messages.filter(m => m.linkedCount === 0).length} Unlinked
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text variant="labelSmall" style={{ color: colors.success }}>
                {messages.filter(m => m.linkedCount > 0).length} Linked
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text variant="labelSmall" style={{ color: colors.primary }}>
                Total {messages.length}
              </Text>
            </View>
          </View>

          {mode === 'management' && (
            <View style={styles.headerRow}>
              {selectedIds.size > 0 ? (
                <>
                  <Text
                    variant="labelSmall"
                    style={{ fontWeight: 'bold', color: colors.primary }}
                  >
                    {selectedIds.size} SELECTED
                  </Text>
                  <Button
                    mode="text"
                    onPress={handleBulkDelete}
                    compact
                    icon="delete"
                    textColor={colors.error}
                    style={styles.bulkButton}
                    labelStyle={{ fontSize: 13 }}
                  >
                    Delete
                  </Button>
                </>
              ) : (
                <View style={styles.headerActions}>
                  <Button
                    onPress={() => setCreateModalVisible(true)}
                    icon="content-paste"
                    style={styles.bulkButton}
                    labelStyle={{ fontSize: 13 }}
                    compact={true}
                  >
                    Add Message
                  </Button>

                  <Button
                    onPress={() => setPdfModalVisible(true)}
                    icon="file-pdf-box"
                    style={styles.bulkButton}
                    labelStyle={{ fontSize: 13 }}
                    compact={true}
                  >
                    Import PDF
                  </Button>
                </View>
              )}
            </View>
          )}

          <ScrollView
            style={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            showsVerticalScrollIndicator={false}
          >
            {filteredMessages.slice(0, displayLimit).length > 0 ? (
              <>
                {filteredMessages.slice(0, displayLimit).map(renderMessageItem)}
                {filteredMessages.length > displayLimit && (
                  <Button
                    mode="text"
                    onPress={() => setDisplayLimit(prev => prev + 10)}
                    style={styles.loadMoreButton}
                  >
                    Load More ({filteredMessages.length - displayLimit} remaining)
                  </Button>
                )}
              </>
            ) : (
              <EmptyState icon="chat-outline" title="No payment messages found" />
            )}
          </ScrollView>
        </View>
      </BaseModal>

      <PaymentMessageModal
        visible={createModalVisible}
        onDismiss={() => {
          setCreateModalVisible(false);
          setSelectedMessage(null);
        }}
        onMessageCreated={msg => {
          setCreateModalVisible(false);
          setSelectedMessage(null);
          if (mode === 'selection') {
            onSelect?.(msg);
          }
        }}
        businessId={selectedBusiness?.id || ''}
        existingMessages={allMessages as any}
        messageToEdit={selectedMessage as any}
        tenants={tenants as any}
        contracts={contracts as any}
      />

      <PaymentMessageModal
        visible={editModalVisible}
        onDismiss={() => {
          setEditModalVisible(false);
          setSelectedMessage(null);
        }}
        onMessageUpdated={() => {
          setEditModalVisible(false);
          setSelectedMessage(null);
        }}
        messageToEdit={selectedMessage}
        businessId={selectedBusiness?.id || ''}
        existingMessages={allMessages as any[]}
        tenants={tenants as any}
        contracts={contracts as any}
      />

      <ReceiptsFromMessageModal
        visible={createReceiptModalVisible}
        onDismiss={() => {
          setCreateReceiptModalVisible(false);
          setSelectedMessage(null);
        }}
        message={selectedMessage}
        businessId={selectedBusiness?.id || ''}
      />

      <LinkReceiptModal
        visible={linkReceiptModalVisible}
        onDismiss={() => {
          setLinkReceiptModalVisible(false);
          setSelectedMessage(null);
        }}
        onSelect={(receiptId, amount) => {
          setSelectedReceiptId(receiptId);
          setLinkingAmount(amount);
          setLinkReceiptModalVisible(false);
          setShowAmountModal(true);
        }}
        message={selectedMessage}
        businessId={selectedBusiness?.id || ''}
      />

      <LinkAmountModalComponent
        visible={showAmountModal}
        onDismiss={() => setShowAmountModal(false)}
        onConfirm={amount => {
          setLinkingAmount(amount);
          handleLinkToExistingReceipt(amount);
        }}
        message={selectedMessage}
        initialAmount={linkingAmount}
        currencySymbol={defaultCurrency?.symbol}
        colors={colors}
        saving={saving}
      />

      <ImportMessagesModal
        visible={pdfModalVisible}
        onDismiss={() => setPdfModalVisible(false)}
        businessId={selectedBusiness?.id || ''}
        tenants={tenants as any}
        contracts={contracts as any}
        allMessages={allMessages as any}
        paymentMessageReceipts={paymentMessageReceipts}
        receipts={receipts}
      />

      <PaymentMessageDetailsModal
        visible={viewDetailsVisible}
        onDismiss={() => {
          setViewDetailsVisible(false);
          setSelectedMessage(null);
        }}
        onReceiptPress={receiptId => {
          setViewDetailsVisible(false);
          setSelectedMessage(null);
          onDismiss();
          router.push(`/(tabs)/receipts/view/${receiptId}`);
        }}
        onCreateTenant={(name, phone) => {
          setViewDetailsVisible(false);
          setSelectedMessage(null);
          onDismiss();
          router.push({
            pathname: '/(tabs)/tenants/create',
            params: { name, phone },
          });
        }}
        message={selectedMessage}
        paymentMessageReceipts={paymentMessageReceipts}
        receipts={receipts}
        tenants={tenants as any}
        houses={houses as any}
        contracts={contracts as any}
        properties={properties as any}
        businessId={selectedBusiness?.id || ''}
        onUnlink={handleUnlinkMessage}
      />

      <BaseModal
        visible={suggestionModalVisible}
        onDismiss={() => setSuggestionModalVisible(false)}
        mode="info"
        title={
          activeSuggestion?.tenantName === 'No Suggestion'
            ? 'No Suggestion'
            : 'Tenant Suggestion'
        }
        subtitle="Manage your tenants"
      >
        {activeSuggestion && (
          <View style={{ paddingVertical: 10 }}>
            <Text
              variant="titleMedium"
              style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: 4 }}
            >
              {activeSuggestion.tenantName}
            </Text>
            <Text
              variant="bodySmall"
              style={{
                textAlign: 'center',
                color: colors.onSurfaceVariant,
                marginBottom: 16,
              }}
            >
              {activeSuggestion.reason}
            </Text>

            {activeSuggestion.value && (
              <Text
                variant="labelSmall"
                style={{
                  textAlign: 'center',
                  color: colors.primary,
                  fontWeight: 'bold',
                  marginBottom: 16,
                }}
              >
                Matched value: {activeSuggestion.value}
              </Text>
            )}

            {activeSuggestion.source && (
              <Surface
                style={{
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: colors.surfaceVariant,
                }}
              >
                <Text
                  variant="labelSmall"
                  style={{ color: colors.primary, marginBottom: 4, fontWeight: 'bold' }}
                >
                  Matched from:
                </Text>
                <Text variant="bodySmall" style={{ fontStyle: 'italic' }}>
                  &quot;{activeSuggestion.source}&quot;
                </Text>
              </Surface>
            )}

            {activeSuggestion.message &&
              activeSuggestion.message.linkedCount === 0 &&
              !activeSuggestion.tenantName && (
                <Button
                  mode="contained"
                  icon="account-plus-outline"
                  style={{ marginTop: 16 }}
                  onPress={() => {
                    setSuggestionModalVisible(false);
                    onDismiss();
                    const parsed = extractMessageMetadata(
                      activeSuggestion.message.message_content,
                    );
                    router.push({
                      pathname: '/(tabs)/tenants/create',
                      params: {
                        name: parsed.name || '',
                        phone: parsed.phone || '',
                      },
                    });
                  }}
                >
                  Create Tenant
                </Button>
              )}
          </View>
        )}
      </BaseModal>
      <BaseModal
        mode="confirm"
        visible={showUnlinkConfirm}
        onDismiss={() => {
          setShowUnlinkConfirm(false);
          setUnlinkMessageParams(null);
        }}
        onConfirm={async () => {
          if (!unlinkMessageParams || !selectedBusiness?.id) return;
          try {
            const messageReceiptIds = paymentMessageReceipts.filter(
              pmr => pmr.payment_message_id === unlinkMessageParams.id,
            );
            for (const record of messageReceiptIds) {
              await deleteRecord('payment_message_receipts', record.id);
            }
            showSnackbar('Payment message unlinked successfully', 'success');
            setViewDetailsVisible(false);
          } catch (error) {
            console.error('Error unlinking message:', error);
            showSnackbar('Failed to unlink payment message', 'error');
          } finally {
            setShowUnlinkConfirm(false);
            setUnlinkMessageParams(null);
          }
        }}
        title="Unlink Payment Message"
        message={`Are you sure you want to unlink this payment message from ${paymentMessageReceipts.filter(pmr => pmr.payment_message_id === unlinkMessageParams?.id).length} receipt(s)?`}
        confirmText="Unlink"
        destructive={true}
      />

      <BaseModal
        mode="confirm"
        visible={showDeleteConfirm}
        onDismiss={() => {
          setShowDeleteConfirm(false);
          setDeleteMessageParams(null);
        }}
        onConfirm={async () => {
          if (!selectedBusiness?.id) return;
          try {
            const idsToDelete =
              selectedIds.size > 0
                ? Array.from(selectedIds)
                : deleteMessageParams
                  ? [deleteMessageParams.id]
                  : [];

            if (idsToDelete.length === 0) return;

            for (const messageId of idsToDelete) {
              // 1. Delete junction records first to break links
              const linkedJunctions = paymentMessageReceipts.filter(
                pmr => pmr.payment_message_id === messageId,
              );

              for (const junction of linkedJunctions) {
                await deleteRecord('payment_message_receipts', junction.id);
              }

              // 2. Delete the message itself
              await deleteRecord('payment_messages', messageId);
            }

            showSnackbar(
              idsToDelete.length > 1
                ? `Successfully deleted ${idsToDelete.length} messages`
                : 'Payment message deleted successfully',
              'success',
            );

            setSelectedIds(new Set());
          } catch (error) {
            console.error('Delete error:', error);
            showSnackbar('Failed to delete payment message(s)', 'error');
          } finally {
            setShowDeleteConfirm(false);
            setDeleteMessageParams(null);
          }
        }}
        title={selectedIds.size > 1 ? 'Bulk Delete Messages' : 'Delete Message'}
        message={
          selectedIds.size > 1
            ? `Are you sure you want to delete ${selectedIds.size} selected messages? This will also unlink them from any receipts.`
            : 'Are you sure you want to delete this payment message?'
        }
        confirmText="Delete"
        destructive={true}
      />
    </Portal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterContainer: {
    paddingHorizontal: 2,
    borderBottomWidth: 0.5,
  },
  list: {
    flex: 1,
  },
  loadMoreButton: {
    marginVertical: 12,
  },
  messageCard: {
    marginBottom: 12,
    marginHorizontal: 16,
    borderRadius: 12,
  },
  selectionCard: {
    borderWidth: 1.5,
  },
  cardContent: {
    padding: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateText: {
    marginLeft: 4,
  },
  messageText: {
    lineHeight: 20,
  },
  selectionIndicator: {
    position: 'absolute',
    bottom: 8,
    right: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    marginTop: 4,
    paddingHorizontal: 8,
  },
  headerActions: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bulkButton: {
    margin: 0,
    padding: 0,
    minWidth: 0,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 2,
    borderBottomWidth: 0.5,
  },
  statItem: {
    alignItems: 'center',
  },
});
