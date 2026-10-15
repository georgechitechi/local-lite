import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Card, Text } from 'react-native-paper';
import EmptyState from '@/shared/components/EmptyState';
import SectionGroup from '@/shared/components/SectionGroup';
import SPressable from '@/shared/components/SlightPressable';
import { formatMonthYear, formatWithCurrency } from '@/shared/utils/formatters';
import { safeParseJSON } from '@/shared/utils/helper';
import DashboardCardHeader from './DashboardCardHeader';

interface PendingRentTenant {
  contract_id: string;
  tenant_name: string;
  property_name: string;
  house_number: string;
  amount_pending: number | string;
  amount_paid: number | string;
  payment_status: 'unpaid' | 'partial' | 'paid';
}

interface PendingRentCardProps {
  loading: boolean;
  tenants: PendingRentTenant[];
  receipts: any[];
  collapsedGroups: Set<string>;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedMonthDate: Date;
  setSelectedMonthDate: (date: Date) => void;
  colors: any;
  defaultCurrency: any;
}

const PendingRentCard: React.FC<PendingRentCardProps> = ({
  loading,
  tenants,
  receipts,
  collapsedGroups,
  setCollapsedGroups,
  selectedMonthDate,
  setSelectedMonthDate,
  colors,
  defaultCurrency,
}) => {
  const router = useRouter();

  // Pre-compute the most recent receipt ID for each contract in the selected month
  const recentReceiptsMap = React.useMemo(() => {
    const targetMonth = selectedMonthDate.getMonth() + 1;
    const targetYear = selectedMonthDate.getFullYear();

    const map = new Map<string, string>();
    const latestDateMap = new Map<string, number>();

    for (const r of receipts) {
      const p = safeParseJSON<{ month?: number; year?: number }>(
        r.payment_period as any,
        {},
      );
      if (p.month === targetMonth && p.year === targetYear && r.contract_id) {
        const time = new Date(r.payment_date).getTime();
        const existingTime = latestDateMap.get(r.contract_id) || 0;
        if (time > existingTime) {
          latestDateMap.set(r.contract_id, time);
          map.set(r.contract_id, r.id);
        }
      }
    }
    return map;
  }, [receipts, selectedMonthDate]);

  const findReceiptId = (contractId: string): string | null => {
    return recentReceiptsMap.get(contractId) ?? null;
  };

  return (
    <Card
      mode="elevated"
      style={[
        styles.recentActivity,
        {
          backgroundColor: colors.surface,
        },
      ]}
    >
      <DashboardCardHeader
        title={formatMonthYear(selectedMonthDate)}
        subtitle="Pending Rent (Fully Unpaid and Partial Payments)"
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
            selectedMonthDate.getFullYear() === minDate.getFullYear() &&
            selectedMonthDate.getMonth() === minDate.getMonth()
          );
        })()}
        isNextDisabled={(() => {
          const today = new Date();
          const maxDate = new Date(today.getFullYear(), today.getMonth() + 3, 1);
          return (
            selectedMonthDate.getFullYear() === maxDate.getFullYear() &&
            selectedMonthDate.getMonth() === maxDate.getMonth()
          );
        })()}
      />
      <Card.Content style={{ paddingHorizontal: 0, paddingBottom: 0 }}>
        {loading ? (
          <View style={{ padding: 20 }}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : tenants.some(
            t => t.payment_status === 'unpaid' || t.payment_status === 'partial',
          ) ? (
          <View>
            {/* Unpaid Group */}
            {tenants.some(t => t.payment_status === 'unpaid') && (
              <>
                <SectionGroup
                  title="UNPAID"
                  subtitle={`${tenants.filter(t => t.payment_status === 'unpaid').length} Tenants • ${
                    defaultCurrency
                      ? formatWithCurrency(
                          tenants
                            .filter(t => t.payment_status === 'unpaid')
                            .reduce(
                              (sum, t) =>
                                sum +
                                (typeof t.amount_pending === 'string'
                                  ? parseFloat(t.amount_pending)
                                  : t.amount_pending),
                              0,
                            ),
                          defaultCurrency as any,
                        )
                      : ''
                  }`}
                  isExpanded={!collapsedGroups.has('unpaid')}
                  onToggle={() => {
                    setCollapsedGroups(prev => {
                      const next = new Set(prev);
                      if (next.has('unpaid')) next.delete('unpaid');
                      else next.add('unpaid');
                      return next;
                    });
                  }}
                  backgroundColor={colors.surfaceVariant}
                  titleColor={colors.error}
                />
                {!collapsedGroups.has('unpaid') && (
                  <View style={{ paddingHorizontal: 16, gap: 12, paddingVertical: 12 }}>
                    {tenants
                      .filter(t => t.payment_status === 'unpaid')
                      .sort((a, b) => a.tenant_name.localeCompare(b.tenant_name))
                      .map((tenant, index) => (
                        <View
                          key={`unpaid-${tenant.contract_id || index}`}
                          style={[
                            styles.transaction,
                            { borderBottomColor: colors.outlineVariant },
                          ]}
                        >
                          <View style={styles.transactionDetails}>
                            <Text
                              style={[
                                styles.transactionTitle,
                                { color: colors.onSurface },
                              ]}
                            >
                              {tenant.tenant_name}
                            </Text>
                            <Text
                              style={[
                                styles.transactionSubtitle,
                                { color: colors.onSurfaceVariant },
                              ]}
                            >
                              {tenant.property_name} • House {tenant.house_number}
                            </Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text
                              style={[styles.transactionAmount, { color: colors.error }]}
                            >
                              {defaultCurrency
                                ? formatWithCurrency(
                                    typeof tenant.amount_pending === 'string'
                                      ? parseFloat(tenant.amount_pending)
                                      : tenant.amount_pending,
                                    defaultCurrency as any,
                                  )
                                : '...'}
                            </Text>
                            <Text
                              style={{ fontSize: 10, color: colors.onSurfaceVariant }}
                            >
                              Pending
                            </Text>
                          </View>
                        </View>
                      ))}
                  </View>
                )}
              </>
            )}

            {/* Partial Group */}
            {tenants.some(t => t.payment_status === 'partial') && (
              <>
                <SectionGroup
                  title="PARTIAL"
                  subtitle={`${tenants.filter(t => t.payment_status === 'partial').length} Tenants • ${
                    defaultCurrency
                      ? formatWithCurrency(
                          tenants
                            .filter(t => t.payment_status === 'partial')
                            .reduce(
                              (sum, t) =>
                                sum +
                                (typeof t.amount_pending === 'string'
                                  ? parseFloat(t.amount_pending)
                                  : t.amount_pending),
                              0,
                            ),
                          defaultCurrency as any,
                        )
                      : ''
                  }`}
                  isExpanded={!collapsedGroups.has('partial')}
                  onToggle={() => {
                    setCollapsedGroups(prev => {
                      const next = new Set(prev);
                      if (next.has('partial')) next.delete('partial');
                      else next.add('partial');
                      return next;
                    });
                  }}
                  backgroundColor={colors.surfaceVariant}
                  titleColor={colors.warning}
                />
                {!collapsedGroups.has('partial') && (
                  <View style={{ paddingHorizontal: 16, gap: 12, paddingVertical: 12 }}>
                    {tenants
                      .filter(t => t.payment_status === 'partial')
                      .sort((a, b) => a.tenant_name.localeCompare(b.tenant_name))
                      .map((tenant, index) => {
                        const receiptId = findReceiptId(tenant.contract_id);
                        return (
                          <SPressable
                            key={`partial-${tenant.contract_id || index}`}
                            onPress={() => {
                              if (receiptId) router.push(`/receipts/view/${receiptId}`);
                            }}
                            disabled={!receiptId}
                          >
                            <View
                              style={[
                                styles.transaction,
                                { borderBottomColor: colors.outlineVariant },
                              ]}
                            >
                              <View style={styles.transactionDetails}>
                                <Text
                                  style={[
                                    styles.transactionTitle,
                                    { color: colors.onSurface },
                                  ]}
                                >
                                  {tenant.tenant_name}
                                </Text>
                                <Text
                                  style={[
                                    styles.transactionSubtitle,
                                    { color: colors.onSurfaceVariant },
                                  ]}
                                >
                                  {tenant.property_name} • House {tenant.house_number}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: colors.onSurfaceVariant,
                                    marginTop: 4,
                                  }}
                                >
                                  Paid:{' '}
                                  {defaultCurrency
                                    ? formatWithCurrency(
                                        parseFloat(tenant.amount_paid as string),
                                        defaultCurrency as any,
                                      )
                                    : tenant.amount_paid}
                                </Text>
                              </View>
                              <View
                                style={{ flexDirection: 'row', alignItems: 'center' }}
                              >
                                <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                                  <Text
                                    style={[
                                      styles.transactionAmount,
                                      { color: colors.warning },
                                    ]}
                                  >
                                    {defaultCurrency
                                      ? formatWithCurrency(
                                          typeof tenant.amount_pending === 'string'
                                            ? parseFloat(tenant.amount_pending)
                                            : tenant.amount_pending,
                                          defaultCurrency as any,
                                        )
                                      : '...'}
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: 10,
                                      color: colors.onSurfaceVariant,
                                    }}
                                  >
                                    Remaining
                                  </Text>
                                </View>
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
        ) : (
          <EmptyState
            title={`No Pending Rent for ${formatMonthYear(selectedMonthDate)}`}
          />
        )}
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  recentActivity: {
    padding: 0,
    overflow: 'hidden',
    borderRadius: 0,
  },
  transaction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  transactionDetails: {
    flex: 1,
  },
  transactionTitle: {
    fontSize: 16,
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

export default PendingRentCard;
