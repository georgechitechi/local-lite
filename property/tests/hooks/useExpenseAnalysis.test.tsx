import { act, renderHook } from '@testing-library/react-native';
import { useExpenseAnalysis } from '@/shared/hooks/useExpenseAnalysis';

jest.mock('@/features/expenses/utils/expenseUtils', () => ({
  EXPENSE_CATEGORY: [
    { key: 'Utilities', label: 'Utilities', icon: 'flash', color: '#ff0' },
    { key: 'Maintenance', label: 'Maintenance', icon: 'construct', color: '#f0f' },
  ],
}));

describe('useExpenseAnalysis', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2023-10-15T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const mockExpenses = [
    {
      id: '1',
      category: 'Utilities',
      amount: 100,
      date: '2023-10-15T10:00:00Z',
      remarks: 'Water bill',
    },
    { id: '2', category: 'Maintenance', amount: 200, date: '2023-10-20T10:00:00Z' },
    { id: '3', category: 'Utilities', amount: 150, date: '2023-09-15T10:00:00Z' },
  ];

  it('calculates analytics data correctly for the selected month', async () => {
    let selectedDate = new Date('2023-10-01T00:00:00Z');
    const setDate = jest.fn(d => {
      selectedDate = d;
    });

    const { result } = await renderHook(() =>
      useExpenseAnalysis(mockExpenses, selectedDate, setDate),
    );

    expect(result.current.analyticsData.totalSpent).toBe(300);
    expect(result.current.analyticsData.lastMonthTotalSpent).toBe(150);
    expect(result.current.analyticsData.changePercentage).toBe(100);
    expect(result.current.utilitiesTotal).toBe(100);
    expect(result.current.utilitiesPercentage).toBe((100 / 300) * 100);
  });

  it('handles prev and next month navigation', async () => {
    let selectedDate = new Date('2023-10-01T00:00:00Z');
    const setDate = jest.fn(d => {
      selectedDate = d;
    });

    const { result } = await renderHook(() =>
      useExpenseAnalysis(mockExpenses, selectedDate, setDate),
    );

    act(() => {
      result.current.handlePrevMonth();
    });
    expect(setDate).toHaveBeenCalled();
    expect(setDate.mock.calls[0][0].getMonth()).toBe(8); // September

    act(() => {
      result.current.handleNextMonth();
    });
    expect(setDate).toHaveBeenCalledTimes(2);
    expect(setDate.mock.calls[1][0].getMonth()).toBe(10); // November
  });
});
