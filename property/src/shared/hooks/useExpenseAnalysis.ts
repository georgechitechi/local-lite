import { useMemo, useState } from 'react';
import { EXPENSE_CATEGORY } from '@/features/expenses/utils/expenseUtils';

export interface Expense {
  id: string;
  category: string;
  amount: number;
  date: string;
  remarks?: string | null;
}

export function useExpenseAnalysis(
  expenses: Expense[],
  selectedMonthDate: Date,
  setSelectedMonthDate: (date: Date) => void,
) {
  const [activeTab, setActiveTab] = useState<'categories' | 'utilities'>('utilities');
  const [selectedTrendIndex, setSelectedTrendIndex] = useState<number | null>(null);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null);

  const analyticsData = useMemo(() => {
    const targetMonth = selectedMonthDate.getMonth() + 1;
    const targetYear = selectedMonthDate.getFullYear();

    const currentMonthExpenses = expenses.filter(e => {
      const date = new Date(e.date);
      return date.getMonth() + 1 === targetMonth && date.getFullYear() === targetYear;
    });

    const totalSpent = currentMonthExpenses.reduce(
      (sum, e) => sum + (parseFloat(String(e.amount)) || 0),
      0,
    );

    const categoryBreakdown = EXPENSE_CATEGORY.map(cat => {
      const catExpenses = currentMonthExpenses.filter(e => e.category === cat.key);
      const amount = catExpenses.reduce(
        (sum, e) => sum + (parseFloat(String(e.amount)) || 0),
        0,
      );
      const percentage = totalSpent > 0 ? (amount / totalSpent) * 100 : 0;
      const catRecords = catExpenses
        .map(e => ({
          date: e.date,
          amount: parseFloat(String(e.amount)) || 0,
          remarks: e.remarks ? e.remarks.replace(/\n/g, ' | ') : '',
        }))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return {
        ...cat,
        amount,
        percentage,
        records: catRecords,
      };
    });

    const lastMonthDate = new Date(selectedMonthDate);
    lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const lastMonthVal = lastMonthDate.getMonth() + 1;
    const lastMonthYearVal = lastMonthDate.getFullYear();

    const lastMonthExpenses = expenses.filter(e => {
      const date = new Date(e.date);
      return (
        date.getMonth() + 1 === lastMonthVal && date.getFullYear() === lastMonthYearVal
      );
    });

    const lastMonthTotalSpent = lastMonthExpenses.reduce(
      (sum, e) => sum + (parseFloat(String(e.amount)) || 0),
      0,
    );

    const changePercentage =
      lastMonthTotalSpent > 0
        ? ((totalSpent - lastMonthTotalSpent) / lastMonthTotalSpent) * 100
        : 0;

    const trendData = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date(selectedMonthDate);
      d.setMonth(d.getMonth() - i);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const monthLabel = d.toLocaleString('default', { month: 'short' });

      const monthExpenses = expenses.filter(e => {
        const date = new Date(e.date);
        return date.getMonth() + 1 === m && date.getFullYear() === y;
      });

      const monthTotal = monthExpenses.reduce(
        (sum, e) => sum + (parseFloat(String(e.amount)) || 0),
        0,
      );

      const monthUtilities = monthExpenses
        .filter(e => e.category === 'Utilities')
        .reduce((sum, e) => sum + (parseFloat(String(e.amount)) || 0), 0);

      const monthUtilitiesRecords = monthExpenses
        .filter(e => e.category === 'Utilities')
        .map(e => ({
          date: e.date,
          amount: parseFloat(String(e.amount)) || 0,
          remarks: e.remarks ? e.remarks.replace(/\n/g, ' | ') : '',
        }))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      trendData.push({
        label: monthLabel,
        total: monthTotal,
        utilities: monthUtilities,
        records: monthUtilitiesRecords,
        isCurrent: i === 0,
      });
    }

    return {
      totalSpent,
      categoryBreakdown,
      changePercentage,
      lastMonthTotalSpent,
      trendData,
    };
  }, [expenses, selectedMonthDate]);

  const maxUtilitiesVal = useMemo(() => {
    const maxVal = Math.max(...analyticsData.trendData.map(t => t.utilities), 0);
    return maxVal > 0 ? maxVal : 100;
  }, [analyticsData.trendData]);

  const today = new Date();
  const minDate = new Date(today.getFullYear(), today.getMonth() - 6, 1);
  const maxDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  const isMin =
    selectedMonthDate.getFullYear() < minDate.getFullYear() ||
    (selectedMonthDate.getFullYear() === minDate.getFullYear() &&
      selectedMonthDate.getMonth() <= minDate.getMonth());

  const isMax =
    selectedMonthDate.getFullYear() > maxDate.getFullYear() ||
    (selectedMonthDate.getFullYear() === maxDate.getFullYear() &&
      selectedMonthDate.getMonth() >= maxDate.getMonth());

  const handlePrevMonth = () => {
    if (isMin) return;
    const d = new Date(selectedMonthDate);
    d.setMonth(d.getMonth() - 1);
    setSelectedMonthDate(d);
    setSelectedTrendIndex(null);
    setSelectedCategoryKey(null);
  };

  const handleNextMonth = () => {
    if (isMax) return;
    const d = new Date(selectedMonthDate);
    d.setMonth(d.getMonth() + 1);
    setSelectedMonthDate(d);
    setSelectedTrendIndex(null);
    setSelectedCategoryKey(null);
  };

  const utilitiesCategory = analyticsData.categoryBreakdown.find(
    c => c.key === 'Utilities',
  );
  const utilitiesTotal = utilitiesCategory?.amount || 0;
  const utilitiesPercentage = utilitiesCategory?.percentage || 0;

  return {
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
  };
}
