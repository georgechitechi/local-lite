import {
  SyncInspector,
  useLiveInfiniteQuery,
  useLiveQuery,
  useLiveRow,
  useMutations,
  useSyncMetrics,
  useSyncStatus,
} from 'local-lite/react';
import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { useLocalClient } from '@/providers/SyncClientProvider';
import { OFFLINE_USER_ID } from '@/shared/services/auth';
import { BUSINESS_COLLECTIONS, type CoreTableName } from '@/shared/services/sync/tables';
import type {
  ApiKey,
  BackupLog,
  Booking,
  Business,
  BusinessShare,
  Contract,
  Expense,
  GalleryImage,
  House,
  MaintenanceRequest,
  MessageTemplate,
  PaymentMessage,
  PaymentMessageReceipt,
  Profile,
  Promotion,
  Property,
  Receipt,
  ReceiptRefund,
  ReminderLog,
  Schedule,
  Setting,
  Tenant,
  Transaction,
} from '@/shared/types/types';
import { accessibleBusinesses, normalizeIdentity } from '@/shared/utils/businessScope';
import { EMPTY_ARRAY } from '@/shared/utils/helper';

export {
  useIsInitialSyncing,
  useLocalClient,
  useSyncClientContext,
} from '@/providers/SyncClientProvider';
export {
  SyncInspector,
  useLiveInfiniteQuery,
  useLiveQuery,
  useLiveRow,
  useMutations,
  useSyncMetrics,
  useSyncStatus,
};

// ---------------------------------------------------------------------------
// Core Table Live Queries (Powered directly by local-lite SQLite)
// ---------------------------------------------------------------------------

/**
 * Reactively subscribes to a single record in a core table using local-lite's useLiveRow hook.
 * Precise row-level invalidation prevents superfluous re-renders when other rows in the table change.
 */
export function useCoreRow<T = any>(
  tableName: CoreTableName,
  id: string | undefined | null,
): { data: T | null; loading: boolean; refetch: () => Promise<void> } {
  const client = useLocalClient();
  return useLiveRow<T>(client, tableName, id);
}

export interface CoreTableResult<T> {
  data: T[];
  loading: boolean;
}

export function useCoreTableWithLoading<
  T extends {
    id: string;
    deleted?: boolean | number | null;
    business_id?: string | null;
  },
>(tableName: CoreTableName, businessId?: string): CoreTableResult<T> {
  const client = useLocalClient();
  const scoped = (BUSINESS_COLLECTIONS as readonly string[]).includes(tableName);
  const targetId = normalizeIdentity(businessId);

  const queryOptions = useMemo(() => {
    if (scoped && !targetId) {
      return { where: { id: '__none__' } };
    }
    if (scoped && targetId) {
      return { where: { business_id: targetId } };
    }
    return undefined;
  }, [scoped, targetId]);

  const { data, loading } = useLiveQuery<T>(client, tableName, queryOptions);

  return {
    data:
      !client || (scoped && !targetId)
        ? (EMPTY_ARRAY as T[])
        : (data ?? (EMPTY_ARRAY as T[])),
    loading: !client || loading,
  };
}

function useCoreTable<
  T extends {
    id: string;
    deleted?: boolean | number | null;
    business_id?: string | null;
  },
>(tableName: CoreTableName, businessId?: string): T[] {
  return useCoreTableWithLoading<T>(tableName, businessId).data;
}

export const useProperties = (businessId?: string) =>
  useCoreTable<Property>('properties', businessId);
export const usePropertiesWithLoading = (businessId?: string) =>
  useCoreTableWithLoading<Property>('properties', businessId);

export const useHouses = (businessId?: string) =>
  useCoreTable<House>('houses', businessId);
export const useHousesWithLoading = (businessId?: string) =>
  useCoreTableWithLoading<House>('houses', businessId);

export const useTenants = (businessId?: string) =>
  useCoreTable<Tenant>('tenants', businessId);
export const useTenantsWithLoading = (businessId?: string) =>
  useCoreTableWithLoading<Tenant>('tenants', businessId);

export const useContracts = (businessId?: string) =>
  useCoreTable<Contract>('contracts', businessId);
export const useContractsWithLoading = (businessId?: string) =>
  useCoreTableWithLoading<Contract>('contracts', businessId);

export const useReceipts = (businessId?: string) =>
  useCoreTable<Receipt>('receipts', businessId);
export const useReceiptsWithLoading = (businessId?: string) =>
  useCoreTableWithLoading<Receipt>('receipts', businessId);

