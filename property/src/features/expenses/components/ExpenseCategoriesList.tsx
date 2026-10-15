import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import EmptyState from '@/shared/components/EmptyState';
import SPressable from '@/shared/components/SlightPressable';
import { formatWithCurrency } from '@/shared/utils/formatters';
import { addOpacity } from '@/shared/utils/helper';

interface ExpenseCategoriesListProps {
  colors: any;
  defaultCurrency: any;
  selectedMonthDate: Date;
  categoryBreakdown: any[];
  selectedCategoryKey: string | null;
  setSelectedCategoryKey: (key: string | null) => void;
}

const ExpenseCategoriesList: React.FC<ExpenseCategoriesListProps> = ({
  colors,
  defaultCurrency,
  selectedMonthDate,
  categoryBreakdown,
  selectedCategoryKey,
  setSelectedCategoryKey,
}) => {
  return (
    <SPressable style={styles.tabPanel} onPress={() => setSelectedCategoryKey(null)}>
      {categoryBreakdown.length === 0 ? (
        <EmptyState
          icon="receipt-text-outline"
          title={`No Expenses Recorded for ${selectedMonthDate.toLocaleString('default', { month: 'long' })}`}
          iconColor={colors.outline}
        />
      ) : (
        categoryBreakdown.map(cat => {
          const categoryColor = (colors as any)[cat.color] || colors.primary;
          const isSelected = selectedCategoryKey === cat.key;
          return (
            <View
              key={cat.key}
              style={[styles.categoryRowContainer, isSelected && { zIndex: 999 }]}
            >
              {isSelected && (
                <View
                  style={[
                    styles.categoryTooltipContainer,
                    {
                      backgroundColor: colors.surfaceVariant,
                      borderColor: colors.outline,
                    },
                  ]}
                >
                  <Text
                    variant="labelSmall"
                    style={[styles.categoryTooltipTitle, { color: colors.onSurface }]}
                  >
                    {cat.label} Details
                  </Text>

                  {cat.records && cat.records.length > 0 ? (
                    <View
                      style={[
                        styles.categoryTooltipTable,
                        { borderColor: colors.outlineVariant },
                      ]}
                    >
                      <View
                        style={[
                          styles.categoryTooltipTableHeader,
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
                      {cat.records.slice(0, 5).map((rec: any, recIdx: number) => {
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
                        const formattedDate = `${dayStr}/${shortMonth}/${fullYear}`;

                        return (
                          <View key={recIdx} style={styles.categoryTooltipTableRow}>
                            <Text
                              variant="labelSmall"
                              style={[
                                styles.tableCell,
                                { width: 75, color: colors.onSurfaceVariant },
                              ]}
                            >
                              {formattedDate}
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
                      {cat.records.length > 5 && (
                        <View style={styles.categoryTooltipTableRow}>
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
                            +{cat.records.length - 5} more...
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
                      No transaction details
                    </Text>
                  )}

                  <Text
                    variant="labelSmall"
                    style={[
                      styles.categoryTooltipTotal,
                      {
                        color: colors.onSurfaceVariant,
                        marginTop: 4,
                      },
                    ]}
                  >
                    Total:{' '}
                    {defaultCurrency
                      ? formatWithCurrency(cat.amount, defaultCurrency)
                      : cat.amount}
                  </Text>

                  {/* Arrow Callout */}
                  <View
                    style={[
                      styles.categoryArrow,
                      { borderTopColor: colors.surfaceVariant },
                    ]}
                  />
                </View>
              )}

              <SPressable
                onPress={() => setSelectedCategoryKey(isSelected ? null : cat.key)}
                style={[
                  styles.categoryTouchable,
                  isSelected && {
                    backgroundColor: addOpacity(colors.surfaceVariant, 0.35),
                  },
                ]}
              >
                <View>
                  <View style={styles.categoryInfo}>
                    <View style={styles.categoryLabelGroup}>
                      <View
                        style={[
                          styles.iconPill,
                          {
                            backgroundColor: addOpacity(categoryColor, 0.15),
                          },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={cat.icon as any}
                          size={16}
                          color={categoryColor}
                        />
                      </View>
                      <Text
                        variant="bodyLarge"
                        style={[styles.categoryName, { color: colors.onSurface }]}
                      >
                        {cat.label}
                      </Text>
                    </View>
                    <View style={styles.categoryAmountGroup}>
                      <Text
                        variant="titleMedium"
                        style={{ fontWeight: '700', color: colors.onSurface }}
                      >
                        {defaultCurrency
                          ? formatWithCurrency(cat.amount, defaultCurrency)
                          : cat.amount}
                      </Text>
                      <Text
                        variant="labelSmall"
                        style={{
                          color: colors.onSurfaceVariant,
                          marginLeft: 4,
                          marginRight: 4,
                        }}
                      >
                        ({cat.percentage.toFixed(1)}%)
                      </Text>
                      <MaterialCommunityIcons
                        name="information-outline"
                        size={14}
                        color={colors.onSurfaceVariant}
                      />
                    </View>
                  </View>
                  {/* Custom visual progress bar */}
                  <View
                    style={[
                      styles.progressBarBg,
                      { backgroundColor: colors.surfaceVariant },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          backgroundColor: categoryColor,
                          width: `${cat.percentage}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              </SPressable>
            </View>
          );
        })
      )}
    </SPressable>
  );
};

export default ExpenseCategoriesList;

const styles = StyleSheet.create({
  tabPanel: {
    marginTop: 4,
    minHeight: 150,
  },
  categoryRowContainer: {
    marginBottom: 14,
    borderRadius: 8,
    position: 'relative',
  },
  categoryTouchable: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  categoryTooltipContainer: {
    position: 'absolute',
    bottom: 54,
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    width: '90%',
    zIndex: 999,
    alignItems: 'center',
    borderWidth: 1,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
  },
  categoryTooltipTitle: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
    textAlign: 'center',
  },
  categoryTooltipTable: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 4,
    marginVertical: 4,
    overflow: 'hidden',
  },
  categoryTooltipTableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderBottomWidth: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
  categoryTooltipTableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  categoryTooltipTotal: {
    fontSize: 9,
    textAlign: 'center',
    fontWeight: '700',
  },
  categoryArrow: {
    position: 'absolute',
    bottom: -8,
    right: 12,
    width: 0,
    height: 0,
    borderStyle: 'solid',
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 0,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  categoryInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  categoryLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconPill: {
    padding: 6,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  categoryName: {
    fontWeight: '500',
  },
  categoryAmountGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  progressBarBg: {
    height: 8,
    borderRadius: 4,
    width: '100%',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
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
