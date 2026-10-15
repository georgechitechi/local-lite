import { renderHook } from '@testing-library/react-native';
import { useInsights } from '@/shared/hooks/useInsights';

jest.mock('@/shared/hooks/useCurrency', () => ({
  useCurrency: jest.fn(),
}));

describe('useInsights', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2023-10-15T00:00:00Z')); // October 15, 2023
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const emptyData = {
    receipts: [],
    expenses: [],
    houses: [],
    contracts: [],
    tenants: [],
  };

  it('returns empty insights for undefined businessId', async () => {
    const { result } = await renderHook(() => useInsights(undefined, emptyData));
    expect(result.current).toEqual([]);
  });

  it('generates high occupancy insight', async () => {
    const data = {
      ...emptyData,
      houses: [{ id: 'h1' }, { id: 'h2' }],
      contracts: [
        {
          id: 'c1',
          status: 'active',
          start_date: '2023-01-01',
          end_date: '2024-01-01',
          rent_amount: 1000,
        },
        {
          id: 'c2',
          status: 'active',
          start_date: '2023-01-01',
          end_date: '2024-01-01',
          rent_amount: 1000,
        },
      ],
    };

    const { result } = await renderHook(() => useInsights('biz-1', data));
    const occupancyInsight = result.current.find(i => i.title === 'High Occupancy');
    expect(occupancyInsight).toBeDefined();
    expect(occupancyInsight?.type).toBe('success');
  });

  it('generates low occupancy insight', async () => {
    const data = {
      ...emptyData,
      houses: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'h4' }],
      contracts: [
        {
          id: 'c1',
          status: 'active',
          start_date: '2023-01-01',
          end_date: '2024-01-01',
          rent_amount: 1000,
        },
      ],
    };

    const { result } = await renderHook(() => useInsights('biz-1', data));
    const occupancyInsight = result.current.find(i => i.title === 'Low Occupancy');
    expect(occupancyInsight).toBeDefined();
    expect(occupancyInsight?.type).toBe('warning');
  });

  it('generates high burn rate insight when expenses exceed revenue', async () => {
    const data = {
      ...emptyData,
      receipts: [{ amount: 1000, payment_period: { month: 10, year: 2023 } }],
      expenses: [{ amount: 1500, date: '2023-10-05T00:00:00Z' }],
    };

    const { result } = await renderHook(() => useInsights('biz-1', data));
    const burnRateInsight = result.current.find(i => i.title === 'High Burn Rate');
    expect(burnRateInsight).toBeDefined();
  });

  it('generates contract renewals insight for expiring contracts', async () => {
    const data = {
      ...emptyData,
      contracts: [
        {
          id: 'c1',
          status: 'active',
          start_date: '2023-01-01',
          end_date: '2023-10-30T00:00:00Z',
          rent_amount: 1000,
        },
      ],
    };

    const { result } = await renderHook(() => useInsights('biz-1', data));
    const renewalInsight = result.current.find(i => i.title === 'Contract Renewals');
    expect(renewalInsight).toBeDefined();
    expect(renewalInsight?.message).toContain('1 contract is expiring');
  });

  it('generates collection alert for low collection rate', async () => {
    const data = {
      ...emptyData,
      contracts: [
        {
          id: 'c1',
          status: 'active',
          start_date: '2023-01-01',
          end_date: '2024-01-01',
          rent_amount: 1000,
        },
        {
          id: 'c2',
          status: 'active',
          start_date: '2023-01-01',
          end_date: '2024-01-01',
          rent_amount: 1000,
        },
      ],
      receipts: [
        { amount: 500, payment_period: { month: 10, year: 2023 } }, // Expected 2000, got 500 (25%)
      ],
    };

    const { result } = await renderHook(() => useInsights('biz-1', data));
    const collectionInsight = result.current.find(i => i.title === 'Collection Alert');
    expect(collectionInsight).toBeDefined();
  });

  it('generates missing tenant info insight', async () => {
    const data = {
      ...emptyData,
      tenants: [
        { id: 't1', status: 'active', email: 'placeholder@email.com', phone: '' },
      ],
    };

    const { result } = await renderHook(() => useInsights('biz-1', data));
    const missingInfoInsight = result.current.find(
      i => i.title === 'Missing Tenant Info',
    );
    expect(missingInfoInsight).toBeDefined();
  });

  it('generates overdue rent insight after 5th of month', async () => {
    const data = {
      ...emptyData,
      contracts: [
        {
          id: 'c1',
          tenant_id: 't1',
          status: 'active',
          start_date: '2023-01-01',
          end_date: '2024-01-01',
          rent_amount: 1000,
        },
      ],
      receipts: [], // No receipts
    };

    const { result } = await renderHook(() => useInsights('biz-1', data));
    const overdueInsight = result.current.find(i => i.title === 'Overdue Rent');
    expect(overdueInsight).toBeDefined();
  });
});