export const useExpenses = (businessId?: string) =>
  useCoreTable<Expense>('expenses', businessId);

export const useSettings = (businessId?: string) =>
  useCoreTable<Setting>('settings', businessId);

export const useMaintenanceRequests = (businessId?: string) =>
  useCoreTable<MaintenanceRequest>('maintenance_requests', businessId);

export const usePaymentMessages = (businessId?: string) =>
  useCoreTable<PaymentMessage>('payment_messages', businessId);
export const usePaymentMessagesWithLoading = (businessId?: string) =>
  useCoreTableWithLoading<PaymentMessage>('payment_messages', businessId);

export const usePaymentMessageReceipts = (businessId?: string) =>
  useCoreTable<PaymentMessageReceipt>('payment_message_receipts', businessId);
export const usePaymentMessageReceiptsWithLoading = (businessId?: string) =>
  useCoreTableWithLoading<PaymentMessageReceipt>('payment_message_receipts', businessId);

export const useBookings = (businessId?: string) =>
  useCoreTable<Booking>('bookings', businessId);

export const usePromotions = (businessId?: string) =>
  useCoreTable<Promotion>('promotions', businessId);

export const useMessageTemplates = (businessId?: string) =>
  useCoreTable<MessageTemplate>('message_templates', businessId);

export const useSchedules = (businessId?: string) =>
  useCoreTable<Schedule>('schedules', businessId);

export const useReminderLogs = (businessId?: string) =>
  useCoreTable<ReminderLog>('reminder_logs', businessId);

export const useReceiptRefunds = (businessId?: string) =>
  useCoreTable<ReceiptRefund>('receipt_refunds', businessId);
export const useReceiptRefundsWithLoading = (businessId?: string) =>
  useCoreTableWithLoading<ReceiptRefund>('receipt_refunds', businessId);

export const useBackupLogs = (businessId?: string) =>
  useCoreTable<BackupLog>('backup_logs', businessId);

export const useApiKeys = (businessId?: string) =>
  useCoreTable<ApiKey>('api_keys', businessId);

export const useGalleryImages = (businessId?: string) =>
  useCoreTable<GalleryImage>('gallery_images', businessId);

export const useTransactions = (businessId?: string) =>
  useCoreTable<Transaction>('transactions', businessId);

// ---------------------------------------------------------------------------
// Top-level (non-business) selectors
// ---------------------------------------------------------------------------

/** Cached business metadata, including pending invitations. Not an access grant. */
export function useCachedBusinesses(): Business[] {
  return useCoreTable<Business>('businesses');
}

/** Only businesses owned by, actively shared with, or housing the current user. */
export function useBusinesses(): Business[] {
  const businesses = useCachedBusinesses();
  const shares = useBusinessShares();
  const client = useLocalClient();
  const { data: tenants } = useLiveQuery<Tenant>(client, 'tenants', {
    select: ['id', 'email', 'business_id', 'deleted'],
  });
  const { user, loading } = useAuth();
  return useMemo(
    () =>
      loading
        ? []
        : accessibleBusinesses(businesses, shares, tenants ?? [], user, OFFLINE_USER_ID),
    [businesses, shares, tenants, user, loading],
  );
}

/** Get a single business by ID (Powered by local-lite) */
export function useBusiness(id: string | undefined): Business | undefined {
  const businesses = useBusinesses();
  return useMemo(() => {
    if (!id) return undefined;
    return businesses.find(b => b.id === id);
  }, [businesses, id]);
}

/** Get all business shares (Powered by local-lite) */
export function useBusinessShares(): BusinessShare[] {
  return useCoreTable<BusinessShare>('business_shares');
}

// ---------------------------------------------------------------------------
// Store refresh
// ---------------------------------------------------------------------------

export function useStoreRefresh() {
  const client = useLocalClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (client?.syncWorker) {
        await client.syncWorker.pullRemoteChanges();
      }
    } finally {
      setRefreshing(false);
    }
  }, [client]);
  return { refreshing, onRefresh };
}

// ---------------------------------------------------------------------------
// By-ID index maps for Core Tables (Derived directly from local-lite queries)
// ---------------------------------------------------------------------------

export type IndexMap<T> = {
  get(id: string): T | undefined;
  has(id: string): boolean;
  values(): T[];
};

export function useCoreIndexMap<T extends { id: string }>(items: T[]): IndexMap<T> {
  return useMemo(() => {
    const dict = new Map<string, T>();
    for (const item of items) {
      if (item?.id) dict.set(item.id, item);
    }
    return {
      get: (id: string) => dict.get(id),
      has: (id: string) => dict.has(id),
      values: () => items,
    };
  }, [items]);
}

