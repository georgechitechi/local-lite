import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { Card, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import AccessGuard from '@/shared/components/AccessGuard';
import BaseSearch from '@/shared/components/BaseSearch';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import SectionGroup from '@/shared/components/SectionGroup';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useTransactions } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDateTime } from '@/shared/utils/formatters';
import { properCase, toLowerCase } from '@/shared/utils/helper';
import type { Transaction } from '@/stores/types';

const getTransactionDate = (transaction: Transaction): Date => {
  const raw = (transaction as any).raw_payload as any;
  if (raw?.Body?.stkCallback?.CallbackMetadata?.Item) {
    const items = raw.Body.stkCallback.CallbackMetadata.Item;
    const dateItem = items.find((item: any) => item.Name === 'TransactionDate');
    if (dateItem?.Value) {
      const dateStr = String(dateItem.Value);
      if (dateStr.length === 14) {
        const year = parseInt(dateStr.slice(0, 4), 10);
        const month = parseInt(dateStr.slice(4, 6), 10) - 1;
        const day = parseInt(dateStr.slice(6, 8), 10);
        const hour = parseInt(dateStr.slice(8, 10), 10);
        const minute = parseInt(dateStr.slice(10, 12), 10);
        const second = parseInt(dateStr.slice(12, 14), 10);
        return new Date(year, month, day, hour, minute, second);
      }
    }
  }
  return transaction.created_at ? new Date(transaction.created_at) : new Date();
};

