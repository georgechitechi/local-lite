import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { formatWithCurrency } from '@/shared/utils/formatters';

interface ExpenseMetricsProps {
  colors: any;
  defaultCurrency: any;
  totalSpent: number;
  changePercentage: number;
  utilitiesTotal: number;
  utilitiesPercentage: number;
}

const ExpenseMetrics: React.FC<ExpenseMetricsProps> = ({
  colors,
  defaultCurrency,
  totalSpent,
  changePercentage,
  utilitiesTotal,
  utilitiesPercentage,
}) => {
  return (
    <View style={styles.metricsRow}>
      <View style={styles.metricItem}>
        <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
          Total Expenses
        </Text>
        <Text
          variant="headlineSmall"
          style={[styles.metricValue, { color: colors.onSurface }]}
        >
          {defaultCurrency ? formatWithCurrency(totalSpent, defaultCurrency) : totalSpent}
        </Text>
        <View style={styles.trendRow}>
          {changePercentage !== 0 ? (
            <>
              <MaterialCommunityIcons
                name={changePercentage > 0 ? 'arrow-up-bold' : 'arrow-down-bold'}
                size={14}
                color={changePercentage > 0 ? colors.error : colors.success}
              />
              <Text
                variant="labelSmall"
                style={{
                  color: changePercentage > 0 ? colors.error : colors.success,
                  fontWeight: '600',
                  marginLeft: 2,
                }}
              >
                {Math.abs(changePercentage).toFixed(1)}% vs last month
              </Text>
            </>
          ) : (
            <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
              No change vs last month
            </Text>
          )}
        </View>
      </View>

      <View
        style={[
          styles.metricItem,
          styles.metricDivider,
          { borderColor: colors.outlineVariant },
        ]}
      >
        <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
          Utilities Total
        </Text>
        <Text
          variant="headlineSmall"
          style={[styles.metricValue, { color: colors.primary }]}
        >
          {defaultCurrency
            ? formatWithCurrency(utilitiesTotal, defaultCurrency)
            : utilitiesTotal}
        </Text>
        <View
          style={[styles.percentageBadge, { backgroundColor: colors.primaryContainer }]}
        >
          <Text
            variant="labelSmall"
            style={{ color: colors.onPrimaryContainer, fontWeight: '700' }}
          >
            {utilitiesPercentage.toFixed(1)}% of total
          </Text>
        </View>
      </View>
    </View>
  );
};

export default ExpenseMetrics;

const styles = StyleSheet.create({
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  metricItem: {
    flex: 1,
    paddingVertical: 4,
  },
  metricDivider: {
    borderLeftWidth: 1,
    paddingLeft: 16,
    marginLeft: 16,
  },
  metricValue: {
    fontWeight: 'bold',
    marginVertical: 2,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  percentageBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 4,
  },
});