export function useHousesById(businessId: string | undefined): IndexMap<House> {
  const houses = useHouses(businessId);
  return useCoreIndexMap<House>(houses);
}

export function usePropertiesById(businessId: string | undefined): IndexMap<Property> {
  const properties = useProperties(businessId);
  return useCoreIndexMap<Property>(properties);
}

export function useTenantsById(businessId: string | undefined): IndexMap<Tenant> {
  const tenants = useTenants(businessId);
  return useCoreIndexMap<Tenant>(tenants);
}

export function useExpensesById(businessId: string | undefined): IndexMap<Expense> {
  const expenses = useExpenses(businessId);
  return useCoreIndexMap<Expense>(expenses);
}

export function useContractsById(businessId: string | undefined): IndexMap<Contract> {
  const contracts = useContracts(businessId);
  return useCoreIndexMap<Contract>(contracts);
}

export function useReceiptsById(businessId: string | undefined): IndexMap<Receipt> {
  const receipts = useReceipts(businessId);
  return useCoreIndexMap<Receipt>(receipts);
}

export function useBackupSchedules(businessId?: string): Schedule[] {
  const schedules = useSchedules(businessId);
  return useMemo(
    () => schedules.filter(s => s.schedule_type === 'system_backup'),
    [schedules],
  );
}

export function useReportSchedules(businessId?: string): Schedule[] {
  const schedules = useSchedules(businessId);
  return useMemo(
    () => schedules.filter(s => s.schedule_type !== 'system_backup'),
    [schedules],
  );
}

// ---------------------------------------------------------------------------
// Grouped maps (one-to-many) for Core Tables
// ---------------------------------------------------------------------------

export type GroupMap<T> = {
  get(id: string): T[] | undefined;
  has(id: string): boolean;
  values(): T[][];
};

export function useCoreGroupMap<T extends Record<string, any>>(
  items: T[],
  foreignKey: keyof T,
): GroupMap<T> {
  return useMemo(() => {
    const dict = new Map<string, T[]>();
    for (const item of items) {
      const fVal = String(item[foreignKey] || '');
      if (fVal) {
        let arr = dict.get(fVal);
        if (!arr) {
          arr = [];
          dict.set(fVal, arr);
        }
        arr.push(item);
      }
    }
    return {
      get: (id: string) => dict.get(id),
      has: (id: string) => dict.has(id),
      values: () => Array.from(dict.values()),
    };
  }, [items, foreignKey]);
}

export function useContractsByTenantId(
  businessId: string | undefined,
): GroupMap<Contract> {
  const contracts = useContracts(businessId);
  return useCoreGroupMap<Contract>(contracts, 'tenant_id');
}

export function useContractsByHouseId(
  businessId: string | undefined,
): GroupMap<Contract> {
  const contracts = useContracts(businessId);
  return useCoreGroupMap<Contract>(contracts, 'house_id');
}

export function useReceiptsByContractId(
  businessId: string | undefined,
): GroupMap<Receipt> {
  const receipts = useReceipts(businessId);
  return useCoreGroupMap<Receipt>(receipts, 'contract_id');
}

export function useReceiptsByTenantId(businessId: string | undefined): GroupMap<Receipt> {
  const receipts = useReceipts(businessId);
  return useCoreGroupMap<Receipt>(receipts, 'tenant_id');
}

export function useHousesByPropertyId(businessId: string | undefined): GroupMap<House> {
  const houses = useHouses(businessId);
  return useCoreGroupMap<House>(houses, 'property_id');
}

// ---------------------------------------------------------------------------
// Scoped Query Pushdowns (Ultra-fast index seeks for detail screens)
// ---------------------------------------------------------------------------

/**
 * Reactively queries contracts for a specific tenant pushed down to SQLite.
 * Uses index seek on tenant_id, eliminating full table scans.
 */
export function useTenantContracts(
  businessId: string | undefined,
  tenantId: string | undefined,
): Contract[] {
  const client = useLocalClient();
  const query = useMemo(() => {
    if (!tenantId) return null;
    const where: Record<string, any> = { tenant_id: tenantId };
    if (businessId) where.business_id = businessId;
    return {
      where,
      orderBy: 'created_at',
      order: 'desc' as const,
    };
  }, [businessId, tenantId]);

  const { data } = useLiveQuery<Contract>(
    client,
    'contracts',
    query ?? { where: { id: '__none__' } },
  );

  return data ?? (EMPTY_ARRAY as Contract[]);
}

