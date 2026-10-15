import { act, renderHook } from '@testing-library/react-native';
import {
  useApiKeys,
  useBookings,
  useBusiness,
  useBusinesses,
  useBusinessShares,
  useContracts,
  useContractsByHouseId,
  useContractsById,
  useContractsByTenantId,
  useExpenses,
  useExpensesById,
  useHouses,
  useHousesById,
  useHousesByPropertyId,
  useMaintenanceRequests,
  usePaymentMessageReceipts,
  usePaymentMessages,
  useProfile,
  useProfileByEmail,
  useProfiles,
  usePromotions,
  useProperties,
  usePropertiesById,
  useReceipts,
  useReceiptsByContractId,
  useReceiptsById,
  useReceiptsByTenantId,
  useReminderLogs,
  useSettings,
  useStoreRefresh,
  useTenants,
  useTenantsById,
  useTransactions,
} from '@/shared/hooks/useStore';

const mockData: Record<string, any[]> = {
  businesses: [{ id: 'biz-1', name: 'Business 1', user_id: 'user-1', deleted: false }],
  profiles: [{ id: 'user-1', email: 'test@example.com' }],
  properties: [{ id: 'prop-1', business_id: 'biz-1' }],
  houses: [{ id: 'house-1', business_id: 'biz-1' }],
  tenants: [],
  contracts: [],
  receipts: [],
  expenses: [],
  bookings: [],
  payment_messages: [],
  reminder_logs: [],
  payment_message_receipts: [],
  settings: [],
  receipt_refunds: [],
  schedules: [],
  backup_logs: [],
  maintenance_requests: [],
  promotions: [],
  message_templates: [],
  api_keys: [],
  gallery_images: [],
  transactions: [],
};

jest.mock('local-lite/react', () => ({
  useLiveQuery: jest.fn((_client, tableName, filter) => {
    let rows = mockData[tableName] || [];
    if (filter?.where) {
      rows = rows.filter(filter.where);
    }
    return { data: rows, loading: false, error: null };
  }),
}));

let mockAuth: any = { user: { id: 'user-1', email: 'test@example.com' }, loading: false };
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/shared/services/auth', () => ({ OFFLINE_USER_ID: 'offline' }));

const mockPull = jest.fn().mockResolvedValue(undefined);
jest.mock('@/providers/SyncClientProvider', () => ({
  useLocalClient: () => ({ syncWorker: { pullRemoteChanges: mockPull } }),
}));

