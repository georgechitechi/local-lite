import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { BusinessProvider, useBusiness } from '@/context/BusinessContext';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useHouses, useProperties, useReceipts } from '@/shared/hooks/useStore';

// Use the installed local-lite React hook: it does not requery on option changes.
const mockRows: Record<string, any[]> = {};
const mockListeners = new Map<string, Set<() => void>>();
const mockClient = {
  db: {},
  findMany: jest.fn(async (table: string) => mockRows[table] ?? []),
  events: {
    on: (table: string, callback: () => void) => {
      const listeners = mockListeners.get(table) ?? new Set();
      mockListeners.set(table, listeners);
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  },
};
let mockAuth: any;
jest.mock('@/providers/SyncClientProvider', () => ({ useLocalClient: () => mockClient }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/shared/services/auth', () => ({ OFFLINE_USER_ID: 'offline' }));
jest.mock('@/shared/utils/permissions', () => ({ ac: {}, mapActionToCrud: jest.fn() }));
jest.mock('@/shared/services/sync/client', () => ({
  getSyncClientSync: () => null,
  getSyncClient: jest.fn(),
}));
jest.mock('@/shared/components/CachedImage', () => ({ preCacheGallery: jest.fn() }));
jest.mock('expo-sqlite/kv-store', () => ({
  getItem: jest.fn(async () => 'private'),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <BusinessProvider>{children}</BusinessProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.clear();
  mockAuth = { user: { id: 'owner', email: 'person@example.com' }, loading: false };
  mockRows.businesses = [
    { id: 'a', user_id: 'owner', name: 'A' },
    { id: 'b', user_id: 'owner', name: 'B' },
    { id: 'private', user_id: 'another-user', name: 'Private' },
  ];
  mockRows.business_shares = [];
  mockRows.tenants = [];
  mockRows.properties = [
    { id: 'pa', business_id: 'a' }, { id: 'pb', business_id: 'b' },
    { id: 'unassigned' }, { id: 'private-property', business_id: 'private' },
  ];
  mockRows.houses = [{ id: 'ha', business_id: 'a' }, { id: 'hb', business_id: 'b' }];
  mockRows.receipts = [{ id: 'ra', business_id: 'a', amount: 100 }, { id: 'rb', business_id: 'b', amount: 900 }];
});

it('scopes mounted pages and dashboard inputs on selection, switching, and account changes', async () => {
  const { result, rerender } = await renderHook(() => {
    const selection = useBusiness();
    return {
      ...selection,
      properties: useProperties(selection.selectedBusiness?.id),
      houses: useHouses(selection.selectedBusiness?.id),
      receipts: useReceipts(selection.selectedBusiness?.id),
    };
  }, { wrapper });

  // A persisted selection belonging to another user must not become active.
  await waitFor(() => expect(result.current.selectedBusiness?.id).toBe('a'));
  await waitFor(() => expect(result.current.properties.map(row => row.id)).toEqual(['pa']));
  expect(result.current.houses.map(row => row.id)).toEqual(['ha']);
  expect(result.current.receipts.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(100);

  await act(() => result.current.selectBusiness(mockRows.businesses[1]));
  expect(result.current.properties.map(row => row.id)).toEqual(['pb']);
  expect(result.current.houses.map(row => row.id)).toEqual(['hb']);
  expect(result.current.receipts.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(900);
  expect(() => result.current.selectBusiness(mockRows.businesses[2])).toThrow('access');

  mockAuth = { user: { id: 'unrelated', email: 'unrelated@example.com' }, loading: false };
  await rerender({});
  expect(result.current.selectedBusiness).toBeNull();
  expect(result.current.properties).toEqual([]);
  expect(result.current.receipts).toEqual([]);
});

it('decodes shared roles and never borrows permissions from another business', async () => {
  mockAuth.user.id = 'shared-user';
  mockRows.business_shares = [
    { id: 'sa', business_id: 'a', shared_with: ' PERSON@example.com ', status: 'active', roles: '["staff"]' },
    { id: 'sb', business_id: 'b', shared_with: 'person@example.com', status: 'active', roles: '["tenant"]' },
    { id: 'old', business_id: 'b', shared_with: 'person@example.com', status: 'inactive', roles: '["admin"]' },
  ];
  const { result } = await renderHook(() => ({ selection: useBusiness(), access: useAccessControl() }), { wrapper });
  await waitFor(() => expect(result.current.access.userRoles).toEqual(['staff']));
  expect(result.current.access.hasAccess(['admin', 'staff'])).toBe(true);
  await act(() => result.current.selection.selectBusiness(mockRows.businesses[1]));
  expect(result.current.access.userRoles).toEqual(['tenant']);
  expect(result.current.access.hasAccess(['admin', 'staff'])).toBe(false);
});

it('revokes a selected business when its share becomes inactive', async () => {
  mockAuth.user.id = 'shared-user';
  mockRows.business_shares = [
    { id: 'sa', business_id: 'a', shared_with: 'person@example.com', status: 'active', roles: ['staff'] },
  ];
  const { result } = await renderHook(() => useBusiness(), { wrapper });
  await waitFor(() => expect(result.current.selectedBusiness?.id).toBe('a'));
  await act(async () => {
    mockRows.business_shares = [{ ...mockRows.business_shares[0], status: 'inactive' }];
    mockListeners.get('business_shares')?.forEach(listener => listener());
  });
  expect(result.current.selectedBusiness).toBeNull();
});
