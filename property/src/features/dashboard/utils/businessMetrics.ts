import type { LocalFirstClient } from 'local-lite';
import { useCoalescedRunner } from 'local-lite/react';
import { useCallback, useEffect, useState } from 'react';
import type { ExpiringContract } from '@/features/contracts/components/ExpiringContractsCard';
import { isCommissionedAsOf } from '@/features/reports/utils/helpers';
import { parseMetadata, safeParseJSON } from '@/shared/utils/helper';
import {
  isActiveContractStatus,
  isActiveTenantStatus,
  isFormerTenantStatus,
} from '@/shared/utils/statusHelper';

function computeNet(receipt: any): number {
  const amount = parseFloat(String(receipt?.amount || 0));
  const refunded = parseFloat(String(receipt?.refunded_amount || 0));
  return Math.max(0, amount - refunded);
}

export interface DashboardStats {
  totalRooms: number;
  occupiedRooms: number;
  vacantRooms: number;
  totalTenants: number;
  totalRevenue: number;
  monthlyRevenue: number;
  occupancyRate: number;
  projectedRevenue: number;
  rentCollectionRate: number;
  lastMonthRevenue: number;
  revenueGrowth: number;
  annualRevenue: number;
  activeTenants: number;
  totalExpenses: number;
  monthlyExpenses: number;
  lastMonthExpenses: number;
  expenseGrowth: number;
  annualExpenses: number;
  expiringContracts: number;
}

interface BusinessData {
  properties: any[];
  houses: any[];
  tenants: any[];
  contracts: any[];
  receipts: any[];
  expenses: any[];
  maintenanceRequests?: any[];
}

export const DEFAULT_DASHBOARD_STATS: DashboardStats = {
  totalRooms: 0,
  occupiedRooms: 0,
  vacantRooms: 0,
  totalTenants: 0,
  totalRevenue: 0,
  monthlyRevenue: 0,
  occupancyRate: 0,
  projectedRevenue: 0,
  rentCollectionRate: 0,
  lastMonthRevenue: 0,
  revenueGrowth: 0,
  annualRevenue: 0,
  activeTenants: 0,
  totalExpenses: 0,
  monthlyExpenses: 0,
  lastMonthExpenses: 0,
  expenseGrowth: 0,
  annualExpenses: 0,
  expiringContracts: 0,
};

