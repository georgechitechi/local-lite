import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Card, Text } from 'react-native-paper';
import EmptyState from '@/shared/components/EmptyState';
import SectionGroup from '@/shared/components/SectionGroup';
import {
  formatDisplayDate,
  formatMonthYear,
  formatWithCurrency,
} from '@/shared/utils/formatters';
import DashboardCardHeader from './DashboardCardHeader';

export interface WaiverTenant {
  contract_id: string;
  tenant_name: string;
  property_name: string;
  house_number: string;
  original_rent: number;
  effective_rent: number;
  amount_waived: number;
  days_on_break: number;
  is_full_waiver: boolean;
  end_date?: string | null;
}

interface WaiversCardProps {
  loading: boolean;
  tenants: WaiverTenant[];
  collapsedGroups: Set<string>;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedMonthDate: Date;
  setSelectedMonthDate: (date: Date) => void;
  isDark: boolean;
  colors: any;
  defaultCurrency: any;
}

const WaiversCard: React.FC<WaiversCardProps> = ({
  loading,
  tenants,
  collapsedGroups,
  setCollapsedGroups,
  selectedMonthDate,
  setSelectedMonthDate,
  colors,
  defaultCurrency,
}) => {
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
        subtitle="Holiday Waivers Applied"
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
          <ActivityIndicator style={{ padding: 20 }} color={colors.primary} />
        ) : tenants.length === 0 ? (
          <EmptyState
            title={`No Waivers Applied for ${formatMonthYear(selectedMonthDate)}`}
          />
        ) : (
          <View>
            {/* Full Waivers Group */}
            {tenants.some(t => t.is_full_waiver) && (
              <>
                <SectionGroup
                  title="FULL WAIVERS"
                  subtitle={`${tenants.filter(t => t.is_full_waiver).length} Tenants • ${
                    defaultCurrency
                      ? formatWithCurrency(
                          tenants
                            .filter(t => t.is_full_waiver)
                            .reduce((sum, t) => sum + t.amount_waived, 0),
                          defaultCurrency as any,
                        )
                      : ''
                  }`}
                  isExpanded={!collapsedGroups.has('full')}
                  onToggle={() => {
                    setCollapsedGroups(prev => {
                      const next = new Set(prev);
                      if (next.has('full')) next.delete('full');
                      else next.add('full');
                      return next;
                    });
                  }}
                  backgroundColor={colors.surfaceVariant}
                  titleColor={colors.primary}
                />
                {!collapsedGroups.has('full') && (
                  <View style={{ paddingHorizontal: 16, gap: 12, paddingVertical: 12 }}>
                    {tenants
                      .filter(t => t.is_full_waiver)
                      .sort((a, b) => a.tenant_name.localeCompare(b.tenant_name))
                      .map((tenant, index) => (
                        <View
                          key={`full-${tenant.contract_id || index}`}
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
                              style={[
                                styles.transactionAmount,
                                { color: colors.primary },
                              ]}
                            >
                              {defaultCurrency
                                ? formatWithCurrency(
                                    tenant.amount_waived,
                                    defaultCurrency as any,
                                  )
                                : '...'}
                            </Text>
                            <Text
                              style={{ fontSize: 10, color: colors.onSurfaceVariant }}
                            >
                              {tenant.end_date
                                ? `Waived until ${formatDisplayDate(tenant.end_date)}`
                                : 'Waived'}
                            </Text>
                          </View>
                        </View>
                      ))}
                  </View>
                )}
              </>
            )}

            {/* Partial Waivers Group */}
            {tenants.some(t => !t.is_full_waiver) && (
              <>
                <SectionGroup
                  title="PARTIAL WAIVERS"
                  subtitle={`${tenants.filter(t => !t.is_full_waiver).length} Tenants • ${
                    defaultCurrency
                      ? formatWithCurrency(
                          tenants
                            .filter(t => !t.is_full_waiver)
                            .reduce((sum, t) => sum + t.amount_waived, 0),
                          defaultCurrency as any,
                        )
                      : ''
                  }`}
                  isExpanded={!collapsedGroups.has('partial_waiver')}
                  onToggle={() => {
                    setCollapsedGroups(prev => {
                      const next = new Set(prev);
                      if (next.has('partial_waiver')) next.delete('partial_waiver');
                      else next.add('partial_waiver');
                      return next;
                    });
                  }}
                  backgroundColor={colors.surfaceVariant}
                  titleColor={colors.secondary}
                />
                {!collapsedGroups.has('partial_waiver') && (
                  <View style={{ paddingHorizontal: 16, gap: 12, paddingVertical: 12 }}>
                    {tenants
                      .filter(t => !t.is_full_waiver)
                      .sort((a, b) => a.tenant_name.localeCompare(b.tenant_name))
                      .map((tenant, index) => (
                        <View
                          key={`partial-${tenant.contract_id || index}`}
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
                              {tenant.days_on_break} days on break
                            </Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text
                              style={[
                                styles.transactionAmount,
                                { color: colors.secondary },
                              ]}
                            >
                              {defaultCurrency
                                ? formatWithCurrency(
                                    tenant.amount_waived,
                                    defaultCurrency as any,
                                  )
                                : '...'}
                            </Text>
                            <Text
                              style={{ fontSize: 10, color: colors.onSurfaceVariant }}
                            >
                              {tenant.end_date
                                ? `Waived until ${formatDisplayDate(tenant.end_date)}`
                                : 'Waived'}
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

export default WaiversCard;
