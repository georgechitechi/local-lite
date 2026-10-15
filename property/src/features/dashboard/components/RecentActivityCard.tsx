import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Card, Text } from 'react-native-paper';
import EmptyState from '@/shared/components/EmptyState';
import SectionGroup from '@/shared/components/SectionGroup';
import { formatDate, formatWithCurrency } from '@/shared/utils/formatters';
import { safeParseJSON } from '@/shared/utils/helper';
import DashboardCardHeader from './DashboardCardHeader';

interface RecentActivityCardProps {
  loading: boolean;
  receipts: any[];
  expenses: any[];
  collapsedGroups: Set<string>;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  isDark: boolean;
  colors: any;
  defaultCurrency: any;
  tenants: any[]; // To resolve tenant names from IDs in receipts
  tenantsById?: { get: (id: string) => any | undefined };
}

const RecentActivityCard: React.FC<RecentActivityCardProps> = ({
  loading,
  receipts,
  expenses,
  collapsedGroups,
  setCollapsedGroups,
  selectedDate,
  setSelectedDate,

  colors,
  defaultCurrency,
  tenants,
  tenantsById,
}) => {
  // Filter data for selected month
  const filteredData = React.useMemo(() => {
    const targetMonth = selectedDate.getMonth() + 1;
    const targetYear = selectedDate.getFullYear();

    const filteredReceipts = receipts
      .filter(r => {
        const p = safeParseJSON<{ month?: number; year?: number }>(
          r.payment_period as any,
          {},
        );
        return p.month === targetMonth && p.year === targetYear;
      })
      .sort(
        (a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime(),
      );

    const filteredExpenses = expenses
      .filter(e => {
        const d = new Date(e.date);
        return d.getMonth() + 1 === targetMonth && d.getFullYear() === targetYear;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return { receipts: filteredReceipts, expenses: filteredExpenses };
  }, [receipts, expenses, selectedDate]);

  const totalIncome = filteredData.receipts.reduce(
    (sum, r) => sum + (parseFloat(String(r.amount)) || 0),
    0,
  );
  const totalExpenses = filteredData.expenses.reduce(
    (sum, e) => sum + (parseFloat(String(e.amount)) || 0),
    0,
  );

  const getTenantName = (tenantId: string) => {
    if (tenantsById) {
      return tenantsById.get(tenantId)?.name || 'Unknown Tenant';
    }
    return tenants.find(t => t.id === tenantId)?.name || 'Unknown Tenant';
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
        title={`${selectedDate.toLocaleString('default', {
          month: 'long',
        })} ${selectedDate.getFullYear()}`}
        subtitle="Recent Activity (Income & Expenses)"
        onPrev={() => {
          const d = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1);
          setSelectedDate(d);
        }}
        onNext={() => {
          const d = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1);
          setSelectedDate(d);
        }}
        isPrevDisabled={(() => {
          const today = new Date();
          const minDate = new Date(today.getFullYear(), today.getMonth() - 3, 1);
          return (
            selectedDate.getFullYear() < minDate.getFullYear() ||
            (selectedDate.getFullYear() === minDate.getFullYear() &&
              selectedDate.getMonth() <= minDate.getMonth())
          );
        })()}
        isNextDisabled={(() => {
          const today = new Date();
          const maxDate = new Date(today.getFullYear(), today.getMonth() + 3, 1);
          return (
            selectedDate.getFullYear() > maxDate.getFullYear() ||
            (selectedDate.getFullYear() === maxDate.getFullYear() &&
              selectedDate.getMonth() >= maxDate.getMonth())
          );
        })()}
      />
      <Card.Content style={{ paddingHorizontal: 0, paddingBottom: 0 }}>
        {loading ? (
          <View style={{ padding: 20 }}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : filteredData.receipts.length === 0 && filteredData.expenses.length === 0 ? (
          <EmptyState
            title={`No Activity Recorded for ${selectedDate.toLocaleString('default', { month: 'long' })}`}
          />
        ) : (
          <View>
            {/* INCOME GROUP */}
            {filteredData.receipts.length > 0 && (
              <>
                <SectionGroup
                  title="INCOME"
                  subtitle={`${filteredData.receipts.length} Payments • ${
                    defaultCurrency
                      ? formatWithCurrency(totalIncome, defaultCurrency)
                      : totalIncome
                  }`}
                  isExpanded={!collapsedGroups.has('income')}
                  onToggle={() => {
                    setCollapsedGroups(prev => {
                      const next = new Set(prev);
                      if (next.has('income')) next.delete('income');
                      else next.add('income');
                      return next;
                    });
                  }}
                  backgroundColor={colors.surfaceVariant}
                  titleColor={(colors as any).success}
                />
                {!collapsedGroups.has('income') && (
                  <View style={{ paddingHorizontal: 16, gap: 12, paddingVertical: 12 }}>
                    {filteredData.receipts.map((receipt, index) => (
                      <View
                        key={`receipt-${receipt.id || index}`}
                        style={[
                          styles.transaction,
                          { borderBottomColor: colors.outlineVariant },
                        ]}
                      >
                        <View style={styles.transactionDetails}>
                          <Text
                            style={[styles.transactionTitle, { color: colors.onSurface }]}
                          >
                            {getTenantName(receipt.tenant_id)}
                          </Text>
                          <Text
                            style={[
                              styles.transactionSubtitle,
                              { color: colors.onSurfaceVariant },
                            ]}
                          >
                            {formatDate(receipt.payment_date)} • {receipt.payment_method}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text
                            style={[
                              styles.transactionAmount,
                              { color: (colors as any).success },
                            ]}
                          >
                            {defaultCurrency
                              ? formatWithCurrency(
                                  parseFloat(String(receipt.amount)),
                                  defaultCurrency,
                                )
                              : receipt.amount}
                          </Text>
                          <Text style={{ fontSize: 10, color: colors.onSurfaceVariant }}>
                            Received
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

            {/* EXPENSES GROUP */}
            {filteredData.expenses.length > 0 && (
              <>
                <SectionGroup
                  title="EXPENSES"
                  subtitle={`${filteredData.expenses.length} Records • ${
                    defaultCurrency
                      ? formatWithCurrency(totalExpenses, defaultCurrency)
                      : totalExpenses
                  }`}
                  isExpanded={!collapsedGroups.has('expenses')}
                  onToggle={() => {
                    setCollapsedGroups(prev => {
                      const next = new Set(prev);
                      if (next.has('expenses')) next.delete('expenses');
                      else next.add('expenses');
                      return next;
                    });
                  }}
                  backgroundColor={colors.surfaceVariant}
                  titleColor={colors.error}
                />
                {!collapsedGroups.has('expenses') && (
                  <View style={{ paddingHorizontal: 16, gap: 12, paddingVertical: 12 }}>
                    {filteredData.expenses.map((expense, index) => (
                      <View
                        key={`expense-${expense.id || index}`}
                        style={[
                          styles.transaction,
                          { borderBottomColor: colors.outlineVariant },
                        ]}
                      >
                        <View style={styles.transactionDetails}>
                          <Text
                            style={[styles.transactionTitle, { color: colors.onSurface }]}
                          >
                            {expense.category}
                          </Text>
                          <Text
                            style={[
                              styles.transactionSubtitle,
                              { color: colors.onSurfaceVariant },
                            ]}
                          >
                            {formatDate(expense.date)} • {expense.remarks || 'No remarks'}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text
                            style={[styles.transactionAmount, { color: colors.error }]}
                          >
                            {defaultCurrency
                              ? formatWithCurrency(
                                  parseFloat(String(expense.amount)),
                                  defaultCurrency,
                                )
                              : expense.amount}
                          </Text>
                          <Text style={{ fontSize: 10, color: colors.onSurfaceVariant }}>
                            Spent
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
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

export default RecentActivityCard;
