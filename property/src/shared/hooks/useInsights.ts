import { useMemo } from 'react';
import {
  calculateEffectiveRent,
  parseMetadata,
  safeParseJSON,
} from '@/shared/utils/helper';
import {
  isActiveContractStatus,
  isActiveTenantStatus,
} from '@/shared/utils/statusHelper';
import { useCurrency } from './useCurrency';

export interface Insight {
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  action?: string;
  actionParams?: Record<string, any>;
  isAdminOnly?: boolean;
}

export function useInsights(
  businessId: string | undefined,
  data: {
    receipts: any[];
    expenses: any[];
    houses: any[];
    contracts: any[];
    tenants: any[];
    /** Pre-built map from local-lite queries — avoids O(n) rebuild inside useMemo */
    contractsByTenantId?:
      | { get: (id: string) => any[] | undefined }
      | Record<string, any[]>;
  },
) {
  useCurrency(businessId);

  return useMemo(() => {
    if (!businessId) return [];

    const insights: Insight[] = [];
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // 1. Occupancy Insight (Excluding those on break)
    const monthStart = new Date(currentYear, currentMonth - 1, 1);

    const activeContracts = data.contracts.filter(c => {
      const isActive =
        isActiveContractStatus(c.status) &&
        new Date(c.start_date) <= now &&
        (!c.end_date || new Date(c.end_date) >= monthStart);
      if (!isActive) return false;

      const { breaks } = parseMetadata(c.metadata);
      const { isOnFullBreak } = calculateEffectiveRent(
        parseFloat(String(c.rent_amount || 0)),
        currentMonth,
        currentYear,
        breaks,
      );

      return !isOnFullBreak;
    });

    const occupancyRate = data.houses.length
      ? (activeContracts.length / data.houses.length) * 100
      : 0;

    if (occupancyRate < 70 && data.houses.length > 0) {
      insights.push({
        type: 'warning',
        title: 'Low Occupancy',
        message: `Your occupancy rate (excluding holiday breaks) is at ${occupancyRate.toFixed(1)}%. Consider marketing available rooms.`,
        action: 'View Houses',
        isAdminOnly: false,
      });
    } else if (occupancyRate >= 95 && data.houses.length > 0) {
      insights.push({
        type: 'success',
        title: 'High Occupancy',
        message: 'Excellent! Your properties are almost fully occupied.',
        isAdminOnly: false,
      });
    }

    // 2. Financial Insight (Burn Rate / Net Income)
    const monthlyReceipts = data.receipts.filter(r => {
      const period = safeParseJSON(r.payment_period, null);
      return period?.month === currentMonth && period?.year === currentYear;
    });

    const monthlyExpenses = data.expenses.filter(e => {
      const d = new Date(e.date);
      return d.getMonth() + 1 === currentMonth && d.getFullYear() === currentYear;
    });

    const revenue = monthlyReceipts.reduce(
      (sum, r) => sum + parseFloat(String(r.amount || 0)),
      0,
    );
    const expenses = monthlyExpenses.reduce(
      (sum, e) => sum + parseFloat(String(e.amount || 0)),
      0,
    );

    if (expenses > revenue && revenue > 0) {
      insights.push({
        type: 'error',
        title: 'High Burn Rate',
        message: 'Monthly expenses exceed revenue. Check your recent maintenance costs.',
        action: 'View Expenses',
        isAdminOnly: true,
      });
    }

    // 3. Expiring Contracts
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const expiringSoon = data.contracts.filter(c => {
      if (!isActiveContractStatus(c.status)) return false;
      if (!c.end_date) return false;
      const endDate = new Date(c.end_date);
      return endDate <= thirtyDaysFromNow && endDate >= now;
    });

    if (expiringSoon.length > 0) {
      insights.push({
        type: 'info',
        title: 'Contract Renewals',
        message: `${expiringSoon.length} contract${expiringSoon.length > 1 ? 's are' : ' is'} expiring in the next 30 days.`,
        action: 'View Contracts',
        isAdminOnly: true,
      });
    }

    // 4. Potential Revenue
    const expectedRevenue = activeContracts.reduce((sum, c) => {
      const { breaks } = parseMetadata(c.metadata);
      const { effectiveRent } = calculateEffectiveRent(
        parseFloat(String(c.rent_amount || 0)),
        currentMonth,
        currentYear,
        breaks,
      );
      return sum + effectiveRent;
    }, 0);
    const outstanding = expectedRevenue - revenue;

    if (outstanding > 0 && revenue > 0) {
      const collectionRate = (revenue / expectedRevenue) * 100;
      if (collectionRate < 80) {
        insights.push({
          type: 'warning',
          title: 'Collection Alert',
          message: `Only ${collectionRate.toFixed(1)}% of expected rent has been collected this month.`,
          action: 'Send Reminders',
          isAdminOnly: true,
        });
      }
    }

    // --- NEW INSIGHTS ---

    // 5. Month-over-Month Revenue Trend
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    const lastMonthReceipts = data.receipts.filter(r => {
      const period = safeParseJSON(r.payment_period, null);
      return period?.month === lastMonth && period?.year === lastMonthYear;
    });

    const lastMonthRevenue = lastMonthReceipts.reduce(
      (sum, r) => sum + parseFloat(String(r.amount || 0)),
      0,
    );

    if (lastMonthRevenue > 0) {
      const revenueChange = ((revenue - lastMonthRevenue) / lastMonthRevenue) * 100;
      if (revenueChange <= -10) {
        insights.push({
          type: 'warning',
          title: 'Revenue Drop',
          message: `Revenue is down ${Math.abs(revenueChange).toFixed(1)}% compared to last month.`,
          action: 'View Reports',
          isAdminOnly: false,
        });
      } else if (revenueChange >= 10 && revenue > 0) {
        insights.push({
          type: 'success',
          title: 'Revenue Growth',
          message: `Great job! Revenue grew ${revenueChange.toFixed(1)}% compared to last month.`,
          isAdminOnly: false,
        });
      }
    }

    // 6. Expense Spikes (3-month average)
    const threeMonthsAgo = new Date(currentYear, currentMonth - 4, 1);
    const startOfCurrentMonth = new Date(currentYear, currentMonth - 1, 1);

    const historicalExpenses = data.expenses.filter(e => {
      const d = new Date(e.date);
      return d >= threeMonthsAgo && d < startOfCurrentMonth;
    });

    const totalHistoricalExpenses = historicalExpenses.reduce(
      (sum, e) => sum + parseFloat(String(e.amount || 0)),
      0,
    );
    const avgMonthlyExpense = totalHistoricalExpenses / 3;

    if (avgMonthlyExpense > 0 && expenses > avgMonthlyExpense * 1.5) {
      const spikePercent = ((expenses - avgMonthlyExpense) / avgMonthlyExpense) * 100;
      insights.push({
        type: 'warning',
        title: 'Expense Spike',
        message: `Expenses this month are ${spikePercent.toFixed(0)}% higher than your recent average.`,
        action: 'View Expenses',
        isAdminOnly: true,
      });
    }

    // 7. Missing Tenant Information
    const activeTenants = data.tenants.filter(t => isActiveTenantStatus(t));
    let missingInfoCount = 0;
    const missingInfoIds: string[] = [];
    activeTenants.forEach(t => {
      if (
        !t.email ||
        t.email.includes('placeholder') ||
        !t.phone ||
        t.phone.trim() === ''
      ) {
        missingInfoCount++;
        missingInfoIds.push(t.id);
      }
    });

    if (missingInfoCount > 0) {
      insights.push({
        type: 'info',
        title: 'Missing Tenant Info',
        message: `${missingInfoCount} active tenant${missingInfoCount > 1 ? 's are' : ' is'} missing an email or phone number.`,
        action: 'Request Info',
        isAdminOnly: true,
      });
    }

    // 8. Tenant Anniversaries (1+ Year)
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    let longTermCount = 0;
    const longTermIds: string[] = [];

    // contractsByTenantId is always passed by callers (from the computed store)
    const contractsByTenant = data.contractsByTenantId;
    const getContractsForTenant = (id: string): any[] =>
      (contractsByTenant as any)?.get?.(id) ?? (contractsByTenant as any)?.[id] ?? [];

    const activeTenantsList = data.tenants.filter(t => isActiveTenantStatus(t));
    activeTenantsList.forEach(t => {
      const tenantContracts = getContractsForTenant(t.id);
      if (tenantContracts.length > 0) {
        let totalNetDays = 0;
        const nowTime = Date.now();

        tenantContracts.forEach(c => {
          if (!c.start_date) return;
          const start = new Date(c.start_date).getTime();
          if (start > nowTime) return; // Future contract

          // End date is either contract end_date or today, whichever is earlier
          let end = nowTime;
          if (c.end_date) {
            const cEnd = new Date(c.end_date).getTime();
            if (cEnd < end) end = cEnd;
          }

          let contractDays = (end - start) / (1000 * 60 * 60 * 24);
          if (contractDays < 0) contractDays = 0;

          // Parse breaks
          let breakDays = 0;
          const { breaks } = parseMetadata(c.metadata);

          breaks.forEach((b: any) => {
            if (!b.start_date || !b.end_date) return;
            const bStart = new Date(b.start_date).getTime();
            const bEnd = new Date(b.end_date).getTime();

            // Calculate overlap between the break and the active contract period up to today
            const overlapStart = Math.max(bStart, start);
            const overlapEnd = Math.min(bEnd, end);

            if (overlapStart < overlapEnd) {
              breakDays += (overlapEnd - overlapStart) / (1000 * 60 * 60 * 24);
            }
          });

          totalNetDays += contractDays - breakDays;
        });

        if (totalNetDays >= 365) {
          longTermCount++;
          longTermIds.push(t.id);
        }
      }
    });

    if (longTermCount > 0) {
      insights.push({
        type: 'success',
        title: 'Long-term Tenants',
        message: `You have ${longTermCount} tenant${longTermCount > 1 ? 's who have' : ' who has'} been with you for over a year!.`,
        action: 'View Tenants',
        actionParams: { filterIds: longTermIds.join(',') },
        isAdminOnly: false,
      });
    }

    // 9. Overdue Renters Count
    // Only warn if it's past the 5th of the month to reduce noise
    if (now.getDate() > 5) {
      let overdueCount = 0;
      const overdueIds: string[] = [];
      const paidContractIds = new Set<string>();
      const paidTenantIds = new Set<string>();
      monthlyReceipts.forEach(r => {
        if (r.contract_id) paidContractIds.add(r.contract_id);
        if (r.tenant_id) paidTenantIds.add(r.tenant_id);
      });

      activeContracts.forEach(c => {
        // Check if there is any receipt for this contract this month
        const hasPaid = paidContractIds.has(c.id) || paidTenantIds.has(c.tenant_id);
        if (!hasPaid) {
          overdueCount++;
          overdueIds.push(c.tenant_id);
        }
      });

      if (overdueCount > 0) {
        insights.push({
          type: 'error',
          title: 'Overdue Rent',
          message: `${overdueCount} active tenant${overdueCount > 1 ? 's have' : ' has'} not paid rent for this month.`,
          action: 'View Tenants',
          actionParams: { filterIds: overdueIds.join(',') },
          isAdminOnly: true,
        });
      }
    }

    return insights;
  }, [businessId, data, data.contractsByTenantId]);
}
