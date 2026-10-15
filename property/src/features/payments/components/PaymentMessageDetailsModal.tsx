import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Divider, Surface, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import { useCurrency } from '@/shared/hooks/useCurrency';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDate, formatPeriod } from '@/shared/utils/formatters';
import { addOpacity } from '@/shared/utils/helper';
import { extractMessageMetadata } from '@/shared/utils/parsers';
import type {
  Contract,
  House,
  PaymentMessage,
  PaymentMessageReceipt,
  Property,
  Receipt,
  Tenant,
} from '@/shared/types/types';

interface PaymentMessageDetailsModalProps {
  visible: boolean;
  onDismiss: () => void;
  message: PaymentMessage | null;
  businessId: string;
  paymentMessageReceipts: PaymentMessageReceipt[];
  receipts: Receipt[];
  tenants: Tenant[];
  houses: House[];
  contracts: Contract[];
  properties: Property[];
  onUnlink?: (message: PaymentMessage) => void;
  onReceiptPress?: (receiptId: string) => void;
  onCreateTenant?: (name: string, phone: string) => void;
}

export default function PaymentMessageDetailsModal({
  visible,
  onDismiss,
  message,
  businessId,
  paymentMessageReceipts,
  receipts,
  tenants,
  houses,
  contracts,
  properties,
  onUnlink,
  onReceiptPress,
  onCreateTenant,
}: PaymentMessageDetailsModalProps) {
  const colors = useThemeColors();
  const router = useRouter();
  const { defaultCurrency } = useCurrency(businessId);
  const [unlinkConfirmVisible, setUnlinkConfirmVisible] = React.useState(false);

  const extractedInfo = React.useMemo(() => {
    const parsed = extractMessageMetadata(message?.message_content || '');
    return {
      name: parsed.name || '',
      phone: parsed.phone || '',
    };
  }, [message]);

  const hasMatch = React.useMemo(() => {
    if (!message || (!extractedInfo.phone && !extractedInfo.name)) return false;

    // Normalize extracted phone for comparison (last 9 digits)
    const cleanedExtractedPhone = extractedInfo.phone.replace(/[^\d]/g, '').slice(-9);

    return tenants.some(t => {
      if (cleanedExtractedPhone && t.phone) {
        const cleanedTenantPhone = t.phone.replace(/[^\d]/g, '').slice(-9);
        if (cleanedTenantPhone === cleanedExtractedPhone) return true;
      }
      if (extractedInfo.name && t.name) {
        if (t.name.toLowerCase().trim() === extractedInfo.name.toLowerCase().trim())
          return true;
      }
      return false;
    });
  }, [message, extractedInfo, tenants]);

  const linkedReceipts = React.useMemo(() => {
    if (!message) return [];
    return paymentMessageReceipts
      .filter(pmr => pmr.payment_message_id === message.id)
      .map(pmr => {
        const receipt = receipts.find(r => r.id === pmr.receipt_id);
        if (!receipt) return null;

        const contract = contracts.find(c => c.id === receipt.contract_id);
        const tenant = tenants.find(t => t.id === contract?.tenant_id);
        const house = houses.find(h => h.id === contract?.house_id);
        const property = properties.find(p => p.id === house?.property_id);

        const displayStatus = receipt.is_refunded
          ? 'refunded'
          : (receipt.refunded_amount || 0) > 0
            ? 'partial_refund'
            : receipt.status;

        return {
          ...receipt,
          displayStatus,
          contract: {
            ...contract,
            tenant,
            house: {
              ...house,
              property,
            },
          },
        };
      })
      .filter(r => r !== null);
  }, [message, paymentMessageReceipts, receipts, contracts, tenants, houses, properties]);

  const getStatusColor = (msg: PaymentMessage): string => {
    const linkedCount = paymentMessageReceipts.filter(
      pmr => pmr.payment_message_id === msg.id,
    ).length;
    return linkedCount > 0 ? (colors as any).success : (colors as any).warning;
  };

  const getReceiptStatusColors = (status: string) => {
    const s = status?.toLowerCase() || 'paid';
    switch (s) {
      case 'paid':
        return {
          bg: colors.successContainer,
          text: colors.onSuccessContainer,
        };
      case 'partial':
      case 'partial_refund':
        return {
          bg: colors.warningContainer,
          text: colors.onWarningContainer,
        };
      case 'refunded':
        return {
          bg: (colors as any).errorContainer || addOpacity(colors.error, 0.12),
          text: (colors as any).onErrorContainer || colors.error,
        };
      default:
        return {
          bg: colors.surfaceVariant,
          text: colors.onSurfaceVariant,
        };
    }
  };

  const handleDismiss = () => {
    onDismiss();
  };

  const handleUnlinkPress = () => {
    setUnlinkConfirmVisible(true);
  };

  const confirmUnlink = () => {
    if (onUnlink && message) {
      onUnlink(message);
    }
    setUnlinkConfirmVisible(false);
  };

  return (
    <>
      <BaseModal
        visible={visible}
        onDismiss={handleDismiss}
        scrollable={true}
        edgeToEdge={true}
        title="Message Details"
        subtitle="Manage payments and receipts"
      >
        {message && (
          <View style={styles.container}>
            <Surface
              style={[styles.header, { backgroundColor: colors.surfaceVariant }]}
              elevation={0}
            >
              <Text
                variant="bodyMedium"
                style={{ color: colors.onSurface, lineHeight: 22, fontStyle: 'italic' }}
              >
                {message.message_content}
              </Text>
            </Surface>

            <View style={styles.infoRow}>
              <View style={{ flex: 1 }}>
                <Text
                  variant="labelSmall"
                  style={{ color: colors.onSurfaceVariant, marginBottom: 4 }}
                >
                  TRANSACTION DATE
                </Text>
                <View style={styles.valueRow}>
                  <MaterialCommunityIcons
                    name="calendar-clock"
                    size={18}
                    color={colors.primary}
                    style={{ marginRight: 8 }}
                  />
                  <Text variant="bodyLarge" style={{ fontWeight: '600' }}>
                    {formatDate(message.transaction_date || '')}
                  </Text>
                </View>
              </View>

              <View style={{ alignItems: 'flex-end' }}>
                <Text
                  variant="labelSmall"
                  style={{ color: colors.onSurfaceVariant, marginBottom: 4 }}
                >
                  STATUS
                </Text>
                <View
                  style={{
                    backgroundColor: addOpacity(getStatusColor(message), 0.12),
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 6,
                  }}
                >
                  <Text
                    style={{
                      color: getStatusColor(message),
                      fontWeight: 'bold',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    {linkedReceipts.length > 0 ? 'Linked' : 'Unlinked'}
                  </Text>
                </View>
              </View>
            </View>

            <Divider style={styles.divider} />

            {linkedReceipts.length > 0 ? (
              <View>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                    Linked Receipts ({linkedReceipts.length})
                  </Text>
                  {onUnlink && (
                    <Button
                      mode="text"
                      onPress={handleUnlinkPress}
                      textColor={colors.error}
                      icon="link-off"
                      compact
                      labelStyle={{ fontSize: 13, fontWeight: '700' }}
                    >
                      Unlink All
                    </Button>
                  )}
                </View>

                {linkedReceipts.map((receipt: any) => {
                  const statusColors = getReceiptStatusColors(receipt.displayStatus);
                  return (
                    <Card
                      key={receipt.id}
                      style={styles.receiptCard}
                      mode="contained"
                      onPress={() => {
                        if (onReceiptPress) {
                          onReceiptPress(receipt.id);
                        } else {
                          onDismiss();
                          router.push(`/(tabs)/receipts/view/${receipt.id}`);
                        }
                      }}
                    >
                      <Card.Content style={styles.cardContent}>
                        <View style={styles.receiptMainRow}>
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <Text
                              variant="titleSmall"
                              style={{ fontWeight: 'bold' }}
                              numberOfLines={1}
                            >
                              {receipt.contract?.tenant?.name || 'Unknown Tenant'}
                            </Text>
                            <Text
                              variant="bodySmall"
                              style={{ color: colors.onSurfaceVariant, marginTop: 1 }}
                              numberOfLines={1}
                            >
                              {receipt.contract?.house?.property?.name ||
                                'Unknown Property'}{' '}
                              • H{receipt.contract?.house?.house_number || 'N/A'}
                            </Text>
                          </View>
                          <Text
                            variant="titleMedium"
                            style={{ color: colors.primary, fontWeight: '900' }}
                          >
                            {receipt.amount?.toLocaleString()} {defaultCurrency?.symbol}
                          </Text>
                        </View>

                        <View style={styles.receiptMetaRow}>
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              flex: 1,
                            }}
                          >
                            <Text
                              variant="bodySmall"
                              style={{ color: colors.onSurfaceVariant, fontSize: 11 }}
                            >
                              {formatPeriod(receipt.payment_period)}
                            </Text>
                            <Text style={{ color: colors.outline, marginHorizontal: 4 }}>
                              •
                            </Text>
                            <Text
                              variant="bodySmall"
                              style={{ color: colors.onSurfaceVariant, fontSize: 11 }}
                            >
                              {formatDate(receipt.payment_date || '')}
                            </Text>
                          </View>

                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View
                              style={{
                                backgroundColor: statusColors.bg,
                                paddingHorizontal: 6,
                                paddingVertical: 1,
                                borderRadius: 4,
                                marginRight: 6,
                              }}
                            >
                              <Text
                                style={{
                                  color: statusColors.text,
                                  fontSize: 9,
                                  fontWeight: 'bold',
                                  textTransform: 'uppercase',
                                }}
                              >
                                {receipt.displayStatus || 'Paid'}
                              </Text>
                            </View>
                            <MaterialCommunityIcons
                              name="chevron-right"
                              size={18}
                              color={colors.outline}
                            />
                          </View>
                        </View>
                      </Card.Content>
                    </Card>
                  );
                })}
              </View>
            ) : (
              <EmptyState
                icon="link-off"
                title="No receipts linked to this message"
                actionLabel={!hasMatch ? 'Create Tenant Profile' : undefined}
                onAction={
                  !hasMatch
                    ? () => {
                        onDismiss();
                        if (onCreateTenant) {
                          onCreateTenant(extractedInfo.name, extractedInfo.phone);
                        } else {
                          router.push({
                            pathname: '/(tabs)/tenants/create',
                            params: {
                              name: extractedInfo.name,
                              phone: extractedInfo.phone,
                            },
                          });
                        }
                      }
                    : undefined
                }
              />
            )}
          </View>
        )}
      </BaseModal>

      <BaseModal
        visible={unlinkConfirmVisible}
        onDismiss={() => setUnlinkConfirmVisible(false)}
        mode="confirm"
        title="Unlink Receipts"
        message="Are you sure you want to unlink all receipts from this message? This action cannot be undone."
        confirmText="Unlink All"
        destructive
        icon="link-off"
        onConfirm={confirmUnlink}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingTop: 8,
  },
  header: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    marginVertical: 12,
  },
  receiptCard: {
    marginBottom: 8,
    borderRadius: 12,
  },
  cardContent: {
    padding: 10,
  },
  receiptMainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  receiptMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
});
