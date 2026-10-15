import { formatDateForDB } from '@/shared/utils/formatters';
import type {
  IntegrityIssue,
  IntegrityRule,
  IntegrityScanData,
} from '@/shared/utils/integrity/types';
import {
  isActiveContractStatus,
  isActiveTenantStatus,
  isManualHouseStatus,
} from '@/shared/utils/statusHelper';

const tenantsWithoutContractsRule: IntegrityRule = {
  id: 'tenantsWithoutContracts',
  evaluate(data: IntegrityScanData, _helpers: any): IntegrityIssue | null {
    const { allTenants, allContracts } = data;
    const tenantsNoContracts = allTenants
      .filter(t => {
        if (!isActiveTenantStatus(t.status)) return false;
        return !allContracts.some(
          c => c.tenant_id === t.id && isActiveContractStatus(c.status),
        );
      })
      .map(t => {
        const tContracts = allContracts.filter(c => c.tenant_id === t.id);
        const lastContract = [...tContracts].sort((a, b) =>
          (b.end_date || '').localeCompare(a.end_date || ''),
        )[0];
        return { ...t, latest_contract: lastContract };
      });

    if (tenantsNoContracts.length === 0) return null;

    return {
      id: 'tenantsWithoutContracts',
      title: 'Active Tenants without Contracts',
      description: 'Tenants marked as active but having no active or expiring contract.',
      category: 'Status',
      severity: 'critical',
      items: tenantsNoContracts,
      actionLabel: 'Resolve',
    };
  },
};

const paidTenantsWithoutStatusRule: IntegrityRule = {
  id: 'paidTenantsWithoutStatus',
  evaluate(data: IntegrityScanData, helpers: any): IntegrityIssue | null {
    const { allTenants, allContracts, allReceipts } = data;
    const currentPeriod = new Date(
      helpers.today.getFullYear(),
      helpers.today.getMonth(),
      1,
    );

    const paidIssues = allTenants.filter(t => {
      const tContracts = allContracts.filter(c => c.tenant_id === t.id);
      const tReceipts = allReceipts.filter(r =>
        tContracts.some(c => c.id === r.contract_id),
      );
      const hasRecentPayment = tReceipts.some(r => {
        if (!r.payment_period) return false;
        const pDate = new Date(String(r.payment_period));
        return !Number.isNaN(pDate.getTime()) && pDate >= currentPeriod;
      });
      if (!hasRecentPayment) return false;
      const isActive =
        isActiveTenantStatus(t.status) &&
        tContracts.some(c => isActiveContractStatus(c.status));
      return !isActive;
    });

    if (paidIssues.length === 0) return null;

    return {
      id: 'paidTenantsWithoutStatus',
      title: 'Paid Tenants with Status Issues',
      description:
        'Tenants who have paid for the current/future period but are inactive or lack a contract.',
      category: 'Status',
      severity: 'critical',
      items: paidIssues,
    };
  },
};

const houseStatusMismatchesRule: IntegrityRule = {
  id: 'houseStatusMismatches',
  evaluate(data: IntegrityScanData, _helpers: any): IntegrityIssue | null {
    const { allHouses, allContracts } = data;

    const houseMismatches = allHouses.filter(h => {
      const hasActiveContract = allContracts.some(
        c => c.house_id === h.id && isActiveContractStatus(c.status),
      );
      if (h.status === 'available' && hasActiveContract) return true;
      if (
        h.status !== 'available' &&
        !hasActiveContract &&
        h.is_serviceable &&
        h.status !== 'property_deleted' &&
        !isManualHouseStatus(h.status)
      )
        return true;
      return false;
    });

    if (houseMismatches.length === 0) return null;

    return {
      id: 'houseStatusMismatches',
      title: 'House Status Mismatches',
      description: 'Houses where occupancy status does not match active contracts.',
      category: 'Status',
      severity: 'warning',
      items: houseMismatches,
    };
  },
};

const expiredContractsRule: IntegrityRule = {
  id: 'expiredContracts',
  evaluate(data: IntegrityScanData, helpers: any): IntegrityIssue | null {
    const { allContracts, allTenants } = data;
    const todayStr = formatDateForDB(helpers.today);

    const expiredIssues = allContracts
      .filter(c => {
        if (!isActiveContractStatus(c.status)) return false;
        if (!c.end_date) return false;
        return c.end_date < todayStr;
      })
      .map(c => {
        const tenant = allTenants.find(t => t.id === c.tenant_id);
        return {
          ...c,
          name: `${tenant?.name || 'Unknown Tenant'} (Ends: ${c.end_date})`,
        };
      });

    if (expiredIssues.length === 0) return null;

    return {
      id: 'expiredContracts',
      title: 'Expired Contracts Not Handled',
      description:
        'Active contracts whose end date has passed. Cron job should handle these, but if they persist, manual check is required.',
      category: 'Status',
      severity: 'warning',
      items: expiredIssues,
    };
  },
};

export const statusRules = [
  tenantsWithoutContractsRule,
  paidTenantsWithoutStatusRule,
  houseStatusMismatchesRule,
  expiredContractsRule,
];