export async function fetchDashboardStatsFromDB(
  client: LocalFirstClient,
  businessId: string,
): Promise<DashboardStats> {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

  const pad = (n: number) => String(n).padStart(2, '0');
  const currentMonthStart = `${currentYear}-${pad(currentMonth)}-01`;
  const currentMonthEnd = new Date(currentYear, currentMonth, 0).toISOString().split('T')[0];
  const lastMonthStart = `${lastMonthYear}-${pad(lastMonth)}-01`;
  const lastMonthEnd = new Date(lastMonthYear, lastMonth, 0).toISOString().split('T')[0];
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;

  const thirtyDaysStr = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  const todayStr = now.toISOString().split('T')[0];

  const [
    [housesCount],
    [occupiedCount],
    [maintenanceCount],
    [activeTenantsCount],
    [monthlyRevRow],
    [lastMonthRevRow],
    [annualRevRow],
    [totalRevRow],
    [monthlyExpRow],
    [lastMonthExpRow],
    [annualExpRow],
    [totalExpRow],
    [expiringCount],
    [projectedRevRow],
  ] = await Promise.all([
    client.query<{ total: number }>(
      'SELECT COUNT(*) AS total FROM "houses" WHERE "business_id" = ? AND ("deleted" IS NULL OR "deleted" != 1);',
      [businessId],
    ),
    client.query<{ total: number }>(
      `SELECT COUNT(DISTINCT "house_id") AS total 
       FROM "contracts" 
       WHERE "business_id" = ? 
         AND "status" = 'ACTIVE' 
         AND "start_date" <= ? 
         AND ("end_date" IS NULL OR "end_date" >= ?)
         AND ("deleted" IS NULL OR "deleted" != 1);`,
      [businessId, todayStr, currentMonthStart],
    ),
    client.query<{ total: number }>(
      'SELECT COUNT(*) AS total FROM "houses" WHERE "business_id" = ? AND "status" = \'maintenance\' AND ("deleted" IS NULL OR "deleted" != 1);',
      [businessId],
    ),
    client.query<{ total: number }>(
      `SELECT COUNT(DISTINCT "tenant_id") AS total 
       FROM "contracts" 
       WHERE "business_id" = ? 
         AND "status" = 'ACTIVE' 
         AND "start_date" <= ? 
         AND ("end_date" IS NULL OR "end_date" >= ?)
         AND "tenant_id" IS NOT NULL
         AND ("deleted" IS NULL OR "deleted" != 1);`,
      [businessId, todayStr, currentMonthStart],
    ),
    client.query<{ total: number }>(
      `SELECT COALESCE(SUM("amount" - "refunded_amount"), 0) AS total 
       FROM "receipts" 
       WHERE "business_id" = ? 
         AND "payment_date" >= ? AND "payment_date" <= ?
         AND "payment_method" != 'promo' AND "type" != 'promo'
         AND ("deleted" IS NULL OR "deleted" != 1);`,
      [businessId, currentMonthStart, currentMonthEnd],
    ),
    client.query<{ total: number }>(
      `SELECT COALESCE(SUM("amount" - "refunded_amount"), 0) AS total 
       FROM "receipts" 
       WHERE "business_id" = ? 
         AND "payment_date" >= ? AND "payment_date" <= ?
         AND "payment_method" != 'promo' AND "type" != 'promo'
         AND ("deleted" IS NULL OR "deleted" != 1);`,
      [businessId, lastMonthStart, lastMonthEnd],
    ),
    client.query<{ total: number }>(
      `SELECT COALESCE(SUM("amount" - "refunded_amount"), 0) AS total 
       FROM "receipts" 
       WHERE "business_id" = ? 
         AND "payment_date" >= ? AND "payment_date" <= ?
         AND "payment_method" != 'promo' AND "type" != 'promo'
         AND ("deleted" IS NULL OR "deleted" != 1);`,
      [businessId, yearStart, yearEnd],
    ),
    client.query<{ total: number }>(
      `SELECT COALESCE(SUM("amount" - "refunded_amount"), 0) AS total 
       FROM "receipts" 
       WHERE "business_id" = ? 
         AND "payment_method" != 'promo' AND "type" != 'promo'
         AND ("deleted" IS NULL OR "deleted" != 1);`,
      [businessId],
    ),
    client.query<{ total: number }>(
      `SELECT COALESCE(SUM("amount"), 0) AS total 
       FROM "expenses" 
       WHERE "business_id" = ? 
         AND "date" >= ? AND "date" <= ?
         AND ("deleted" IS NULL OR "deleted" != 1);`,
      [businessId, currentMonthStart, currentMonthEnd],
    ),
    client.query<{ total: number }>(
      `SELECT COALESCE(SUM("amount"), 0) AS total 
       FROM "expenses" 
       WHERE "business_id" = ? 
         AND "date" >= ? AND "date" <= ?
         AND ("deleted" IS NULL OR "deleted" != 1);`,
      [businessId, lastMonthStart, lastMonthEnd],
    ),
    client.query<{ total: number }>(
      `SELECT COALESCE(SUM("amount"), 0) AS total 
       FROM "expenses" 
       WHERE "business_id" = ? 
         AND "date" >= ? AND "date" <= ?
         AND ("deleted" IS NULL OR "deleted" != 1);`,
      [businessId, yearStart, yearEnd],
    ),
    client.query<{ total: number }>(
      `SELECT COALESCE(SUM("amount"), 0) AS total 
       FROM "expenses" 
       WHERE "business_id" = ? 
         AND ("deleted" IS NULL OR "deleted" != 1);`,
      [businessId],
    ),
    client.query<{ total: number }>(
      `SELECT COUNT(*) AS total 
       FROM "contracts" 
       WHERE "business_id" = ? 
         AND ("status" = 'ACTIVE' OR "status" = 'expiring_soon')
         AND "end_date" >= ? AND "end_date" <= ?
         AND ("deleted" IS NULL OR "deleted" != 1);`,
      [businessId, todayStr, thirtyDaysStr],
    ),
    client.query<{ total: number }>(
      `SELECT COALESCE(SUM("rent_amount"), 0) AS total 
       FROM "contracts" 
       WHERE "business_id" = ? 
         AND "status" = 'ACTIVE' 
         AND "start_date" <= ? 
         AND ("end_date" IS NULL OR "end_date" >= ?)
         AND ("deleted" IS NULL OR "deleted" != 1);`,
      [businessId, todayStr, currentMonthStart],
    ),
  ]);

  const totalRooms = Number(housesCount?.total) || 0;
  const occupiedRooms = Number(occupiedCount?.total) || 0;
  const maintenanceRooms = Number(maintenanceCount?.total) || 0;
  const vacantRooms = Math.max(0, totalRooms - occupiedRooms);
  const activeTenants = Number(activeTenantsCount?.total) || 0;

  const monthlyRevenue = Number(monthlyRevRow?.total) || 0;
  const lastMonthRevenue = Number(lastMonthRevRow?.total) || 0;
  const annualRevenue = Number(annualRevRow?.total) || 0;
  const totalRevenue = Number(totalRevRow?.total) || 0;

  const monthlyExpenses = Number(monthlyExpRow?.total) || 0;
  const lastMonthExpenses = Number(lastMonthExpRow?.total) || 0;
  const annualExpenses = Number(annualExpRow?.total) || 0;
  const totalExpenses = Number(totalExpRow?.total) || 0;

  const expiringContracts = Number(expiringCount?.total) || 0;
  const projectedRevenue = Number(projectedRevRow?.total) || 0;

  const revenueGrowth = lastMonthRevenue
    ? ((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
    : 0;

  const expenseGrowth = lastMonthExpenses
    ? ((monthlyExpenses - lastMonthExpenses) / lastMonthExpenses) * 100
    : 0;

  const rentableRooms = totalRooms - maintenanceRooms;
  const occupancyRate = rentableRooms > 0 ? (occupiedRooms / rentableRooms) * 100 : 0;
  const rentCollectionRate = projectedRevenue > 0 ? (monthlyRevenue / projectedRevenue) * 100 : 0;

  return {
    totalRooms,
    occupiedRooms,
    vacantRooms,
    totalTenants: activeTenants,
    totalRevenue,
    monthlyRevenue,
    occupancyRate,
    projectedRevenue,
    rentCollectionRate,
    lastMonthRevenue,
    revenueGrowth,
    annualRevenue,
    activeTenants,
    totalExpenses,
    monthlyExpenses,
    lastMonthExpenses,
    expenseGrowth,
    annualExpenses,
    expiringContracts,
  };
}

export function useLiveDashboardStats(
  client: LocalFirstClient | null | undefined,
  businessId: string | undefined | null,
): { stats: DashboardStats; loading: boolean; refetch: () => Promise<void> } {
  const [stats, setStats] = useState<DashboardStats>(() => DEFAULT_DASHBOARD_STATS);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!client || !businessId) {
      setStats(DEFAULT_DASHBOARD_STATS);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchDashboardStatsFromDB(client, businessId);
      setStats(data);
    } catch (err) {
      console.error('Error fetching dashboard stats from SQLite:', err);
    } finally {
      setLoading(false);
    }
  }, [client, businessId]);

  const scheduleFetch = useCoalescedRunner(fetchStats);

  useEffect(() => {
    if (!client || !businessId) return;
    fetchStats();
    const tables = ['receipts', 'expenses', 'contracts', 'houses'];
    const unsubs = tables.map(t => client.events.on(t, scheduleFetch));
    return () => {
      unsubs.forEach(u => u());
    };
  }, [client, businessId, fetchStats, scheduleFetch]);

  return { stats, loading, refetch: fetchStats };
}

