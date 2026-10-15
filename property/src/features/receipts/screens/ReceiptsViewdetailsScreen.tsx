import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  Avatar,
  Button,
  Chip,
  Divider,
  HelperText,
  IconButton,
  Menu,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import PaymentMessagesListModal from '@/features/payments/components/PaymentMessagesListModal';
import {
  formatPaymentMethod,
  formatPaymentType,
  formatReceiptNumber,
  formatReceiptStatusLabel,
  formatRefundText,
  getPaymentTypeStyle,
  getReceiptStatusStyle,
  type PaymentPeriod,
  resolveReceiptWaiverAndRent,
} from '@/features/receipts/utils/receiptHelper';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import HistoryModal from '@/shared/components/HistoryModal';
import LoadingCard from '@/shared/components/LoadingCard';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import {
  useContractsById,
  useCoreMutations,
  useHousesById,
  usePaymentMessageReceipts,
  usePaymentMessages,
  usePropertiesById,
  useReceiptRefunds,
  useReceipts,
  useReceiptsById,
  useSettings,
  useStoreRefresh,
  useTenantsById,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import {
  defaultCurrencies,
  formatDate,
  formatPeriod,
  formatWithCurrency,
} from '@/shared/utils/formatters';
import { addOpacity, generateUUID, maskPhoneNumber } from '@/shared/utils/helper';
import type { PaymentMessage as StorePaymentMessage } from '@/shared/types/types';
import { generateAndShareRefundVoucher } from '@/templates/refundVoucherTemplate';

export default function ViewReceiptScreen() {
  const { user } = useAuth();

  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors() as any;
  const { loading: accessLoading, hasAccess, isOwner, tenantId } = useAccessControl();

  const { selectedBusiness } = useBusiness();
  const { update, insert, insertMany } = useCoreMutations();
  const tenantsById = useTenantsById(selectedBusiness?.id);
  const housesById = useHousesById(selectedBusiness?.id);
  const propertiesById = usePropertiesById(selectedBusiness?.id);
  const contractsById = useContractsById(selectedBusiness?.id);
  const receiptsById = useReceiptsById(selectedBusiness?.id);
  const receipts = useReceipts(selectedBusiness?.id);

  const allPaymentMessages = usePaymentMessages(selectedBusiness?.id);
  const allLinks = usePaymentMessageReceipts(selectedBusiness?.id);
  const allRefunds = useReceiptRefunds(selectedBusiness?.id);
  const allSettings = useSettings(selectedBusiness?.id);
  const { refreshing, onRefresh } = useStoreRefresh();

  const defaultCurrency = useMemo(() => {
    const currencySetting = allSettings.find(s => s.setting_key === 'currency_settings');
    if (currencySetting && Array.isArray(currencySetting.setting_value)) {
      const currencies = currencySetting.setting_value as any[];
      return currencies.find(c => c.default) || currencies[0] || defaultCurrencies[0];
    }
    return defaultCurrencies[0];
  }, [allSettings]);

  const receipt = useMemo(() => {
    const r = receiptsById.get(id as string);
    if (!r) return null;

    // Join related data
    const contract = contractsById.get(r.contract_id as string);
    const tenant = tenantsById.get(r.tenant_id as string);
    const house = contract ? housesById.get(contract.house_id as string) : null;
    const property = house ? propertiesById.get(house.property_id as string) : null;

    const uniqueMsgIds = new Set<string>();
    const linkedMessages = allLinks
      .filter(link => link.receipt_id === id)
      .map(link => {
        if (uniqueMsgIds.has(link.payment_message_id)) return null;
        uniqueMsgIds.add(link.payment_message_id);
        return allPaymentMessages.find(m => m.id === link.payment_message_id);
      })
      .filter((m): m is StorePaymentMessage => m !== undefined && m !== null);

    const refunds = allRefunds.filter(ref => ref.receipt_id === id);

    const { targetRent, status: computedStatus } = resolveReceiptWaiverAndRent({
      receipt: r as any,
      contract,
    });

    // Calculate status if not set
    const status = r.status || (r.type === 'others' ? 'paid' : computedStatus);

    return {
      ...r,
      amount: Number(r.amount),
      target_rent: targetRent,
      refunded_amount: Number(r.refunded_amount || 0),
      payment_period: r.payment_period as unknown as PaymentPeriod,
      contract: contract
        ? {
            ...contract,
            rent_amount: Number(contract.rent_amount),
            tenant: tenant
              ? { name: tenant.name, phone: tenant.phone, email: tenant.email }
              : undefined,
            house: house
              ? {
                  house_number: house.house_number,
                  property: property ? { name: property.name } : undefined,
                }
              : undefined,
          }
        : undefined,
      refunds: refunds.map(ref => ({
        ...ref,
        amount: Number(ref.amount),
      })),
      linked_payment_messages: linkedMessages,
      status,
    };
  }, [
    id,
    receiptsById,
    contractsById,
    tenantsById,
    housesById,
    propertiesById,
    allLinks,
    allPaymentMessages,
    allRefunds,
  ]);

  const loading = !id || (receipts.length === 0 && !selectedBusiness);

  const [refundDialogVisible, setRefundDialogVisible] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundError, setRefundError] = useState<string | null>(null);
  const [selectedRefundMessages, setSelectedRefundMessages] = useState<
    StorePaymentMessage[]
  >([]);
  const [messagesModalVisible, setMessagesModalVisible] = useState(false);
  const [activeRefundMenu, setActiveRefundMenu] = useState<string | null>(null);
  const [refundLoading, setRefundLoading] = useState(false);

  const handleReshareRefundVoucher = (refund: any) => {
    if (!receipt || !selectedBusiness) return;

    // Get linked message IDs from refund metadata
    const linkedMsgIds = (refund as any).metadata?.linked_payment_message_ids || [];
    const linkedMessages = allPaymentMessages.filter(m => linkedMsgIds.includes(m.id));

    const refundData = {
      id: refund.id,
      receipt_id: receipt.id,
      amount: refund.amount,
      reason: refund.reason || '',
      created_at: refund.created_at,
      tenantName: receipt.contract?.tenant?.name || 'N/A',
      tenantPhone: receipt.contract?.tenant?.phone || 'N/A',
      propertyName: receipt.contract?.house?.property?.name || 'N/A',
      houseNumber: receipt.contract?.house?.house_number || 'N/A',
      originalAmount: receipt.amount,
      paymentMethod: receipt.payment_method || 'N/A',
      linked_payment_messages: linkedMessages,
    };
    generateAndShareRefundVoucher(refundData, selectedBusiness as any);
  };

  const getPaymentTypeColor = (type: string = '') => getPaymentTypeStyle(type, colors);

  const getPaymentStatusColor = (status: string = '') =>
    getReceiptStatusStyle(status, colors);

  const formatPaymentStatus = (status: string = ''): string =>
    formatReceiptStatusLabel(status).toUpperCase();

  const remainingRefundable = useMemo(() => {
    if (!receipt?.amount) return 0;
    return Math.max(
      0,
      parseFloat(String(receipt.amount || 0)) -
        parseFloat(String(receipt.refunded_amount || 0)),
    );
  }, [receipt?.amount, receipt?.refunded_amount]);

  const displayStatus = useMemo(() => {
    if (receipt?.is_refunded) return 'refunded';
    if ((receipt?.refunded_amount || 0) > 0) return 'partial_refund';
    return receipt?.status || 'paid';
  }, [receipt?.is_refunded, receipt?.refunded_amount, receipt?.status]);

  const typeStyle = getPaymentTypeColor(receipt?.type || '');
  const statusStyle = getPaymentStatusColor(displayStatus);
  const canRefund = useMemo(() => {
    if (receipt?.is_refunded) return false;
    return isOwner || hasAccess(['admin']);
  }, [hasAccess, isOwner, receipt?.is_refunded]);

  if (loading || accessLoading) {
    return <LoadingCard iconName="receipt" text="Loading receipt data..." />;
  }

  if (!selectedBusiness?.id) {
    return (
      <View style={styles.centered}>
        <Text>Please select a business first</Text>
      </View>
    );
  }

  const isTenantOnly = hasAccess(['tenant']) && !hasAccess(['staff', 'admin']);

  if (!receipt || (isTenantOnly && receipt.tenant_id !== tenantId)) {
    return (
      <View style={styles.centered}>
        <Text>Receipt not found or access denied</Text>
      </View>
    );
  }

  const openRefundDialog = () => {
    setRefundAmount(
      remainingRefundable > 0 ? String(remainingRefundable.toFixed(2)) : '',
    );
    setRefundReason('');
    setRefundError('');
    setRefundDialogVisible(true);
  };

  const handleRefund = async () => {
    if (!selectedBusiness?.id || !receipt?.id) {
      setRefundError('Missing receipt information');
      return;
    }

    const numericAmount = parseFloat(refundAmount);
    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      setRefundError('Enter a valid refund amount');
      return;
    }

    if (numericAmount > remainingRefundable + 0.0001) {
      setRefundError('Refund amount exceeds remaining balance');
      return;
    }

    try {
      setRefundLoading(true);
      setRefundError('');

      if (!user) throw new Error('User not authenticated');

      const newRefundedTotal = (receipt.refunded_amount || 0) + numericAmount;
      const isFullyRefunded = newRefundedTotal >= (receipt.amount || 0) - 0.0001;

      // Update receipt via local-lite
      await update('receipts', receipt.id, {
        refunded_amount: newRefundedTotal,
        is_refunded: isFullyRefunded,
        refund_reason: refundReason.trim() || receipt.refund_reason,
      });

      // Add refund record
      const refundId = generateUUID();
      if (insert) {
        await insert('receipt_refunds', {
          id: refundId,
          receipt_id: receipt.id,
          business_id: selectedBusiness.id,
          amount: numericAmount,
          reason: refundReason.trim(),
          metadata: {
            linked_payment_message_ids: selectedRefundMessages.map(m => m.id),
          },
          user_id: user.id,
        } as any);
      }

      // Link payment messages to the parent receipt for visibility in linked lists
      if (selectedRefundMessages.length > 0 && insertMany) {
        const links = selectedRefundMessages.map(msg => ({
          id: generateUUID(),
          payment_message_id: msg.id,
          receipt_id: receipt.id,
          business_id: selectedBusiness.id,
          user_id: user.id,
        }));
        await insertMany('payment_message_receipts', links);
      }

      setRefundDialogVisible(false);
      setSelectedRefundMessages([]);

      // Prompt to share voucher
      Alert.alert(
        'Refund Successful',
        'Would you like to generate and share the refund voucher?',
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Share Voucher',
            onPress: () => {
              const refundData = {
                id: refundId,
                receipt_id: receipt.id,
                amount: numericAmount,
                reason: refundReason.trim(),
                created_at: new Date().toISOString(),
                tenantName: receipt.contract?.tenant?.name || 'N/A',
                tenantPhone: receipt.contract?.tenant?.phone || 'N/A',
                propertyName: receipt.contract?.house?.property?.name || 'N/A',
                houseNumber: receipt.contract?.house?.house_number || 'N/A',
                originalAmount: receipt.amount,
                paymentMethod: receipt.payment_method || 'N/A',
                linked_payment_messages: selectedRefundMessages,
              };
              generateAndShareRefundVoucher(refundData, selectedBusiness as any);
            },
          },
        ],
      );
    } catch (error: any) {
      console.error('Refund error:', error);
      setRefundError(error?.message || 'Failed to process refund');
    } finally {
      setRefundLoading(false);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Surface
        style={[styles.unifiedSurface, { backgroundColor: colors.surface }]}
        elevation={2}
      >
        <View style={styles.unifiedContent}>
          {/* Header Section */}
          <View style={styles.headerSection}>
            <View style={styles.headerTop}>
              <View style={styles.titleSection}>
                <Avatar.Icon
                  size={48}
                  icon="receipt-text"
                  style={{ backgroundColor: colors.primaryContainer, marginBottom: 8 }}
                  color={colors.primary}
                />
                <Text variant="titleLarge" style={styles.receiptTitle}>
                  PAYMENT RECEIPT
                </Text>
                <Text
                  variant="bodySmall"
                  style={[styles.receiptNumber, { color: colors.onSurfaceVariant }]}
                >
                  #{formatReceiptNumber(receipt.id)}
                </Text>
              </View>
            </View>

            <View style={styles.chipRow}>
              <Chip
                icon={typeStyle.icon}
                style={[styles.headerChip, { backgroundColor: typeStyle.bgColor }]}
                textStyle={{ color: typeStyle.color, fontSize: 11 }}
                compact
              >
                {formatPaymentType(receipt.type)}
              </Chip>
              <Chip
                icon={statusStyle.icon}
                style={[styles.headerChip, { backgroundColor: statusStyle.bgColor }]}
                textStyle={{ color: statusStyle.color, fontSize: 11 }}
                compact
              >
                {formatPaymentStatus(displayStatus)}
              </Chip>
            </View>
          </View>

          <View style={styles.receiptDividerContainer}>
            <View
              style={[
                styles.receiptDivider,
                { borderBottomColor: colors.outlineVariant },
              ]}
            />
          </View>

          {/* Amount Section */}
          <View
            style={[
              styles.amountCard,
              { backgroundColor: addOpacity(colors.primary, 0.1) },
            ]}
          >
            <Text
              variant="labelMedium"
              style={[styles.amountLabel, { color: colors.onSurfaceVariant }]}
            >
              TOTAL AMOUNT PAID
            </Text>
            <Text
              variant="headlineLarge"
              style={[styles.amountValue, { color: colors.primary }]}
            >
              {formatWithCurrency(receipt.amount || 0, defaultCurrency as any)}
            </Text>
            {(receipt.refunded_amount || 0) > 0 && (
              <Text style={{ color: colors.error, fontStyle: 'italic', fontSize: 13 }}>
                {' '}
                {formatRefundText(receipt.refunded_amount, defaultCurrency)}
              </Text>
            )}
            {receipt.target_rent && (
              <Text
                variant="bodySmall"
                style={{ color: colors.onSurfaceVariant, marginTop: 4 }}
              >
                of {formatWithCurrency(receipt.target_rent, defaultCurrency as any)}{' '}
                monthly rent
              </Text>
            )}
          </View>

          <View style={styles.receiptDividerContainer}>
            <View
              style={[
                styles.receiptDivider,
                { borderBottomColor: colors.outlineVariant },
              ]}
            />
          </View>

          <View style={[styles.infoBlock, { borderLeftColor: colors.primary }]}>
            <View style={styles.infoRow}>
              <View style={styles.labelSection}>
                <MaterialCommunityIcons
                  name="account"
                  size={14}
                  color={colors.onSurfaceVariant}
                />
                <Text
                  variant="labelSmall"
                  style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}
                >
                  TENANT
                </Text>
              </View>
              <Text variant="bodyMedium" style={styles.infoValue}>
                {receipt.contract?.tenant?.name || 'Unknown'}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <View style={styles.labelSection}>
                <MaterialCommunityIcons
                  name="office-building"
                  size={14}
                  color={colors.onSurfaceVariant}
                />
                <Text
                  variant="labelSmall"
                  style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}
                >
                  PROPERTY
                </Text>
              </View>
              <Text variant="bodyMedium" style={styles.infoValue}>
                {receipt.contract?.house?.house_number} •{' '}
                {receipt.contract?.house?.property?.name}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <View style={styles.labelSection}>
                <MaterialCommunityIcons
                  name="calendar"
                  size={14}
                  color={colors.onSurfaceVariant}
                />
                <Text
                  variant="labelSmall"
                  style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}
                >
                  DATE
                </Text>
              </View>
              <Text variant="bodyMedium" style={styles.infoValue}>
                {receipt.payment_date ? formatDate(receipt.payment_date) : 'N/A'}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <View style={styles.labelSection}>
                <MaterialCommunityIcons
                  name="calendar-month"
                  size={14}
                  color={colors.onSurfaceVariant}
                />
                <Text
                  variant="labelSmall"
                  style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}
                >
                  PERIOD
                </Text>
              </View>
              <Text variant="bodyMedium" style={styles.infoValue}>
                {formatPeriod({
                  month: receipt.payment_period.month,
                  year: receipt.payment_period.year,
                })}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <View style={styles.labelSection}>
                <MaterialCommunityIcons
                  name="credit-card"
                  size={14}
                  color={colors.onSurfaceVariant}
                />
                <Text
                  variant="labelSmall"
                  style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}
                >
                  METHOD
                </Text>
              </View>
              <Text variant="bodyMedium" style={styles.infoValue}>
                {formatPaymentMethod(receipt.payment_method || '')}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <View style={styles.labelSection}>
                <MaterialCommunityIcons
                  name="tag"
                  size={14}
                  color={colors.onSurfaceVariant}
                />
                <Text
                  variant="labelSmall"
                  style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}
                >
                  TYPE
                </Text>
              </View>
              <Text variant="bodyMedium" style={styles.infoValue}>
                {formatPaymentType(receipt.type)}
              </Text>
            </View>
          </View>

          {receipt.notes && (
            <View style={styles.subSection}>
              <Divider style={styles.subDivider} />
              <Text variant="labelSmall" style={styles.subTitle}>
                NOTES
              </Text>
              <Text variant="bodyMedium" style={styles.notesText}>
                {maskPhoneNumber(receipt.notes)}
              </Text>
            </View>
          )}

          {receipt.refunds && receipt.refunds.length > 0 && (
            <View style={styles.subSection}>
              <Divider style={styles.subDivider} />
              <Text
                variant="labelSmall"
                style={[styles.subTitle, { color: colors.error }]}
              >
                REFUND HISTORY
              </Text>
              {receipt.refunds.map((refund: any) => (
                <View
                  key={refund.id}
                  style={[
                    styles.refundRow,
                    {
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                      {formatWithCurrency(refund.amount, defaultCurrency as any)}
                    </Text>
                    <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                      {refund.reason || 'No reason'} •{' '}
                      {refund.created_at ? formatDate(refund.created_at) : ''}
                    </Text>
                  </View>
                  <Menu
                    visible={activeRefundMenu === refund.id}
                    onDismiss={() => setActiveRefundMenu(null)}
                    anchor={
                      <IconButton
                        icon="dots-vertical"
                        size={20}
                        onPress={() => setActiveRefundMenu(refund.id)}
                      />
                    }
                  >
                    <Menu.Item
                      onPress={() => {
                        handleReshareRefundVoucher(refund);
                        setActiveRefundMenu(null);
                      }}
                      title="Share Voucher"
                      leadingIcon="share-variant"
                    />
                  </Menu>
                </View>
              ))}
            </View>
          )}

          {receipt.linked_payment_messages &&
            receipt.linked_payment_messages.length > 0 && (
              <View style={styles.subSection}>
                <Divider style={styles.subDivider} />
                <Text variant="labelSmall" style={styles.subTitle}>
                  LINKED MESSAGES
                </Text>
                {receipt.linked_payment_messages.map((message: any, index: number) => (
                  <Surface
                    key={index}
                    style={[
                      styles.messageCard,
                      { backgroundColor: colors.surfaceVariant },
                    ]}
                    elevation={0}
                  >
                    <Text variant="bodySmall" style={{ fontStyle: 'italic' }}>
                      &quot;{message.message_content}&quot;
                    </Text>
                  </Surface>
                ))}
              </View>
            )}
        </View>
      </Surface>

      {canRefund && remainingRefundable > 0 && (
        <View style={styles.actionContainer}>
          <Button mode="contained" icon="cash-refund" onPress={openRefundDialog}>
            Refund Receipt
          </Button>
        </View>
      )}

      <BaseModal
        visible={refundDialogVisible}
        onDismiss={() => !refundLoading && setRefundDialogVisible(false)}
        title="Refund Receipt"
        subtitle="Manage payments and receipts"
        scrollable={true}
        actions={[
          {
            label: 'Cancel',
            mode: 'outlined',
            onPress: () => setRefundDialogVisible(false),
            disabled: refundLoading,
          },
          {
            label: 'Process Refund',
            mode: 'contained',
            onPress: handleRefund,
            loading: refundLoading,
            disabled: refundLoading,
          },
        ]}
      >
        <TextInput
          label="Refund Amount"
          value={refundAmount}
          onChangeText={setRefundAmount}
          keyboardType="decimal-pad"
          style={styles.input}
          disabled={refundLoading}
          right={<TextInput.Affix text={defaultCurrency?.symbol || ''} />}
        />
        <TextInput
          label="Reason"
          value={refundReason}
          onChangeText={setRefundReason}
          style={styles.input}
          disabled={refundLoading}
          multiline
          numberOfLines={3}
        />

        <View style={{ marginTop: 8, marginBottom: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <Text variant="titleSmall">Linked Messages</Text>
            <Button
              mode="text"
              compact
              onPress={() => setMessagesModalVisible(true)}
              icon="message-plus"
              disabled={refundLoading}
            >
              Attach
            </Button>
          </View>

          {selectedRefundMessages.length > 0 ? (
            <View style={{ gap: 8 }}>
              {selectedRefundMessages.map(msg => (
                <Surface
                  key={msg.id}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    backgroundColor: colors.surfaceVariant,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                  elevation={0}
                >
                  <Text
                    variant="bodySmall"
                    style={{ flex: 1, marginRight: 8 }}
                    numberOfLines={2}
                  >
                    {msg.message_content}
                  </Text>
                  <IconButton
                    icon="close-circle"
                    size={18}
                    onPress={() =>
                      setSelectedRefundMessages(prev => prev.filter(m => m.id !== msg.id))
                    }
                    disabled={refundLoading}
                  />
                </Surface>
              ))}
            </View>
          ) : (
            <Text
              variant="bodySmall"
              style={{ fontStyle: 'italic', color: colors.onSurfaceVariant }}
            >
              No messages attached to this refund
            </Text>
          )}
        </View>

        <Text
          variant="bodySmall"
          style={{ marginTop: 4, color: colors.onSurfaceVariant }}
        >
          Remaining refundable:{' '}
          {formatWithCurrency(remainingRefundable, defaultCurrency as any)}
        </Text>
        {refundError ? <HelperText type="error">{refundError}</HelperText> : null}
      </BaseModal>

      <PaymentMessagesListModal
        visible={messagesModalVisible}
        onDismiss={() => setMessagesModalVisible(false)}
        mode="selection"
        onSelect={msg => {
          if (!selectedRefundMessages.find(m => m.id === msg.id)) {
            setSelectedRefundMessages(prev => [...prev, msg]);
          }
          setMessagesModalVisible(false);
        }}
      />
      {isOwner && (
        <HistoryModal
          entityType="receipts"
          entityId={(receipt as any)?.id}
          containerStyle={{ marginHorizontal: 16, marginBottom: 32 }}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  unifiedSurface: {
    margin: 10,
    borderRadius: 16,
    overflow: 'hidden',
  },
  unifiedContent: {
    padding: 24,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTop: {
    alignItems: 'center',
    marginBottom: 8,
  },
  titleSection: {
    alignItems: 'center',
  },
  receiptTitle: {
    fontWeight: 'bold',
    letterSpacing: 1,
    fontSize: 18,
    marginBottom: 4,
  },
  receiptNumber: {
    fontSize: 14,
    fontWeight: '500',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  headerChip: {
    height: 28,
  },
  receiptDividerContainer: {
    height: 20,
    justifyContent: 'center',
  },
  receiptDivider: {
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    width: '100%',
  },
  amountCard: {
    padding: 12,
    borderRadius: 16,
    alignItems: 'center',
    marginVertical: 4,
  },
  amountLabel: {
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 4,
  },
  amountValue: {
    fontWeight: '900',
    fontSize: 28,
  },
  infoBlock: {
    paddingLeft: 16,
    borderLeftWidth: 3,
    marginVertical: 16,
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '35%',
  },
  infoLabel: {
    fontWeight: 'bold',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  infoValue: {
    flex: 1,
    fontWeight: '700',
    textAlign: 'right',
  },
  subSection: {
    marginTop: 20,
  },
  subDivider: {
    marginBottom: 16,
  },
  subTitle: {
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 8,
  },
  notesText: {
    fontStyle: 'italic',
    lineHeight: 20,
  },
  refundRow: {
    marginBottom: 8,
  },
  messageCard: {
    padding: 12,
    borderRadius: 8,
    marginTop: 4,
  },
  actionContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  input: {
    marginTop: 12,
  },
});
