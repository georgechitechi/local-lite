import type { LocalFirstClient } from 'local-lite';
import { useCoalescedRunner } from 'local-lite/react';
import { useCallback, useEffect, useState } from 'react';
import type { ExpiringContract } from '@/features/contracts/components/ExpiringContractsCard';
import { isCommissionedAsOf } from '@/features/reports/utils/helpers';
import {
  calculateCollectionRate,
  calculateGrowthPercentage,
  calculateNetProfit,
  calculateOccupancyRate,
  computeNetReceipt as computeNet,
  isDateInRange,
} from '@/shared/utils/financialCalculations';
import {
  isActiveContractStatus,
  isActiveTenantStatus,
  isFormerTenantStatus,
} from '@/shared/utils/statusHelper';

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
  const currentMonthEnd = new Date(currentYear, currentMonth, 0)
    .toISOString()
    .split('T')[0];
  const lastMonthStart = `${lastMonthYear}-${pad(lastMonth)}-01`;
  const lastMonthEnd = new Date(lastMonthYear, lastMonth, 0).toISOString().split('T')[0];
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;

  const thirtyDaysStr = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  const todayStr = now.toISOString().split('T')[0];

  const [[housesRow], [contractsRow], [expiringRow], [receiptsRow], [expensesRow]] =
    await Promise.all([
      client.query<{ total_rooms: number; maintenance_rooms: number }>(
        `SELECT 
         COUNT(*) AS total_rooms,
         COALESCE(SUM(CASE WHEN "status" = 'maintenance' THEN 1 ELSE 0 END), 0) AS maintenance_rooms
       FROM "houses"
       WHERE "business_id" = ? AND ("deleted" IS NULL OR "deleted" != 1);`,
        [businessId],
      ),
      client.query<{
        occupied_rooms: number;
        active_tenants: number;
        projected_revenue: number;
      }>(
        `SELECT 
         COUNT(DISTINCT "house_id") AS occupied_rooms,
         COUNT(DISTINCT "tenant_id") AS active_tenants,
         COALESCE(SUM("rent_amount"), 0) AS projected_revenue
       FROM "contracts"
       WHERE "business_id" = ? 
         AND "status" = 'ACTIVE' 
         AND "start_date" <= ? 
         AND ("end_date" IS NULL OR "end_date" >= ?)
         AND ("deleted" IS NULL OR "deleted" != 1);`,
        [businessId, todayStr, currentMonthStart],
      ),
      client.query<{ expiring_contracts: number }>(
        `SELECT COUNT(*) AS expiring_contracts
       FROM "contracts"
       WHERE "business_id" = ?
         AND ("status" = 'ACTIVE' OR "status" = 'expiring_soon')
         AND "end_date" >= ? AND "end_date" <= ?
         AND ("deleted" IS NULL OR "deleted" != 1);`,
        [businessId, todayStr, thirtyDaysStr],
      ),
      client.query<{
        monthly_revenue: number;
        last_month_revenue: number;
        annual_revenue: number;
        total_revenue: number;
      }>(
        `SELECT 
         COALESCE(SUM(CASE WHEN "payment_date" >= ? AND "payment_date" <= ? THEN "amount" - "refunded_amount" ELSE 0 END), 0) AS monthly_revenue,
         COALESCE(SUM(CASE WHEN "payment_date" >= ? AND "payment_date" <= ? THEN "amount" - "refunded_amount" ELSE 0 END), 0) AS last_month_revenue,
         COALESCE(SUM(CASE WHEN "payment_date" >= ? AND "payment_date" <= ? THEN "amount" - "refunded_amount" ELSE 0 END), 0) AS annual_revenue,
         COALESCE(SUM("amount" - "refunded_amount"), 0) AS total_revenue
       FROM "receipts"
       WHERE "business_id" = ? 
         AND "payment_method" != 'promo' AND "type" != 'promo'
         AND ("deleted" IS NULL OR "deleted" != 1);`,
        [
          currentMonthStart,
          currentMonthEnd,
          lastMonthStart,
          lastMonthEnd,
          yearStart,
          yearEnd,
          businessId,
        ],
      ),
      client.query<{
        monthly_expenses: number;
        last_month_expenses: number;
        annual_expenses: number;
        total_expenses: number;
      }>(
        `SELECT 
         COALESCE(SUM(CASE WHEN "date" >= ? AND "date" <= ? THEN "amount" ELSE 0 END), 0) AS monthly_expenses,
         COALESCE(SUM(CASE WHEN "date" >= ? AND "date" <= ? THEN "amount" ELSE 0 END), 0) AS last_month_expenses,
         COALESCE(SUM(CASE WHEN "date" >= ? AND "date" <= ? THEN "amount" ELSE 0 END), 0) AS annual_expenses,
         COALESCE(SUM("amount"), 0) AS total_expenses
       FROM "expenses"
       WHERE "business_id" = ? 
         AND ("deleted" IS NULL OR "deleted" != 1);`,
        [
          currentMonthStart,
          currentMonthEnd,
          lastMonthStart,
          lastMonthEnd,
          yearStart,
          yearEnd,
          businessId,
        ],
      ),
    ]);

  const totalRooms = Number(housesRow?.total_rooms) || 0;
  const maintenanceRooms = Number(housesRow?.maintenance_rooms) || 0;
  const occupiedRooms = Number(contractsRow?.occupied_rooms) || 0;
  const vacantRooms = Math.max(0, totalRooms - occupiedRooms);
  const activeTenants = Number(contractsRow?.active_tenants) || 0;
  const projectedRevenue = Number(contractsRow?.projected_revenue) || 0;
  const expiringContracts = Number(expiringRow?.expiring_contracts) || 0;

  const monthlyRevenue = Number(receiptsRow?.monthly_revenue) || 0;
  const lastMonthRevenue = Number(receiptsRow?.last_month_revenue) || 0;
  const annualRevenue = Number(receiptsRow?.annual_revenue) || 0;
  const totalRevenue = Number(receiptsRow?.total_revenue) || 0;

  const monthlyExpenses = Number(expensesRow?.monthly_expenses) || 0;
  const lastMonthExpenses = Number(expensesRow?.last_month_expenses) || 0;
  const annualExpenses = Number(expensesRow?.annual_expenses) || 0;
  const totalExpenses = Number(expensesRow?.total_expenses) || 0;

  const revenueGrowth = calculateGrowthPercentage(monthlyRevenue, lastMonthRevenue);
  const expenseGrowth = calculateGrowthPercentage(monthlyExpenses, lastMonthExpenses);

  const rentableRooms = totalRooms - maintenanceRooms;
  const occupancyRate = calculateOccupancyRate(occupiedRooms, rentableRooms);
  const rentCollectionRate = calculateCollectionRate(monthlyRevenue, projectedRevenue);

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
    if (!client || !businessId) {
      setLoading(false);
      return;
    }
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
    if (!client || !businessId) {
      setLoading(false);
      return;
    }
    fetchContracts();
    const unsubs = ['contracts', 'houses', 'tenants'].map(t =>
      client.events.on(t, schedule),
    );
    return () => unsubs.forEach(u => u());
  }, [client, businessId, fetchContracts, schedule]);

  return { contracts, loading };
}

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

  const inRange = (dateStr: string) => isDateInRange(dateStr, startD, endD, allTime);

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
        occupancy_rate: calculateOccupancyRate(pOccupied, pHouses.length),
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
        occupancy_rate: calculateOccupancyRate(occupiedHouses, totalHouses),
        total_revenue: totalRevenue,
        total_gross_revenue: totalGrossRevenue,
        total_expenses: totalExpenses,
        net_profit: calculateNetProfit(totalRevenue, totalExpenses),
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
