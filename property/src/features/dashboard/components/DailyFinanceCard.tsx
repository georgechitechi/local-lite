import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Card, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import PaymentMessageDetailsModal from '@/features/payments/components/PaymentMessageDetailsModal';
import EmptyState from '@/shared/components/EmptyState';
import SectionGroup from '@/shared/components/SectionGroup';
import SPressable from '@/shared/components/SlightPressable';
import { useCoreMutations } from '@/shared/hooks/useStore';
import { formatMonthYear, formatWithCurrency } from '@/shared/utils/formatters';
import { extractMessageMetadata } from '@/shared/utils/parsers';
import DashboardCardHeader from './DashboardCardHeader';

interface DailyFinanceCardProps {
  loading: boolean;
  receipts: any[];
  paymentMessages: any[];
  paymentMessageReceipts: any[];
  tenants: any[];
  houses: any[];
  contracts: any[];
  properties: any[];
  selectedMonthDate: Date;
  setSelectedMonthDate: (date: Date) => void;
  colors: any;
  defaultCurrency: any;
}

const DailyFinanceCard: React.FC<DailyFinanceCardProps> = ({
  loading,
  receipts,
  paymentMessages,
  paymentMessageReceipts,
  tenants,
  houses,
  contracts,
  properties,
  selectedMonthDate,
  setSelectedMonthDate,
  colors,
  defaultCurrency,
}) => {
  const router = useRouter();
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(new Set());
  const { selectedBusiness } = useBusiness();
  const { delete: deleteRecord } = useCoreMutations();

  const [selectedMessage, setSelectedMessage] = React.useState<any | null>(null);
  const [messageModalVisible, setMessageModalVisible] = React.useState(false);

  const handleUnlinkMessage = async (message: any) => {
    if (!selectedBusiness?.id) return;
    try {
      const junctions = paymentMessageReceipts.filter(
        pmr => pmr.payment_message_id === message.id,
      );
      for (const junction of junctions) {
        await deleteRecord('payment_message_receipts', junction.id);
      }
    } catch (error) {
      console.error('Error unlinking message:', error);
    }
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  // Process data for the selected month
  const filteredData = React.useMemo(() => {
    const targetMonth = selectedMonthDate.getMonth() + 1;
    const targetYear = selectedMonthDate.getFullYear();

    const monthReceipts = receipts
      .filter(r => {
        const date = new Date(r.payment_date);
        return date.getMonth() + 1 === targetMonth && date.getFullYear() === targetYear;
      })
      .sort(
        (a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime(),
      );

    const monthMessages = paymentMessages
      .filter(m => {
        const date = new Date(m.transaction_date);
        return date.getMonth() + 1 === targetMonth && date.getFullYear() === targetYear;
      })
      .sort(
        (a, b) =>
          new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime(),
      );

    return { receipts: monthReceipts, messages: monthMessages };
  }, [receipts, paymentMessages, selectedMonthDate]);

  const totalRent = filteredData.receipts.reduce(
    (sum, r) => sum + (parseFloat(r.amount) || 0),
    0,
  );
  const totalMessages = filteredData.messages.reduce((sum, m) => {
    const metaAmount = extractMessageMetadata(m.message_content).amount;
    const amountVal = parseFloat(m.amount) || parseFloat(metaAmount || '0') || 0;
    return sum + amountVal;
  }, 0);

  const getReceiptInfo = (receipt: any) => {
    const tenant = tenants.find(t => t.id === receipt.tenant_id);
    let house = houses.find(h => h.id === receipt.house_id);
    if (!house && receipt.contract_id) {
      const contract = contracts.find(c => c.id === receipt.contract_id);
      if (contract) house = houses.find(h => h.id === contract.house_id);
    }
    const property = house ? properties.find(p => p.id === house.property_id) : null;
    return {
      tenantName: tenant?.name || 'Unknown',
      houseNumber: house?.house_number || 'N/A',
      propertyName: property?.name || 'Unknown Property',
    };
  };

  return (
    <Card
      mode="elevated"
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
        },
      ]}
    >
      <DashboardCardHeader
        title={formatMonthYear(selectedMonthDate)}
        subtitle="Daily Finance Overview"
        onPrev={() => {
          const d = new Date(
            selectedMonthDate.getFullYear(),
            selectedMonthDate.getMonth() - 1,
            1,
          );
          setSelectedMonthDate(d);
        }}
        onNext={() => {
          const d = new Date(
            selectedMonthDate.getFullYear(),
            selectedMonthDate.getMonth() + 1,
            1,
          );
          setSelectedMonthDate(d);
        }}
        isPrevDisabled={(() => {
          const today = new Date();
          const minDate = new Date(today.getFullYear(), today.getMonth() - 3, 1);
          return (
            selectedMonthDate.getFullYear() < minDate.getFullYear() ||
            (selectedMonthDate.getFullYear() === minDate.getFullYear() &&
              selectedMonthDate.getMonth() <= minDate.getMonth())
          );
        })()}
        isNextDisabled={(() => {
          const today = new Date();
          const maxDate = new Date(today.getFullYear(), today.getMonth() + 3, 1);
          return (
            selectedMonthDate.getFullYear() > maxDate.getFullYear() ||
            (selectedMonthDate.getFullYear() === maxDate.getFullYear() &&
              selectedMonthDate.getMonth() >= maxDate.getMonth())
          );
        })()}
      />

      <Card.Content style={{ paddingHorizontal: 0, paddingBottom: 0 }}>
        {loading ? (
          <ActivityIndicator style={{ padding: 20 }} color={colors.primary} />
        ) : filteredData.receipts.length === 0 && filteredData.messages.length === 0 ? (
          <EmptyState
            title={`No Transactions for ${formatMonthYear(selectedMonthDate)}`}
          />
        ) : (
          <View>
            {/* RENT PAYMENTS GROUP */}
            {filteredData.receipts.length > 0 && (
              <>
                <SectionGroup
                  title="RENT PAYMENTS"
                  subtitle={`${filteredData.receipts.length} Recorded • ${
                    defaultCurrency
                      ? formatWithCurrency(totalRent, defaultCurrency)
                      : totalRent
                  }`}
                  isExpanded={expandedGroups.has('rent')}
                  onToggle={() => toggleGroup('rent')}
                  backgroundColor={colors.surfaceVariant}
                  titleColor={(colors as any).success}
                />

                {expandedGroups.has('rent') && (
                  <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                    {filteredData.receipts.map((receipt, index) => {
                      const { tenantName, houseNumber, propertyName } =
                        getReceiptInfo(receipt);
                      return (
                        <SPressable
                          key={receipt.id || index}
                          onPress={() => router.push(`/receipts/view/${receipt.id}`)}
                          style={[
                            styles.transaction,
                            { borderBottomColor: colors.outlineVariant },
                            index === filteredData.receipts.length - 1 && {
                              borderBottomWidth: 0,
                            },
                          ]}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={styles.transactionDetails}>
                              <Text
                                style={[
                                  styles.transactionTitle,
                                  { color: colors.onSurface },
                                ]}
                              >
                                {tenantName}
                              </Text>
                              <Text
                                style={[
                                  styles.transactionSubtitle,
                                  { color: colors.onSurfaceVariant },
                                ]}
                              >
                                {propertyName} • House {houseNumber}
                              </Text>
                              <Text
                                style={{ fontSize: 10, color: colors.onSurfaceVariant }}
                              >
                                {new Date(receipt.payment_date).toLocaleDateString()}
                              </Text>
                            </View>
                            <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                              <Text
                                style={[
                                  styles.transactionAmount,
                                  { color: (colors as any).success },
                                ]}
                              >
                                {defaultCurrency
                                  ? formatWithCurrency(
                                      parseFloat(receipt.amount),
                                      defaultCurrency,
                                    )
                                  : receipt.amount}
                              </Text>
                              <Text
                                style={{ fontSize: 10, color: colors.onSurfaceVariant }}
                              >
                                Received
                              </Text>
                            </View>
                          </View>
                        </SPressable>
                      );
                    })}
                  </View>
                )}
              </>
            )}

            {/* PAYMENT MESSAGES GROUP */}
            {filteredData.messages.length > 0 && (
              <>
                <SectionGroup
                  title="PAYMENT MESSAGES"
                  subtitle={`${filteredData.messages.length} Messages • ${
                    defaultCurrency
                      ? formatWithCurrency(totalMessages, defaultCurrency)
                      : totalMessages
                  }`}
                  isExpanded={expandedGroups.has('messages')}
                  onToggle={() => toggleGroup('messages')}
                  backgroundColor={colors.surfaceVariant}
                  titleColor={(colors as any).warning}
                />

                {expandedGroups.has('messages') && (
                  <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                    {filteredData.messages.map((message, index) => {
                      const metadata = extractMessageMetadata(message.message_content);
                      const displayAmount = metadata.amount || message.amount || '0';
                      const displayName =
                        metadata.name ||
                        message.sender_name ||
                        message.sender_id ||
                        'Bank Message';

                      const isLinked = paymentMessageReceipts?.some(
                        pmr => pmr.payment_message_id === message.id,
                      );

                      return (
                        <SPressable
                          key={message.id || index}
                          onPress={() => {
                            setSelectedMessage(message);
                            setMessageModalVisible(true);
                          }}
                          style={[
                            styles.transaction,
                            { borderBottomColor: colors.outlineVariant },
                            index === filteredData.messages.length - 1 && {
                              borderBottomWidth: 0,
                            },
                          ]}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={styles.transactionDetails}>
                              <Text
                                style={[
                                  styles.transactionTitle,
                                  { color: colors.onSurface },
                                ]}
                                numberOfLines={1}
                              >
                                {displayName}
                              </Text>
                              <Text
                                style={[
                                  styles.transactionSubtitle,
                                  { color: colors.onSurfaceVariant },
                                ]}
                                numberOfLines={2}
                              >
                                {message.message_content}
                              </Text>
                              <View
                                style={{
                                  flexDirection: 'row',
                                  flexWrap: 'wrap',
                                  alignItems: 'center',
                                  marginTop: 4,
                                }}
                              >
                                <Text
                                  style={{ fontSize: 10, color: colors.onSurfaceVariant }}
                                >
                                  {message.transaction_date
                                    ? new Date(
                                        message.transaction_date,
                                      ).toLocaleDateString()
                                    : 'N/A'}
                                </Text>
                                {metadata.ref && (
                                  <Text
                                    style={{
                                      fontSize: 10,
                                      color: colors.onSurfaceVariant,
                                    }}
                                  >
                                    {` • ${metadata.ref}`}
                                  </Text>
                                )}
                              </View>
                            </View>
                            <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                              {metadata.phone && (
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: colors.onSurfaceVariant,
                                    fontWeight: 'bold',
                                    marginBottom: 2,
                                  }}
                                >
                                  Phone: {metadata.phone}
                                </Text>
                              )}
                              <Text
                                style={[
                                  styles.transactionAmount,
                                  {
                                    color: isLinked
                                      ? colors.onSurfaceVariant
                                      : colors.primary,
                                  },
                                ]}
                              >
                                {defaultCurrency
                                  ? formatWithCurrency(
                                      parseFloat(displayAmount),
                                      defaultCurrency,
                                    )
                                  : displayAmount}
                              </Text>
                              <Text
                                style={{
                                  fontSize: 10,
                                  color: isLinked
                                    ? (colors as any).success
                                    : colors.onSurfaceVariant,
                                  fontWeight: isLinked ? 'bold' : 'normal',
                                }}
                              >
                                {isLinked ? 'Linked' : 'Pending Link'}
                              </Text>
                            </View>
                          </View>
                        </SPressable>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </View>
        )}
      </Card.Content>

      <PaymentMessageDetailsModal
        visible={messageModalVisible}
        onDismiss={() => {
          setMessageModalVisible(false);
          setSelectedMessage(null);
        }}
        onReceiptPress={receiptId => {
          setMessageModalVisible(false);
          setSelectedMessage(null);
          router.push(`/(tabs)/receipts/view/${receiptId}`);
        }}
        onCreateTenant={(name, phone) => {
          setMessageModalVisible(false);
          setSelectedMessage(null);
          router.push({
            pathname: '/(tabs)/tenants/create',
            params: { name, phone },
          });
        }}
        businessId={selectedBusiness?.id || ''}
        message={selectedMessage}
        paymentMessageReceipts={paymentMessageReceipts}
        receipts={receipts}
        tenants={tenants}
        houses={houses}
        contracts={contracts}
        properties={properties}
        onUnlink={handleUnlinkMessage}
      />
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 0,
    overflow: 'hidden',
  },
  transaction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  transactionDetails: {
    flex: 1,
  },
  transactionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  transactionSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default DailyFinanceCard;
