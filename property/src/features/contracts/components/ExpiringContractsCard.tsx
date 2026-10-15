import { useRouter } from 'expo-router';
import type React from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Card, Text } from 'react-native-paper';
import DashboardCardHeader from '@/features/dashboard/components/DashboardCardHeader';
import EmptyState from '@/shared/components/EmptyState';
import SectionGroup from '@/shared/components/SectionGroup';
import SPressable from '@/shared/components/SlightPressable';

export interface ExpiringContract {
  id: string;
  tenant_name: string;
  property_name: string;
  house_number: string;
  end_date: string;
  days_remaining: number;
}

interface ExpiringContractsCardProps {
  loading: boolean;
  contracts: ExpiringContract[];
  isDark: boolean;
  colors: any;
}

const ExpiringContractsCard: React.FC<ExpiringContractsCardProps> = ({
  loading,
  contracts,
  colors,
}) => {
  const router = useRouter();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['critical', 'soon']),
  );

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  // Group by days remaining
  const critical = contracts.filter(c => c.days_remaining <= 7);
  const soon = contracts.filter(c => c.days_remaining > 7);

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
        title="Expiring Contracts"
        subtitle="Leases ending in the next 30 days"
        rightIcon="calendar-refresh"
        onRightIconPress={() =>
          router.push({
            pathname: '/contracts',
            params: { renewals: 'true' },
          })
        }
      />
      <Card.Content style={{ paddingHorizontal: 0, paddingBottom: 0 }}>
        {loading ? (
          <View style={{ padding: 20 }}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : contracts.length > 0 ? (
          <View>
            {/* Critical (Next 7 Days) */}
            {critical.length > 0 && (
              <>
                <SectionGroup
                  title="EXPIRING WITHIN 7 DAYS"
                  subtitle={`${critical.length} Contracts`}
                  isExpanded={expandedGroups.has('critical')}
                  onToggle={() => toggleGroup('critical')}
                  backgroundColor={colors.surfaceVariant}
                  titleColor={colors.error}
                />
                {expandedGroups.has('critical') && (
                  <View style={{ paddingHorizontal: 16, gap: 12, paddingVertical: 12 }}>
                    {critical
                      .sort((a, b) => a.days_remaining - b.days_remaining)
                      .map((contract, index) => (
                        <SPressable
                          key={`crit-${contract.id || index}`}
                          onPress={() =>
                            router.push({
                              pathname: '/contracts',
                              params: { renewals: 'true' },
                            })
                          }
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
                                {contract.tenant_name}
                              </Text>
                              <Text
                                style={[
                                  styles.transactionSubtitle,
                                  { color: colors.onSurfaceVariant },
                                ]}
                              >
                                {contract.property_name} • House {contract.house_number}
                              </Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text
                                style={[
                                  styles.transactionAmount,
                                  { color: colors.error },
                                ]}
                              >
                                {contract.days_remaining} days
                              </Text>
                              <Text
                                style={{ fontSize: 10, color: colors.onSurfaceVariant }}
                              >
                                Left
                              </Text>
                            </View>
                          </View>
                        </SPressable>
                      ))}
                  </View>
                )}
              </>
            )}

            {/* Expiring Soon */}
            {soon.length > 0 && (
              <>
                <SectionGroup
                  title="EXPIRING SOON"
                  subtitle={`${soon.length} Contracts`}
                  isExpanded={expandedGroups.has('soon')}
                  onToggle={() => toggleGroup('soon')}
                  backgroundColor={colors.surfaceVariant}
                  titleColor={colors.warning}
                />
                {expandedGroups.has('soon') && (
                  <View style={{ paddingHorizontal: 16, gap: 12, paddingVertical: 12 }}>
                    {soon
                      .sort((a, b) => a.days_remaining - b.days_remaining)
                      .map((contract, index) => (
                        <SPressable
                          key={`soon-${contract.id || index}`}
                          onPress={() =>
                            router.push({
                              pathname: '/contracts',
                              params: { renewals: 'true' },
                            })
                          }
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
                                {contract.tenant_name}
                              </Text>
                              <Text
                                style={[
                                  styles.transactionSubtitle,
                                  { color: colors.onSurfaceVariant },
                                ]}
                              >
                                {contract.property_name} • House {contract.house_number}
                              </Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text
                                style={[
                                  styles.transactionAmount,
                                  { color: colors.warning },
                                ]}
                              >
                                {contract.days_remaining} days
                              </Text>
                              <Text
                                style={{ fontSize: 10, color: colors.onSurfaceVariant }}
                              >
                                Left
                              </Text>
                            </View>
                          </View>
                        </SPressable>
                      ))}
                  </View>
                )}
              </>
            )}
          </View>
        ) : (
          <EmptyState title="No Expiring Contracts in the next 30 days" />
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

export default ExpiringContractsCard;