/**
 * Reactively queries receipts for a specific tenant pushed down to SQLite.
 * Uses index seek on tenant_id, eliminating full table scans.
 */
export function useTenantReceipts(
  businessId: string | undefined,
  tenantId: string | undefined,
): Receipt[] {
  const client = useLocalClient();
  const query = useMemo(() => {
    if (!tenantId) return null;
    const where: Record<string, any> = { tenant_id: tenantId };
    if (businessId) where.business_id = businessId;
    return {
      where,
      orderBy: 'payment_date',
      order: 'desc' as const,
    };
  }, [businessId, tenantId]);

  const { data } = useLiveQuery<Receipt>(
    client,
    'receipts',
    query ?? { where: { id: '__none__' } },
  );

  return data ?? (EMPTY_ARRAY as Receipt[]);
}

/**
 * Reactively queries receipts for a specific contract pushed down to SQLite.
 */
export function useContractReceipts(
  businessId: string | undefined,
  contractId: string | undefined,
): Receipt[] {
  const client = useLocalClient();
  const query = useMemo(() => {
    if (!contractId) return null;
    const where: Record<string, any> = { contract_id: contractId };
    if (businessId) where.business_id = businessId;
    return {
      where,
      orderBy: 'payment_date',
      order: 'desc' as const,
    };
  }, [businessId, contractId]);

  const { data } = useLiveQuery<Receipt>(
    client,
    'receipts',
    query ?? { where: { id: '__none__' } },
  );

  return data ?? (EMPTY_ARRAY as Receipt[]);
}

/**
 * Reactively queries houses for a specific property pushed down to SQLite.
 */
export function usePropertyHouses(
  businessId: string | undefined,
  propertyId: string | undefined,
): House[] {
  const client = useLocalClient();
  const query = useMemo(() => {
    if (!propertyId) return null;
    const where: Record<string, any> = { property_id: propertyId };
    if (businessId) where.business_id = businessId;
    return {
      where,
      orderBy: 'house_number',
      order: 'asc' as const,
    };
  }, [businessId, propertyId]);

  const { data } = useLiveQuery<House>(
    client,
    'houses',
    query ?? { where: { id: '__none__' } },
  );

  return data ?? (EMPTY_ARRAY as House[]);
}

// ---------------------------------------------------------------------------
// Direct Mutation API for Core Tables (Simple insert, update, delete)
// ---------------------------------------------------------------------------

export const useCoreMutations = () => useMutations<CoreTableName>(useLocalClient());

// ---------------------------------------------------------------------------
// Profile selectors
// ---------------------------------------------------------------------------

/** Get all profiles */
export function useProfiles(): Profile[] {
  return useCoreTable<Profile>('profiles');
}

/** Get a single profile by User ID using point read-through lookup */
export function useProfile(userId: string | undefined | null): Profile | undefined {
  const client = useLocalClient();
  const query = useMemo(() => {
    if (!userId) return null;
    return {
      where: { id: userId },
      limit: 1,
    };
  }, [userId]);

  const { data } = useLiveQuery<Profile>(
    client,
    'profiles',
    query ?? { where: { id: '__none__' } },
  );

  return data && data.length > 0 ? data[0] : undefined;
}

/** Get a single profile by Email using indexed point lookup */
export function useProfileByEmail(email: string | undefined | null): Profile | undefined {
  const client = useLocalClient();
  const lower = email ? email.toLowerCase() : '';
  const query = useMemo(() => {
    if (!lower) return null;
    return {
      where: { email: lower },
      limit: 1,
    };
  }, [lower]);

  const { data } = useLiveQuery<Profile>(
    client,
    'profiles',
    query ?? { where: { id: '__none__' } },
  );

  return data && data.length > 0 ? data[0] : undefined;
}

// ---------------------------------------------------------------------------
// Re-export types
// ---------------------------------------------------------------------------
export type {
  ApiKey,
  BackupLog,
  Booking,
  Business,
  BusinessShare,
  Contract,
  Expense,
  GalleryImage,
  House,
  MaintenanceRequest,
  MessageTemplate,
  PaymentMessage,
  PaymentMessageReceipt,
  Profile,
  Promotion,
  Property,
  Receipt,
  ReceiptRefund,
  ReminderLog,
  Schedule,
  Setting,
  Tenant,
  Transaction,
} from '@/shared/types/types';