export default function TransactionsScreen() {
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const { hasAccess, tenantId } = useAccessControl();

  const transactions = useTransactions(selectedBusiness?.id);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('all');

  const scopedTransactions = useMemo(() => {
    const tenantTransactions =
      hasAccess(['tenant']) && tenantId
        ? transactions.filter(t => t.tenant_id === tenantId)
        : transactions;

    return tenantTransactions.filter(transaction => {
      const raw = transaction.raw_payload as any;

      const payerName = raw?.name ?? '';

      const query = toLowerCase(searchQuery);

      const matchesSearch =
        query === '' ||
        toLowerCase(transaction.phone_number ?? '').includes(query) ||
        toLowerCase(transaction.provider ?? '').includes(query) ||
        toLowerCase(transaction.provider_reference ?? '').includes(query) ||
        toLowerCase(transaction.currency ?? '').includes(query) ||
        toLowerCase(String(transaction.amount ?? '')).includes(query) ||
        toLowerCase(payerName).includes(query);

      let matchesFilter = true;

      switch (selectedFilter) {
        case 'success':
          matchesFilter = transaction.is_success;
          break;

        case 'failed':
          matchesFilter = !transaction.is_success;
          break;

        default:
          matchesFilter = true;
      }

      return matchesSearch && matchesFilter;
    });
  }, [transactions, tenantId, hasAccess, searchQuery, selectedFilter]);

  const sections = useMemo(() => {
    const sorted = [...scopedTransactions].sort((a, b) => {
      return getTransactionDate(b).getTime() - getTransactionDate(a).getTime();
    });

    const grouped = sorted.reduce(
      (acc, transaction) => {
        const date = getTransactionDate(transaction);

        const title = date.toLocaleString('default', {
          month: 'long',
          year: 'numeric',
        });

        if (!acc[title]) {
          acc[title] = [];
        }

        acc[title].push(transaction);

        return acc;
      },
      {} as Record<string, Transaction[]>,
    );

    return Object.entries(grouped).map(([title, data]) => ({
      title,
      count: data.length,
      data,
    }));
  }, [scopedTransactions]);

  const [expandedPeriods, setExpandedPeriods] = useState<Set<string>>(new Set());

  const hasAutoExpanded = useRef(false);

  useEffect(() => {
    if (sections.length > 0 && !hasAutoExpanded.current) {
      setExpandedPeriods(new Set([sections[0].title]));
      hasAutoExpanded.current = true;
    }
  }, [sections]);

  const togglePeriod = (period: string) => {
    setExpandedPeriods(prev => {
      const next = new Set(prev);

      if (next.has(period)) {
        next.delete(period);
      } else {
        next.add(period);
      }

      return next;
    });
  };

  const renderHeader = ({ section }: any) => (
    <SectionGroup
      title={section.title}
      subtitle={`${section.count} ${
        section.count === 1 ? 'Transaction' : 'Transactions'
      }`}
      isExpanded={expandedPeriods.has(section.title)}
      onToggle={() => togglePeriod(section.title)}
    />
  );

  return (
    <AccessGuard action="view" resource="transaction">
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
          },
        ]}
      >
        <BaseSearch
          placeholder="Search transactions"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onClear={() => setSearchQuery('')}
          leftIcon="magnify"
          rightIcon="close-circle"
        />

        <View style={styles.filterContainer}>
          <FilterButtons
            selectedValue={selectedFilter}
            onValueChange={value => setSelectedFilter((value || 'all') as string)}
            options={[
              {
                label: 'All',
                value: 'all',
                icon: 'layers-outline',
              },
              {
                label: 'Success',
                value: 'success',
                icon: 'check-circle',
              },
              {
                label: 'Failed',
                value: 'failed',
                icon: 'close-circle',
              },
            ]}
          />
        </View>

        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          renderSectionHeader={renderHeader}
          stickySectionHeadersEnabled
          extraData={{ expandedPeriods, transactions }}
          renderItem={({ item, section }) => {
            if (!expandedPeriods.has(section.title)) {
              return null;
            }

            return (
              <Card style={styles.card}>
                <Card.Title
                  title={`${item.currency || 'KES'} ${item.amount?.toLocaleString() || '0'}`}
                  titleStyle={[
                    styles.cardTitle,
                    {
                      fontSize: 14,
                    },
                  ]}
                  subtitle={item.phone_number || item.provider}
                  style={{
                    minHeight: 48,
                    paddingTop: 8,
                    paddingBottom: 0,
                  }}
                  right={() => (
                    <View
                      style={{
                        alignItems: 'flex-end',
                        justifyContent: 'center',
                        marginRight: 16,
                        gap: 4,
                      }}
                    >
                      {!!item.provider_reference && (
                        <Text
                          variant="bodySmall"
                          style={{
                            color: colors.onSurfaceVariant,
                          }}
                        >
                          {item.provider_reference}
                        </Text>
                      )}

                      <MaterialCommunityIcons
                        name={item.is_success ? 'check-circle' : 'close-circle'}
                        size={16}
                        color={item.is_success ? colors.success : colors.error}
                      />
                    </View>
                  )}
                />

                <Card.Content
                  style={{
                    paddingVertical: 8,
                  }}
                >
                  <View
                    style={[
                      styles.row,
                      {
                        marginTop: 0,
                        alignItems: 'flex-start',
                      },
                    ]}
                  >
                    <View
                      style={{
                        flex: 1,
                        marginRight: 16,
                      }}
                    >
                      {(() => {
                        const raw = item.raw_payload as any;

                        if (!raw) return null;

                        return (
                          <>
                            {!!raw.name && (
                              <Text
                                variant="bodySmall"
                                style={{
                                  color: colors.onSurface,
                                  fontWeight: '500',
                                }}
                              >
                                {properCase(raw.name)}
                              </Text>
                            )}
                          </>
                        );
                      })()}
                    </View>

                    <Text
                      variant="bodySmall"
                      style={{
                        color: colors.onSurfaceVariant,
                      }}
                    >
                      {formatDateTime(getTransactionDate(item).toISOString())}
                    </Text>
                  </View>
                </Card.Content>
              </Card>
            );
          }}
          contentContainerStyle={{
            paddingBottom: 24,
          }}
          ListEmptyComponent={
            <EmptyState icon="cash-remove" title="No transactions found" />
          }
        />
      </View>
    </AccessGuard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  filterContainer: {
    paddingHorizontal: 2,
  },

  card: {
    margin: 8,
    borderRadius: 8,
    elevation: 1,
    overflow: 'hidden',
  },

  cardTitle: {
    fontWeight: '600',
  },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
