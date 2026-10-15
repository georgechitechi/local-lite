import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import SPressable from '@/shared/components/SlightPressable';
import { formatWithCurrency } from '@/shared/utils/formatters';
import { addOpacity } from '@/shared/utils/helper';

// Bar centers in space-around layout (5 bars at 15% each):
// idx 0 → ~10%, idx 1 → ~30%, idx 2 → ~50%, idx 3 → ~70%, idx 4 → ~90%
// Tooltip is 90% wide, centered (5% left margin).
// Arrow left within tooltip = ((barCenter - tooltipLeft) / tooltipWidth) * 100%
const BAR_CENTERS_PCT = [10, 30, 50, 70, 90]; // % of chartMainContent width

const getArrowStyle = (idx: number, colors: any) => {
  const tooltipLeftPct = 5; // 5% margin on each side → left edge of tooltip
  const tooltipWidthPct = 90;
  const barCenter = BAR_CENTERS_PCT[idx] ?? 50;
  // Clamp so arrow stays within the tooltip body (8px from each edge)
  const arrowLeftPct = Math.min(
    Math.max(((barCenter - tooltipLeftPct) / tooltipWidthPct) * 100, 5),
    95,
  );

  return {
    position: 'absolute' as const,
    bottom: -8,
    left: `${arrowLeftPct}%` as any,
    marginLeft: -8, // half of arrow width to truly center it on the point
    width: 0,
    height: 0,
    borderStyle: 'solid' as const,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 0,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.primary,
  };
};

interface ExpenseTrendChartProps {
  colors: any;
  defaultCurrency: any;
  trendData: any[];
  maxUtilitiesVal: number;
  selectedTrendIndex: number | null;
  setSelectedTrendIndex: React.Dispatch<React.SetStateAction<number | null>>;
}

