import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, List, Portal, Surface, Text } from 'react-native-paper';
import { findSuggestedTenants } from '@/features/tenants/utils/tenantMatcher';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import {
  useContracts,
  useHouses,
  usePaymentMessageReceipts,
  usePaymentMessages,
  useProperties,
  useReceipts,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { PaymentMessage } from '@/shared/types/types';
import { formatDate } from '@/shared/utils/formatters';
import { addOpacity } from '@/shared/utils/helper';
import { extractMessageMetadata } from '@/shared/utils/parsers';

interface LinkReceiptModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (receiptId: string, extractedAmount: string) => void;
  message: PaymentMessage | null;
  businessId: string;
}

export default function LinkReceiptModal({
  visible,
  onDismiss,
  onSelect,
  message,
  businessId,
}: LinkReceiptModalProps) {
  const colors = useThemeColors();
  const receipts = useReceipts(businessId);
  const contracts = useContracts(businessId);
  const tenants = useTenants(businessId);
  const houses = useHouses(businessId);
  const properties = useProperties(businessId);
  const allMessages = usePaymentMessages(businessId);
  const paymentMessageReceipts = usePaymentMessageReceipts(businessId);

  const [searchQuery, setSearchQuery] = useState('');

  const groupedReceipts = useMemo(() => {
    if (!message) return { suggested: [], partials: [], searchResults: [] };

    const linkedIds = new Set(
      paymentMessageReceipts
        .filter(pmr => pmr.payment_message_id === message.id)
        .map(pmr => pmr.receipt_id),
    );

    const availableReceipts = receipts.filter(r => !linkedIds.has(r.id));

    const enriched = availableReceipts.map(r => {
      const contract = contracts.find(c => c.id === r.contract_id);
      const tenant = tenants.find(t => t.id === r.tenant_id);
      const house = contract ? houses.find(h => h.id === contract.house_id) : undefined;
      const property = house
        ? properties.find(p => p.id === house.property_id)
        : undefined;

      return {
        ...r,
        tenantName: tenant?.name || 'Unknown Tenant',
        propertyName: property?.name || 'Unknown Property',
        houseNumber: house?.house_number || 'Unknown',
        amount: Number(r.amount),
      };
    });

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const filtered = enriched
        .filter(
          item =>
            item.tenantName.toLowerCase().includes(query) ||
            item.propertyName.toLowerCase().includes(query) ||
            item.houseNumber.toLowerCase().includes(query) ||
            String(item.amount).includes(query),
        )
        .sort(
          (a, b) =>
            new Date(b.payment_date || '').getTime() -
            new Date(a.payment_date || '').getTime(),
        );

      return { suggested: [], partials: [], searchResults: filtered };
    }

    const suggestions = findSuggestedTenants(
      message.message_content,
      tenants,
      contracts,
      allMessages,
      paymentMessageReceipts,
      receipts,
    );

    const suggestedReceipts: any[] = [];
    if (suggestions.length > 0 && suggestions[0].confidence > 0.6) {
      const topSuggestion = suggestions[0];
      const tenantReceipts = enriched
        .filter(r => r.tenant_id === topSuggestion.tenantId)
        .sort(
          (a, b) =>
            new Date(b.payment_date || '').getTime() -
            new Date(a.payment_date || '').getTime(),
        );

      if (tenantReceipts.length > 0) {
        suggestedReceipts.push(tenantReceipts[0]);
      }
    }

    const partials = enriched
      .filter(r => r.status === 'partial' && !suggestedReceipts.find(s => s.id === r.id))
      .sort(
        (a, b) =>
          new Date(b.payment_date || '').getTime() -
          new Date(a.payment_date || '').getTime(),
      )
      .slice(0, 5);

    return { suggested: suggestedReceipts, partials, searchResults: [] };
  }, [
    message,
    receipts,
    contracts,
    tenants,
    houses,
    properties,
    paymentMessageReceipts,
    allMessages,
    searchQuery,
  ]);

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'paid':
        return (colors as any).success;
      case 'partial':
        return (colors as any).warning;
      case 'refunded':
        return colors.error;
      default:
        return colors.onSurfaceVariant;
    }
  };

  const handleSelect = (receiptId: string) => {
    const receipt = receipts.find(r => r.id === receiptId);
    if (receipt?.status === 'paid') {
      onSelect(receiptId, '0');
      return;
    }
    const parsed = extractMessageMetadata(message?.message_content || '');
    const amount = parsed.amount != null ? parsed.amount.toString() : '';
    onSelect(receiptId, amount);
  };

  const renderReceiptCard = (receipt: any) => (
    <Surface
      key={receipt.id}
      style={[
        styles.receiptSelectCard,
        { borderColor: colors.outlineVariant, backgroundColor: colors.surface },
      ]}
      elevation={1}
    >
      <List.Item
        title={receipt.tenantName}
        titleStyle={{ fontWeight: 'bold', fontSize: 16 }}
        description={
          <View>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              {receipt.propertyName} • House {receipt.houseNumber}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <MaterialCommunityIcons
                name="calendar-outline"
                size={12}
                color={colors.onSurfaceVariant}
              />
              <Text
                variant="labelSmall"
                style={{ color: colors.onSurfaceVariant, marginLeft: 4 }}
              >
                {formatDate(receipt.payment_date || '')}
              </Text>
            </View>
          </View>
        }
        right={_props => (
          <View style={styles.cardRight}>
            <Text
              variant="titleMedium"
              style={{ color: colors.primary, fontWeight: 'bold' }}
            >
              {receipt.amount?.toLocaleString()}
            </Text>
            <Chip
              mode="flat"
              style={{
                backgroundColor: addOpacity(getStatusColor(receipt.status), 0.1),
                height: 22,
                marginTop: 4,
              }}
              textStyle={{
                fontSize: 9,
                color: getStatusColor(receipt.status),
                fontWeight: 'bold',
                textTransform: 'uppercase',
                marginHorizontal: 4,
                marginVertical: 0,
              }}
            >
              {receipt.status}
            </Chip>
          </View>
        )}
        onPress={() => handleSelect(receipt.id)}
      />
    </Surface>
  );

  return (
    <Portal>
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title="Link to Existing Receipt"
        subtitle="Select a receipt to link this payment message to."
        maxHeight="80%"
        scrollable={true}
        search={{
          placeholder: 'Search all receipts...',
          value: searchQuery,
          onChangeText: setSearchQuery,
          onClear: () => setSearchQuery(''),
        }}
        actions={[
          {
            label: 'Cancel',
            onPress: onDismiss,
            mode: 'outlined',
          },
        ]}
      >
        <View style={styles.container}>
          {searchQuery.trim() ? (
            <>
              <View style={styles.groupHeader}>
                <MaterialCommunityIcons name="magnify" size={14} color={colors.primary} />
                <Text
                  variant="labelMedium"
                  style={[styles.groupHeaderText, { color: colors.primary }]}
                >
                  SEARCH RESULTS
                </Text>
              </View>
              {groupedReceipts.searchResults.length === 0 ? (
                <EmptyState
                  icon="magnify"
                  title={`No receipts found matching "${searchQuery}"`}
                />
              ) : (
                groupedReceipts.searchResults.map(renderReceiptCard)
              )}
            </>
          ) : (
            <>
              {groupedReceipts.suggested.length > 0 && (
                <View style={{ marginBottom: 20 }}>
                  <View style={styles.groupHeader}>
                    <MaterialCommunityIcons
                      name="creation"
                      size={14}
                      color={(colors as any).success}
                    />
                    <Text
                      variant="labelMedium"
                      style={[styles.groupHeaderText, { color: (colors as any).success }]}
                    >
                      SUGGESTED MATCH
                    </Text>
                  </View>
                  {groupedReceipts.suggested.map(renderReceiptCard)}
                </View>
              )}

              {groupedReceipts.partials.length > 0 && (
                <View style={{ marginBottom: 20 }}>
                  <View style={styles.groupHeader}>
                    <MaterialCommunityIcons
                      name="clock"
                      size={14}
                      color={(colors as any).warning}
                    />
                    <Text
                      variant="labelMedium"
                      style={[styles.groupHeaderText, { color: (colors as any).warning }]}
                    >
                      PARTIAL PAYMENTS
                    </Text>
                  </View>
                  {groupedReceipts.partials.map(renderReceiptCard)}
                </View>
              )}

              {groupedReceipts.suggested.length === 0 &&
                groupedReceipts.partials.length === 0 && (
                  <EmptyState
                    icon="receipt-outline"
                    iconSize={64}
                    title="Start searching to find a receipt to link"
                  />
                )}
            </>
          )}
        </View>
      </BaseModal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  receiptSelectCard: {
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: 8,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 4,
    gap: 6,
  },
  groupHeaderText: {
    fontWeight: 'bold',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontSize: 12,
  },
});