describe('useStore hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth = { user: { id: 'user-1', email: 'test@example.com' }, loading: false };
    mockData.businesses = [{ id: 'biz-1', name: 'Business 1', user_id: 'user-1', deleted: false }];
    mockData.business_shares = [];
    mockData.tenants = [];
    mockData.properties = [{ id: 'prop-1', business_id: 'biz-1' }];

  });

  it('useBusinesses filters out deleted items', async () => {
    const { result } = await renderHook(() => useBusinesses());
    expect(result.current).toEqual([{ id: 'biz-1', name: 'Business 1', user_id: 'user-1', deleted: false }]);
  });

  it('useBusiness retrieves a specific business', async () => {
    const { result } = await renderHook(() => useBusiness('biz-1'));
    expect(result.current).toEqual({ id: 'biz-1', name: 'Business 1', user_id: 'user-1', deleted: false });
  });

  it('useBusiness returns undefined for missing or deleted business', async () => {
    const { result: res1 } = await renderHook(() => useBusiness('biz-2')); // deleted
    expect(res1.current).toBeUndefined();

    const { result: res2 } = await renderHook(() => useBusiness('biz-3')); // missing
    expect(res2.current).toBeUndefined();
  });

  it('useProfile retrieves a specific profile', async () => {
    const { result } = await renderHook(() => useProfile('user-1'));
    expect(result.current).toEqual({ id: 'user-1', email: 'test@example.com' });
  });

  it('useProfileByEmail retrieves profile by email (case-insensitive)', async () => {
    const { result } = await renderHook(() => useProfileByEmail('TEST@example.com'));
    expect(result.current).toEqual({ id: 'user-1', email: 'test@example.com' });
  });

  it('useProfiles returns profiles', async () => {
    const { result } = await renderHook(() => useProfiles());
    expect(result.current).toEqual([{ id: 'user-1', email: 'test@example.com' }]);
  });


  it('re-scopes mounted pages immediately when a business is selected or switched', async () => {
    mockData.properties = [
      { id: 'a', business_id: 'biz-1' }, { id: 'b', business_id: 'biz-2' },
      { id: 'orphan' }, { id: 'deleted', business_id: 'biz-1', deleted: 'true' },
    ];
    const { result, rerender } = await renderHook(
      ({ id }: { id?: string }) => useProperties(id), { initialProps: { id: undefined } },
    );
    expect(result.current).toEqual([]);
    await rerender({ id: 'biz-1' });
    expect(result.current.map(row => row.id)).toEqual(['a']);
    await rerender({ id: 'biz-2' });
    expect(result.current.map(row => row.id)).toEqual(['b']);
    await rerender({ id: undefined });
    expect(result.current).toEqual([]);
  });

  it('restricts businesses to the current owner, active shares, and tenant membership', async () => {
    mockData.businesses = [
      { id: 'owned', user_id: 'user-1' }, { id: 'shared', user_id: 'other' },
      { id: 'rented', user_id: 'other' }, { id: 'private', user_id: 'other' },
      { id: 'invited', user_id: 'other' }, { id: 'offline', user_id: 'offline' },
    ];
    mockData.business_shares = [
      { id: 's', business_id: 'shared', shared_with: ' TEST@example.com ', status: 'active' },
      { id: 'p', business_id: 'invited', shared_with: 'test@example.com', status: 'pending' },
    ];
    mockData.tenants = [{ id: 't', business_id: 'rented', email: 'test@example.com' }];
    const { result, rerender } = await renderHook(() => useBusinesses());
    expect(result.current.map(b => b.id)).toEqual(['owned', 'shared', 'rented', 'offline']);
    mockAuth = { user: { id: 'offline' }, loading: false };
    await rerender({});
    expect(result.current.map(b => b.id)).toEqual(['offline']);
    mockAuth = { user: null, loading: false };
    await rerender({});
    expect(result.current).toEqual([]);
  });

  describe('Collection hooks', () => {
    const collectionHooks = [
      { hook: useBusinessShares, expected: [] },
      { hook: () => useProperties('biz-1'), expected: [{ id: 'prop-1', business_id: 'biz-1' }] },
      { hook: () => useHouses('biz-1'), expected: [{ id: 'house-1', business_id: 'biz-1' }] },
      { hook: () => useTenants('biz-1'), expected: [] },
      { hook: () => useContracts('biz-1'), expected: [] },
      { hook: () => useReceipts('biz-1'), expected: [] },
      { hook: () => useExpenses('biz-1'), expected: [] },
      { hook: () => useBookings('biz-1'), expected: [] },
      { hook: () => usePaymentMessages('biz-1'), expected: [] },
      { hook: () => usePaymentMessageReceipts('biz-1'), expected: [] },
      { hook: () => useReminderLogs('biz-1'), expected: [] },
      { hook: () => useSettings('biz-1'), expected: [] },
      { hook: () => usePromotions('biz-1'), expected: [] },
      { hook: () => useApiKeys('biz-1'), expected: [] },
      { hook: () => useTransactions('biz-1'), expected: [] },
      { hook: () => useMaintenanceRequests('biz-1'), expected: [] },
    ];

    collectionHooks.forEach(({ hook, expected }, i) => {
      it(`collection hook ${i} returns expected data`, async () => {
        const { result } = await renderHook(hook as any);
        expect(result.current).toEqual(expected);
      });
    });
  });

  describe('O(1) Map hooks', () => {
    const mapHooks = [
      { hook: () => useHousesById('biz-1') },
      { hook: () => usePropertiesById('biz-1') },
      { hook: () => useTenantsById('biz-1') },
      { hook: () => useExpensesById('biz-1') },
      { hook: () => useContractsById('biz-1') },
      { hook: () => useReceiptsById('biz-1') },
      { hook: () => useContractsByTenantId('biz-1') },
      { hook: () => useContractsByHouseId('biz-1') },
      { hook: () => useReceiptsByContractId('biz-1') },
      { hook: () => useReceiptsByTenantId('biz-1') },
      { hook: () => useHousesByPropertyId('biz-1') },
    ];

    mapHooks.forEach(({ hook }, i) => {
      it(`map hook ${i} returns a Map-like object`, async () => {
        const { result } = await renderHook(hook as any);
        const current = result.current as any;
        expect(current.get).toBeDefined();
        expect(current.has).toBeDefined();
        expect(current.values).toBeDefined();
        expect(current.get('test-id')).toBeUndefined();
        expect(current.has('test-id')).toBe(false);
        expect(Array.isArray(current.values())).toBe(true);
      });
    });
  });

  describe('useStoreRefresh', () => {
    it('handles refresh correctly', async () => {
      const { result } = await renderHook(() => useStoreRefresh());
      expect(result.current.refreshing).toBe(false);

      await act(async () => {
        await result.current.onRefresh();
      });

      expect(mockPull).toHaveBeenCalled();
      expect(result.current.refreshing).toBe(false);
    });
  });
});