const ExpenseTrendChart: React.FC<ExpenseTrendChartProps> = ({
  colors,
  defaultCurrency,
  trendData,
  maxUtilitiesVal,
  selectedTrendIndex,
  setSelectedTrendIndex,
}) => {
  return (
    <View style={styles.tabPanel}>
      <Text
        variant="labelMedium"
        style={[styles.chartTitle, { color: colors.onSurfaceVariant }]}
      >
        Monthly Utilities Spending (Last 5 Months)
      </Text>

      <View style={styles.chartWrapper}>
        <SPressable
          style={[styles.chartMainContent, { position: 'relative' }]}
          onPress={() => setSelectedTrendIndex(null)}
        >
          {selectedTrendIndex !== null &&
            (() => {
              const t = trendData[selectedTrendIndex];
              if (!t) return null;
              return (
                <View
                  style={[
                    styles.tooltipContainer,
                    {
                      backgroundColor: colors.surfaceVariant,
                      borderColor: colors.outline,
                      width: '90%',
                      alignSelf: 'center',
                      left: undefined,
                      right: undefined,
                    },
                  ]}
                >
                  <Text
                    variant="labelSmall"
                    style={[styles.tooltipTitle, { color: colors.onSurface }]}
                  >
                    {t.label} Utilities
                  </Text>

                  {t.records && t.records.length > 0 ? (
                    <View
                      style={[
                        styles.tooltipTable,
                        { borderColor: colors.outlineVariant },
                      ]}
                    >
                      <View
                        style={[
                          styles.tooltipTableHeader,
                          { borderBottomColor: colors.outlineVariant },
                        ]}
                      >
                        <Text
                          variant="labelSmall"
                          style={[
                            styles.tableHeaderCell,
                            { width: 75, color: colors.onSurfaceVariant },
                          ]}
                        >
                          Date
                        </Text>
                        <Text
                          variant="labelSmall"
                          style={[
                            styles.tableHeaderCell,
                            {
                              flex: 1,
                              marginLeft: 10,
                              color: colors.onSurfaceVariant,
                            },
                          ]}
                        >
                          Remarks
                        </Text>
                        <Text
                          variant="labelSmall"
                          style={[
                            styles.tableHeaderCell,
                            styles.alignRight,
                            { width: 60, color: colors.onSurfaceVariant },
                          ]}
                        >
                          Amt
                        </Text>
                      </View>
                      {t.records.slice(0, 5).map((rec: any, recIdx: number) => {
                        const dateObj = new Date(rec.date);
                        const dayStr = String(dateObj.getDate()).padStart(2, '0');
                        const months = [
                          'Jan',
                          'Feb',
                          'Mar',
                          'Apr',
                          'May',
                          'Jun',
                          'Jul',
                          'Aug',
                          'Sep',
                          'Oct',
                          'Nov',
                          'Dec',
                        ];
                        const shortMonth = months[dateObj.getMonth()];
                        const fullYear = dateObj.getFullYear();
                        const formattedDateStr = `${dayStr}/${shortMonth}/${fullYear}`;
                        return (
                          <View key={recIdx} style={styles.tooltipTableRow}>
                            <Text
                              variant="labelSmall"
                              style={[
                                styles.tableCell,
                                {
                                  width: 75,
                                  color: colors.onSurfaceVariant,
                                },
                              ]}
                            >
                              {formattedDateStr}
                            </Text>
                            <Text
                              variant="labelSmall"
                              numberOfLines={1}
                              style={[
                                styles.tableCell,
                                {
                                  flex: 1,
                                  marginLeft: 10,
                                  color: colors.onSurfaceVariant,
                                },
                              ]}
                            >
                              {rec.remarks || 'No remarks'}
                            </Text>
                            <Text
                              variant="labelSmall"
                              style={[
                                styles.tableCell,
                                styles.alignRight,
                                {
                                  width: 60,
                                  color: colors.onSurface,
                                  fontWeight: '600',
                                },
                              ]}
                            >
                              {Math.round(rec.amount).toLocaleString()}
                            </Text>
                          </View>
                        );
                      })}
                      {t.records.length > 5 && (
                        <View style={styles.tooltipTableRow}>
                          <Text
                            variant="labelSmall"
                            style={[
                              styles.tableCell,
                              {
                                color: colors.onSurfaceVariant,
                                fontStyle: 'italic',
                              },
                            ]}
                          >
                            +{t.records.length - 5} more...
                          </Text>
                        </View>
                      )}
                    </View>
                  ) : (
                    <Text
                      variant="labelSmall"
                      style={{
                        color: colors.outline,
                        fontSize: 9,
                        marginVertical: 4,
                      }}
                    >
                      No utility bills
                    </Text>
                  )}

                  <Text
                    variant="labelSmall"
                    style={[
                      styles.tooltipTotal,
                      {
                        color: colors.onSurfaceVariant,
                        marginTop: 4,
                        fontWeight: '700',
                      },
                    ]}
                  >
                    Total:{' '}
                    {defaultCurrency
                      ? formatWithCurrency(t.utilities, defaultCurrency)
                      : t.utilities}
                  </Text>
                  <View style={getArrowStyle(selectedTrendIndex, colors)} />
                </View>
              );
            })()}

          <View style={styles.chartContainer}>
            {trendData.map((t, idx) => {
              const barHeightPct =
                maxUtilitiesVal > 0 ? (t.utilities / maxUtilitiesVal) * 100 : 0;
              return (
                <React.Fragment key={idx}>
                  {idx > 0 && (
                    <View
                      style={[
                        styles.verticalDivider,
                        { backgroundColor: colors.outlineVariant },
                      ]}
                    />
                  )}
                  <View style={styles.chartColumn}>
                    <Text
                      variant="labelSmall"
                      numberOfLines={1}
                      style={[
                        styles.chartValText,
                        {
                          color: t.isCurrent ? colors.primary : colors.onSurfaceVariant,
                          fontWeight: t.isCurrent ? '700' : '400',
                        },
                      ]}
                    >
                      {t.utilities > 0 ? Math.round(t.utilities).toLocaleString() : '-'}
                    </Text>

                    <SPressable
                      onPress={e => {
                        e.stopPropagation();
                        setSelectedTrendIndex(prev => (prev === idx ? null : idx));
                      }}
                    >
                      <View style={styles.barWrapper}>
                        <View
                          style={[
                            styles.barFill,
                            {
                              backgroundColor: t.isCurrent
                                ? colors.primary
                                : selectedTrendIndex === idx
                                  ? colors.primary
                                  : addOpacity(colors.primary, 0.45),
                              height: `${barHeightPct}%`,
                            },
                          ]}
                        />
                      </View>
                    </SPressable>

                    <Text
                      variant="labelSmall"
                      style={[
                        styles.chartLabelText,
                        {
                          color: t.isCurrent ? colors.onSurface : colors.onSurfaceVariant,
                          fontWeight: t.isCurrent ? '700' : '400',
                        },
                      ]}
                    >
                      {t.label}
                    </Text>
                  </View>
                </React.Fragment>
              );
            })}
          </View>
        </SPressable>
      </View>
    </View>
  );
};

export default ExpenseTrendChart;

const styles = StyleSheet.create({
  tabPanel: {
    marginTop: 4,
    minHeight: 150,
  },
  chartTitle: {
    textAlign: 'center',
    marginBottom: 12,
    fontSize: 12,
  },
  chartWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  chartMainContent: {
    flex: 1,
  },
  chartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: 160,
    paddingBottom: 4,
  },
  chartColumn: {
    alignItems: 'center',
    width: '15%',
    height: '100%',
    justifyContent: 'flex-end',
  },
  chartValText: {
    fontSize: 9,
    marginBottom: 4,
    textAlign: 'center',
  },
  barWrapper: {
    width: 36,
    height: '80%',
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
    marginBottom: 0,
  },
  barFill: {
    width: '100%',
    borderRadius: 4,
  },
  chartLabelText: {
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 12,
    marginTop: -5,
  },
  verticalDivider: {
    width: 1,
    height: 128,
    alignSelf: 'flex-end',
    marginBottom: 26,
    opacity: 0.35,
  },
  tooltipContainer: {
    position: 'absolute',
    bottom: 130,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    width: 220,
    zIndex: 999,
    alignItems: 'center',
    borderWidth: 1,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
  },
  tooltipTitle: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
    textAlign: 'center',
  },
  tooltipTotal: {
    fontSize: 9,
    textAlign: 'center',
  },
  tooltipTable: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 4,
    marginVertical: 4,
    overflow: 'hidden',
  },
  tooltipTableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderBottomWidth: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
  tooltipTableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontWeight: '700',
  },
  tableCell: {
    fontSize: 8,
  },
  alignRight: {
    textAlign: 'right',
  },
});