export async function fetchExpiringContractsFromDB(
  client: LocalFirstClient,
  businessId: string,
): Promise<ExpiringContract[]> {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const thirtyDaysStr = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  const rows = await client
    .from('contracts')
    .leftJoin('houses', 'houses.id', 'contracts.house_id')
    .leftJoin('properties', 'properties.id', 'houses.property_id')
    .leftJoin('tenants', 'tenants.id', 'contracts.tenant_id')
    .where('contracts.business_id', '=', businessId)
    .where('contracts.status', '=', 'ACTIVE')
    .where('contracts.end_date', '>=', todayStr)
    .where('contracts.end_date', '<=', thirtyDaysStr)
    .select([
      'contracts.id AS id',
      'contracts.end_date AS end_date',
      'houses.house_number AS house_number',
      'properties.name AS property_name',
      'tenants.name AS tenant_name',
    ])
    .orderBy('contracts.end_date', 'ASC')
    .execute();

  return rows.map((r: any) => {
    const endDate = new Date(r.end_date);
    const daysRemaining = Math.ceil(
      (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    return {
      id: r.id,
      tenant_name: r.tenant_name || 'Unknown',
      property_name: r.property_name || 'Unknown Property',
      house_number: r.house_number || 'N/A',
      end_date: r.end_date,
      days_remaining: daysRemaining,
    };
  });
}

export function useLiveExpiringContracts(
  client: LocalFirstClient | null | undefined,
  businessId: string | undefined | null,
): { contracts: ExpiringContract[]; loading: boolean } {
  const [contracts, setContracts] = useState<ExpiringContract[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchContracts = useCallback(async () => {
    if (!client || !businessId) {
      setContracts([]);
      setLoading(false);
      return;
    }
    try {
      const list = await fetchExpiringContractsFromDB(client, businessId);
      setContracts(list);
    } catch (err) {
      console.error('Error fetching expiring contracts from SQLite:', err);
    } finally {
      setLoading(false);
    }
  }, [client, businessId]);

  const schedule = useCoalescedRunner(fetchContracts);

  useEffect(() => {
    if (!client || !businessId) return;
    fetchContracts();
    const unsubs = ['contracts', 'houses', 'tenants'].map(t => client.events.on(t, schedule));
    return () => unsubs.forEach(u => u());
  }, [client, businessId, fetchContracts, schedule]);

  return { contracts, loading };
}

export const calculateDashboardStats = (data: BusinessData): DashboardStats => {
  const { houses: rawHouses, tenants, contracts, receipts, expenses, properties } = data;
  const currentDate = new Date();

  const houses = rawHouses.filter(h => {
    const property = properties.find(p => p.id === h.property_id);
    return isCommissionedAsOf({ ...h, property }, currentDate);
  });

  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

  // Basic Stats
  const totalRooms = houses.length;

  // Active Tenants
  const monthStart = new Date(currentYear, currentMonth - 1, 1);
  const monthEnd = new Date(currentYear, currentMonth, 0);

  // Pre-process contracts in a single O(C) loop to build indices & stats
  const activeContractsByHouse = new Map<string, (typeof contracts)[0]>();
  const activeTenantIds = new Set<string>();
  let projectedRevenue = 0;

  contracts.forEach(c => {
    // 1. Build occupancy index for houses (using current local time)
    const isCurrentlyActive =
      isActiveContractStatus(c.status) && new Date(c.start_date) <= currentDate;
    if (isCurrentlyActive) {
      activeContractsByHouse.set(c.house_id, c);
    }

    // 2. Check active state and breaks for the target month
    const isActiveForMonth =
      isActiveContractStatus(c.status) &&
      new Date(c.start_date) <= currentDate &&
      (!c.end_date || new Date(c.end_date) >= monthStart);
    if (!isActiveForMonth) return;

    const { breaks } = parseMetadata(c.metadata);
    const isOnBreak = breaks.some((b: any) => {
      const bStart = new Date(b.start_date);
      const bEnd =
        !b.end_date || String(b.end_date).includes('2099')
          ? new Date(2099, 11, 31)
          : new Date(b.end_date);
      return bStart <= monthEnd && bEnd >= monthStart;
    });

    if (!isOnBreak) {
      projectedRevenue += parseFloat(String(c.rent_amount)) || 0;
      if (c.tenant_id) {
        activeTenantIds.add(c.tenant_id);
      }
    }
  });

  const getHouseStatus = (houseId: string) => {
    return activeContractsByHouse.has(houseId) ? 'occupied' : 'vacant';
  };

  const occupiedRooms = houses.filter(h => getHouseStatus(h.id) === 'occupied').length;
  const maintenanceRooms = houses.filter(h => h.status === 'maintenance').length;
  const activeTenantsList = tenants.filter(t => activeTenantIds.has(t.id));
  const activeTenants = activeTenantsList.length;

  const currentMonthReceipts = receipts.filter(r => {
    const { month, year } = safeParseJSON(r.payment_period, { month: 0, year: 0 });
    return (
      month === currentMonth &&
      year === currentYear &&
      r.payment_method !== 'promo' &&
      r.type !== 'promo'
    );
  });

  const lastMonthReceipts = receipts.filter(r => {
    const { month, year } = safeParseJSON(r.payment_period, { month: 0, year: 0 });
    return (
      month === lastMonth &&
      year === lastMonthYear &&
      r.payment_method !== 'promo' &&
      r.type !== 'promo'
    );
  });

  const annualReceipts = receipts.filter(r => {
    const { year } = safeParseJSON(r.payment_period, { month: 0, year: 0 });
    return year === currentYear && r.payment_method !== 'promo' && r.type !== 'promo';
  });

  const monthlyRevenue = currentMonthReceipts.reduce((sum, r) => sum + computeNet(r), 0);
  const lastMonthRevenue = lastMonthReceipts.reduce((sum, r) => sum + computeNet(r), 0);
  const revenueGrowth = lastMonthRevenue
    ? ((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
    : 0;
  const annualRevenue = annualReceipts.reduce((sum, r) => sum + computeNet(r), 0);

  const occupancyRate =
    totalRooms - maintenanceRooms > 0
      ? (occupiedRooms / (totalRooms - maintenanceRooms)) * 100
      : 0;

  const expectedPayments = activeTenants;
  const actualPayments = new Set(
    currentMonthReceipts.map(r => r.contract_id || r.tenant_id).filter(Boolean),
  ).size;
  const rentCollectionRate = expectedPayments
    ? (actualPayments / expectedPayments) * 100
    : 0;

  const currentMonthExpenses = expenses.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() + 1 === currentMonth && d.getFullYear() === currentYear;
  });
  const lastMonthExpensesTotal = expenses
    .filter(e => {
      const d = new Date(e.date);
      return d.getMonth() + 1 === lastMonth && d.getFullYear() === lastMonthYear;
    })
    .reduce((sum, e) => sum + parseFloat(String(e.amount || 0)), 0);

  const monthlyExpenses = currentMonthExpenses.reduce(
    (sum, e) => sum + parseFloat(String(e.amount || 0)),
    0,
  );
  const expenseGrowth = lastMonthExpensesTotal
    ? ((monthlyExpenses - lastMonthExpensesTotal) / lastMonthExpensesTotal) * 100
    : 0;
  const annualExpensesRecords = expenses.filter(e => {
    const d = new Date(e.date);
    return d.getFullYear() === currentYear;
  });
  const annualExpenses = annualExpensesRecords.reduce(
    (sum, e) => sum + parseFloat(String(e.amount || 0)),
    0,
  );

  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  const expiringContracts = contracts.filter(c => {
    if (c.status !== 'active' && c.status !== 'expiring_soon') return false;
    if (!c.end_date) return false;
    const endDate = new Date(c.end_date);
    return endDate <= thirtyDaysFromNow && endDate >= new Date();
  }).length;

  return {
    totalRooms,
    occupiedRooms,
    vacantRooms: houses.filter(
      h => getHouseStatus(h.id) === 'vacant' && h.status !== 'maintenance',
    ).length,
    totalTenants: tenants.length,
    activeTenants,
    totalRevenue: annualRevenue,
    monthlyRevenue,
    lastMonthRevenue,
    revenueGrowth,
    annualRevenue,
    occupancyRate,
    projectedRevenue,
    rentCollectionRate,
    totalExpenses: annualExpenses,
    monthlyExpenses,
    lastMonthExpenses: lastMonthExpensesTotal,
    expenseGrowth,
    annualExpenses,
    expiringContracts,
  };
};

export const calculateBusinessOverview = (
  data: BusinessData,
  options: {
    startDate: string | Date;
    endDate: string | Date;
    allTime?: boolean;
    isYTD?: boolean;
  },
) => {
  const {
    properties,
    houses,
    tenants,
    contracts,
    receipts,
    expenses,
    maintenanceRequests = [],
  } = data;
  const allTime = options.allTime;
  const isYTD = options.isYTD;
  const startD = new Date(options.startDate);
  const endD = new Date(options.endDate);

  const inRange = (dateStr: string) => {
    if (allTime) return true;
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    const start = new Date(startD);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endD);
    end.setHours(23, 59, 59, 999);
    return d >= start && d <= end;
  };

  const periodLabel = allTime
    ? 'All Time'
    : isYTD
      ? `Year to Date (${endD.getFullYear()})`
      : `${startD.toLocaleDateString()} - ${endD.toLocaleDateString()}`;

  const commissionedHouses = houses.filter(h => {
    const property = properties.find(p => p.id === h.property_id);
    return isCommissionedAsOf({ ...h, property }, endD);
  });

  const totalHouses = commissionedHouses.length;
  const occupiedHouses = commissionedHouses.filter(h =>
    contracts.some(c => c.house_id === h.id && isActiveContractStatus(c.status)),
  ).length;

  const pReceipts = receipts.filter(r => r.payment_date && inRange(r.payment_date));
  const pExpenses = expenses.filter(e => e.date && inRange(e.date));

  const totalRevenue = pReceipts.reduce((s, r) => {
    if (r.status === 'promo') return s;
    return s + computeNet(r);
  }, 0);

  const totalGrossRevenue = pReceipts.reduce((s, r) => {
    if (r.status === 'promo') return s;
    return s + parseFloat(String(r.amount || 0));
  }, 0);

  const totalExpenses = pExpenses.reduce(
    (s, e) => s + parseFloat(String(e.amount || 0)),
    0,
  );

  const propertyStats = properties
    .map(p => {
      const pHouses = commissionedHouses.filter(h => h.property_id === p.id);
      const pOccupied = pHouses.filter(h =>
        contracts.some(c => c.house_id === h.id && isActiveContractStatus(c.status)),
      ).length;

      const pReceiptsLocal = pReceipts.filter(r => {
        const contract = contracts.find(c => c.id === r.contract_id);
        const house = houses.find(h => h.id === contract?.house_id);
        return house?.property_id === p.id;
      });

      const pRevenue = pReceiptsLocal.reduce((s, r) => {
        if (r.status === 'promo') return s;
        return s + computeNet(r);
      }, 0);

      return {
        name: p.name,
        total_houses: pHouses.length,
        occupied_houses: pOccupied,
        available_houses: pHouses.length - pOccupied,
        occupancy_rate: pHouses.length > 0 ? (pOccupied / pHouses.length) * 100 : 0,
        revenue: pRevenue,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const next30Days = new Date();
  next30Days.setDate(next30Days.getDate() + 30);
  const expiringSoonCount = contracts.filter(c => {
    if (!isActiveContractStatus(c.status) || !c.end_date) return false;
    const expiry = new Date(c.end_date);
    return expiry >= new Date() && expiry <= next30Days;
  }).length;

  const tenantStats = {
    active: tenants.filter(t => isActiveTenantStatus(t.status)).length,
    pending: tenants.filter(t => t.status === 'pending').length,
    former: tenants.filter(t => isFormerTenantStatus(t.status)).length,
  };

  const expenseMap: Record<string, number> = {};
  pExpenses.forEach(e => {
    const cat = e.category || 'Other';
    expenseMap[cat] = (expenseMap[cat] || 0) + parseFloat(String(e.amount || 0));
  });
  const topExpenses = Object.entries(expenseMap)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const paymentMap: Record<string, number> = {};
  pReceipts.forEach(r => {
    if (r.status === 'promo') return;
    const method = r.payment_method || 'Other';
    paymentMap[method] = (paymentMap[method] || 0) + computeNet(r);
  });
  const paymentStats = Object.entries(paymentMap)
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount);

  const maintenanceStats = {
    open: maintenanceRequests.filter(
      m => m.status === 'pending' && inRange(m.created_at || ''),
    ).length,
    in_progress: maintenanceRequests.filter(
      m => m.status === 'in_progress' && inRange(m.created_at || ''),
    ).length,
    completed: maintenanceRequests.filter(
      m => m.status === 'completed' && inRange(m.created_at || ''),
    ).length,
  };

  const houseTypeMap: Record<string, number> = {};
  commissionedHouses.forEach(h => {
    const type = h.type || 'Standard';
    houseTypeMap[type] = (houseTypeMap[type] || 0) + 1;
  });
  const houseTypeStats = Object.entries(houseTypeMap)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return [
    {
      period: periodLabel,
      summary: {
        total_houses: totalHouses,
        occupied_houses: occupiedHouses,
        occupancy_rate: totalHouses > 0 ? (occupiedHouses / totalHouses) * 100 : 0,
        total_revenue: totalRevenue,
        total_gross_revenue: totalGrossRevenue,
        total_expenses: totalExpenses,
        net_profit: totalRevenue - totalExpenses,
        expiring_soon: expiringSoonCount,
      },
      properties: propertyStats,
      tenants: tenantStats,
      topExpenses,
      paymentStats,
      maintenance: maintenanceStats,
      houseTypes: houseTypeStats,
    },
  ];
};
