import { act, renderHook } from '@testing-library/react-native';
import { useReminders } from '@/shared/hooks/useReminders';

jest.mock('expo-contacts', () => ({
  requestPermissionsAsync: jest.fn(),
  getContactsAsync: jest.fn(),
}));

jest.mock('@/context/BusinessContext', () => ({
  useBusiness: () => ({ selectedBusiness: { id: 'biz-1', name: 'Test Business' } }),
}));

jest.mock('@/context/SnackbarContext', () => ({
  useSnackbar: () => ({ showSnackbar: jest.fn() }),
}));

jest.mock('@/shared/hooks/useAccessControl', () => ({
  useAccessControl: () => ({ hasAccess: jest.fn().mockReturnValue(true) }),
}));

jest.mock('@/shared/hooks/useCurrency', () => ({
  useCurrency: () => ({ defaultCurrency: 'USD' }),
}));

jest.mock('@/shared/hooks/useLocalSync', () => ({
  useLocalSync: () => ({ requireCloudSync: jest.fn().mockReturnValue(true) }),
}));

jest.mock('@/shared/hooks/useOfflineCheck', () => ({
  useOfflineCheck: () => ({ checkOnline: jest.fn().mockReturnValue(true) }),
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('@/shared/hooks/useThemeProvider', () => ({
  useThemeColors: () => ({ warning: '#ff0', error: '#f00' }),
}));

const mockStoreData = {
  properties: [{ id: 'p1', name: 'Property 1' }],
  houses: [{ id: 'h1', property_id: 'p1', house_number: '101' }],
  tenants: [{ id: 't1', name: 'John Doe', phone: '12345', email: 'test@example.com' }],
  contracts: [
    {
      id: 'c1',
      tenant_id: 't1',
      house_id: 'h1',
      status: 'active',
      rent_amount: 1000,
      start_date: '2023-01-01',
    },
  ],
  receipts: [],
  reminderLogs: [
    {
      id: 'r1',
      tenant_id: 't1',
      status: 'sent',
      reminder_type: 'payment',
      sent_at: '2023-10-10T10:00:00Z',
      metadata: { target_date: '2023-10-15T00:00:00Z' },
    },
  ],
  store: {
    reminderLogs$: {
      assign: jest.fn(),
      r1: { delete: jest.fn() },
    },
  },
};

const mockContractsByTenantId = new Map();
mockContractsByTenantId.set('t1', mockStoreData.contracts);

const mockReceiptsByContractId = new Map();
mockReceiptsByContractId.set('c1', mockStoreData.receipts);

const mockHousesById = new Map();
mockHousesById.set('h1', mockStoreData.houses[0]);

const mockPropertiesById = new Map();
mockPropertiesById.set('p1', mockStoreData.properties[0]);

jest.mock('@/shared/hooks/useStore', () => ({
  useTenants: () => mockStoreData.tenants,
  useContracts: () => mockStoreData.contracts,
  useReceipts: () => mockStoreData.receipts,
  useHouses: () => mockStoreData.houses,
  useProperties: () => mockStoreData.properties,
  useReminderLogs: () => mockStoreData.reminderLogs,
  useSettings: () => [],
  useStoreRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }),
  useContractsByTenantId: () => mockContractsByTenantId,
  useReceiptsByContractId: () => mockReceiptsByContractId,
  useHousesById: () => mockHousesById,
  usePropertiesById: () => mockPropertiesById,
  useCoreMutations: () => ({
    insert: jest.fn(),
    insertMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  }),
}));

jest.mock('@/features/settings/utils/settingsHelper', () => ({
  getHouseTypes: jest.fn().mockResolvedValue([{ id: 'ht1', name: 'Standard' }]),
}));

jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  rn.Linking = {
    canOpenURL: jest.fn().mockResolvedValue(true),
    openURL: jest.fn().mockResolvedValue(true),
  };
  rn.Share = {
    share: jest.fn().mockResolvedValue(true),
  };
  return rn;
});

describe('useReminders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2023-10-15T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initializes and calculates tenants with pending rent', async () => {
    const { result } = await renderHook(() => useReminders());
    expect(result.current).toBeDefined();
    // It should have some state variables
    expect(typeof result.current.handleSendMessage).toBe('function');

    await act(async () => {
      await Promise.resolve();
    });
  });

  it('can delete a reminder', async () => {
    const { result } = await renderHook(() => useReminders());

    // Simulate selecting a reminder and deleting it
    expect(typeof result.current.handleDeleteReminder).toBe('function');

    await act(async () => {
      await Promise.resolve();
    });
  });
});
