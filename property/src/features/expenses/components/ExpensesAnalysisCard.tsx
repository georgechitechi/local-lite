import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Card, Text } from 'react-native-paper';
import DashboardCardHeader from '@/features/dashboard/components/DashboardCardHeader';
import ExpenseCategoriesList from '@/features/expenses/components/ExpenseCategoriesList';
import ExpenseMetrics from '@/features/expenses/components/ExpenseMetrics';
import ExpenseTrendChart from '@/features/expenses/components/ExpenseTrendChart';
import SPressable from '@/shared/components/SlightPressable';
import { type Expense, useExpenseAnalysis } from '@/shared/hooks/useExpenseAnalysis';
import { formatMonthYear } from '@/shared/utils/formatters';

interface ExpensesAnalysisCardProps {
  loading: boolean;
  expenses: Expense[];
  selectedMonthDate: Date;
  setSelectedMonthDate: (date: Date) => void;
  colors: any;
  defaultCurrency: any;
}

const ExpensesAnalysisCard: React.FC<ExpensesAnalysisCardProps> = ({
  loading,
  expenses = [],
  selectedMonthDate,
  setSelectedMonthDate,
  colors,
  defaultCurrency,
}) => {
  const {
    activeTab,
    setActiveTab,
    selectedTrendIndex,
    setSelectedTrendIndex,
    selectedCategoryKey,
    setSelectedCategoryKey,
    analyticsData,
    maxUtilitiesVal,
    isMin,
    isMax,
    handlePrevMonth,
    handleNextMonth,
    utilitiesTotal,
    utilitiesPercentage,
  } = useExpenseAnalysis(expenses, selectedMonthDate, setSelectedMonthDate);

  return (
    <Card mode="elevated" style={[styles.card, { backgroundColor: colors.surface }]}>
      <DashboardCardHeader
        title={formatMonthYear(selectedMonthDate)}
        subtitle="Expenses & Utilities Analysis"
        onPrev={handlePrevMonth}
        onNext={handleNextMonth}
        isPrevDisabled={isMin}
        isNextDisabled={isMax}
      />

      <Card.Content style={styles.cardContent}>
        {loading ? (
          <ActivityIndicator style={{ padding: 30 }} color={colors.primary} />
        ) : (
          <View>
            <ExpenseMetrics
              colors={colors}
              defaultCurrency={defaultCurrency}
              totalSpent={analyticsData.totalSpent}
              changePercentage={analyticsData.changePercentage}
              utilitiesTotal={utilitiesTotal}
              utilitiesPercentage={utilitiesPercentage}
            />

            <View
              style={[styles.tabSelector, { backgroundColor: colors.surfaceVariant }]}
            >
              <SPressable
                onPress={() => {
                  setActiveTab('utilities');
                  setSelectedTrendIndex(null);
                  setSelectedCategoryKey(null);
                }}
                style={[
                  styles.tabButton,
                  activeTab === 'utilities' && {
                    backgroundColor: colors.surface,
                    elevation: 2,
                    borderRadius: 6,
                  },
                ]}
              >
                <View style={styles.tabContent}>
                  <MaterialCommunityIcons
                    name="chart-bar"
                    size={16}
                    color={
                      activeTab === 'utilities' ? colors.primary : colors.onSurfaceVariant
                    }
                  />
                  <Text
                    variant="labelMedium"
                    style={{
                      marginLeft: 6,
                      fontWeight: activeTab === 'utilities' ? '700' : '500',
                      color:
                        activeTab === 'utilities'
                          ? colors.onSurface
                          : colors.onSurfaceVariant,
                    }}
                  >
                    Utilities Trend
                  </Text>
                </View>
              </SPressable>

              <SPressable
                onPress={() => {
                  setActiveTab('categories');
                  setSelectedTrendIndex(null);
                  setSelectedCategoryKey(null);
                }}
                style={[
                  styles.tabButton,
                  activeTab === 'categories' && {
                    backgroundColor: colors.surface,
                    elevation: 2,
                    borderRadius: 6,
                  },
                ]}
              >
                <View style={styles.tabContent}>
                  <MaterialCommunityIcons
                    name="chart-arc"
                    size={16}
                    color={
                      activeTab === 'categories'
                        ? colors.primary
                        : colors.onSurfaceVariant
                    }
                  />
                  <Text
                    variant="labelMedium"
                    style={{
                      marginLeft: 6,
                      fontWeight: activeTab === 'categories' ? '700' : '500',
                      color:
                        activeTab === 'categories'
                          ? colors.onSurface
                          : colors.onSurfaceVariant,
                    }}
                  >
                    Categories
                  </Text>
                </View>
              </SPressable>
            </View>

            {activeTab === 'categories' && (
              <ExpenseCategoriesList
                colors={colors}
                defaultCurrency={defaultCurrency}
                selectedMonthDate={selectedMonthDate}
                categoryBreakdown={analyticsData.categoryBreakdown}
                selectedCategoryKey={selectedCategoryKey}
                setSelectedCategoryKey={setSelectedCategoryKey}
              />
            )}

            {activeTab === 'utilities' && (
              <ExpenseTrendChart
                colors={colors}
                defaultCurrency={defaultCurrency}
                trendData={analyticsData.trendData}
                maxUtilitiesVal={maxUtilitiesVal}
                selectedTrendIndex={selectedTrendIndex}
                setSelectedTrendIndex={setSelectedTrendIndex}
              />
            )}
          </View>
        )}
      </Card.Content>
    </Card>
  );
};

export default ExpensesAnalysisCard;

const styles = StyleSheet.create({
  card: {
    borderRadius: 0,
    overflow: 'hidden',
  },
  cardContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  tabSelector: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 8,
    marginBottom: 16,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
