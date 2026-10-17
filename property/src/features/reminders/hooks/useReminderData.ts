import { useCallback, useMemo } from 'react';
import {
  getReminderCategories,
  type Tenant,
} from '@/features/reminders/utils/reminderUtils';
import {
  useContractsByTenantId,
  useHousesById,
  useProperties,
  usePropertiesById,
  useReceiptsByContractId,
  useReminderLogs,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { parseNextOfKin } from '@/shared/services/contactsSync';
import { parsePeriod } from '@/shared/utils/formatters';
import { calculateEffectiveRent } from '@/shared/utils/helper';
import {
  isActiveContractStatus,
  isActiveTenantStatus,
  isContractPaused,
} from '@/shared/utils/statusHelper';

export function useReminderData(selectedBusiness: any, state: any) {
  const colors = useThemeColors();

  const rawTenants = useTenants(selectedBusiness?.id);
  const properties = useProperties(selectedBusiness?.id);
  const rawReminderLogs = useReminderLogs(selectedBusiness?.id);
  const contractsByTenantId = useContractsByTenantId(selectedBusiness?.id);
  const receiptsByContractId = useReceiptsByContractId(selectedBusiness?.id);
  const housesById = useHousesById(selectedBusiness?.id);
  const propertiesById = usePropertiesById(selectedBusiness?.id);

  const reminderCategories = useMemo(() => getReminderCategories(colors), [colors]);

  const mapHouse = useCallback(
    (houseId?: string | null) => {
      if (!houseId) return undefined;
      const house = housesById.get(houseId);
      if (!house) return undefined;
      const property = house.property_id
        ? propertiesById.get(house.property_id)
        : undefined;
      return {
        id: house.id,
        property_id: house.property_id,
        type: house.type,
        house_number: house.house_number || undefined,
        property: property
          ? { id: property.id, name: property.name || undefined }
          : undefined,
      };
    },
    [housesById, propertiesById],
  );

  const { tenants, newTenants, allTenants } = useMemo(() => {
    const pendingTenants = rawTenants
      .map(tenant => {
        const periodMonth = state.selectedDate.getMonth() + 1;
        const periodYear = state.selectedDate.getFullYear();
        const periodStartDate = new Date(periodYear, periodMonth - 1, 1);
        const periodEndDate = new Date(periodYear, periodMonth, 0, 23, 59, 59);

        const tenantContracts = contractsByTenantId.get(tenant.id) || [];
        const activeContracts = tenantContracts.filter((c: any) => {
          if (!isActiveContractStatus(c.status)) return false;
          if (isContractPaused(c)) return false;

          const contractStart = new Date(c.start_date);
          const contractEnd = c.end_date ? new Date(c.end_date) : null;

          return (
            contractStart <= periodEndDate &&
            (!contractEnd || contractEnd >= periodStartDate)
          );
        });

        if (activeContracts.length === 0) return null;

        const sortedContracts = activeContracts.sort((a: any, b: any) => {
          const dateA = new Date(a.start_date || 0).getTime();
          const dateB = new Date(b.start_date || 0).getTime();
          return dateB - dateA;
        });
        const contract = sortedContracts[0];
        if (!contract) return null;

        const rentAmount = parseFloat(String(contract.rent_amount || 0));

        const breaks = (contract.metadata as any)?.breaks || [];
        const { effectiveRent: effectiveRentAmount, isOnFullBreak } =
          calculateEffectiveRent(rentAmount, periodMonth, periodYear, breaks);

        if (isOnFullBreak) return null;

        const contractReceipts = receiptsByContractId.get(contract.id) || [];
        const paidReceipts = contractReceipts.filter(r => {
          const p = parsePeriod(r.payment_period);
          return p?.month === periodMonth && p?.year === periodYear;
        });

        const paidAmount = paidReceipts.reduce(
          (sum, r) =>
            sum +
            (parseFloat(String(r.amount || 0)) -
              parseFloat(String(r.refunded_amount || 0))),
          0,
        );

        const pendingRentAmount = Math.max(0, effectiveRentAmount - paidAmount);

        return {
          ...tenant,
          pendingRentAmount,
          paidAmount,
          contracts: sortedContracts.map((c: any) => ({
            ...c,
            house: mapHouse(c.house_id),
          })),
        } as any;
      })
      .filter((t): t is any => t !== null && (t.pendingRentAmount || 0) > 0);

    const activeTenants = rawTenants
      .filter(t => isActiveTenantStatus(t.status))
      .map(
        t =>
          ({
            ...t,
            contracts: (contractsByTenantId.get(t.id) || [])
              .sort((a: any, b: any) => {
                if (isActiveContractStatus(a.status) && !isActiveContractStatus(b.status))
                  return -1;
                if (isActiveContractStatus(b.status) && !isActiveContractStatus(a.status))
                  return 1;
                return (
                  new Date(b.start_date || 0).getTime() -
                  new Date(a.start_date || 0).getTime()
                );
              })
              .map((c: any) => ({
                ...c,
                house: mapHouse(c.house_id),
              })),
          }) as any,
      );

    const allTenantsList = rawTenants.map(t => ({
      ...t,
      contracts: (contractsByTenantId.get(t.id) || [])
        .sort((a: any, b: any) => {
          if (isActiveContractStatus(a) && !isActiveContractStatus(b)) return -1;
          if (isActiveContractStatus(b) && !isActiveContractStatus(a)) return 1;
          return (
            new Date(b.start_date || 0).getTime() - new Date(a.start_date || 0).getTime()
          );
        })
        .map((c: any) => ({
          ...c,
          house: mapHouse(c.house_id),
        })),
    })) as any[];

    return {
      tenants: pendingTenants,
      newTenants: activeTenants,
      allTenants: allTenantsList,
    };
  }, [
    rawTenants,
    contractsByTenantId,
    receiptsByContractId,
    state.selectedDate,
    mapHouse,
  ]);

  const reminderLogs = useMemo(() => {
    return rawReminderLogs
      .sort(
        (a, b) => new Date(b.sent_at || 0).getTime() - new Date(a.sent_at || 0).getTime(),
      )
      .map(log => {
        let meta = log.metadata;
        if (typeof meta === 'string') {
          try {
            meta = JSON.parse(meta);
          } catch {
            meta = null;
          }
        }
        return {
          ...log,
          metadata: meta,
          tenant: rawTenants.find(t => t.id === log.tenant_id),
        };
      });
  }, [rawReminderLogs, rawTenants]);

  const getPendingTenants = useMemo(() => {
    if (!state.selectedCategory) return [];

    let candidateTenants: Tenant[] = [];
    if (state.selectedCategory === 'payment') {
      candidateTenants = tenants;
    } else if (state.selectedCategory === 'mark_holiday') {
      candidateTenants = allTenants;
    } else {
      candidateTenants = newTenants;
    }

    candidateTenants = candidateTenants.filter(tenant => {
      if (state.selectedCategory === 'mark_holiday') {
        const hasMatchingContract = tenant.contracts?.some((c: any) => {
          if (c.deleted) return false;
          if (state.contractStatusFilter === 'all') return true;
          if (state.contractStatusFilter === 'active')
            return c.status?.toLowerCase() === 'active' && !isContractPaused(c);
          if (state.contractStatusFilter === 'expiring_soon')
            return c.status?.toLowerCase() === 'expiring_soon' && !isContractPaused(c);
          if (state.contractStatusFilter === 'paused') return isContractPaused(c);
          return isActiveContractStatus(c);
        });
        if (!hasMatchingContract) return false;
      } else {
        const hasActiveContract = tenant.contracts?.some((c: any) =>
          isActiveContractStatus(c),
        );
        if (!hasActiveContract) return false;
      }

      if (state.selectedCategory === 'data_cleanup') {
        if (state.dataCleanupStatusFilter === 'all') {
          return true;
        }
        const hasEmail = tenant.email && !tenant.email.startsWith('placeholder');
        const hasPhone = !!tenant.phone;
        const nextOfKin = parseNextOfKin(tenant.next_of_kin);
        const hasNextOfKin = nextOfKin.length > 0;
        return !hasEmail || !hasPhone || !hasNextOfKin;
      }
      return true;
    });

    let propertyFilteredTenants = candidateTenants;
    if (state.selectedPropertyId) {
      propertyFilteredTenants = propertyFilteredTenants.filter(
        tenant =>
          tenant.contracts?.[0]?.house?.property?.id === state.selectedPropertyId ||
          tenant.contracts?.[0]?.house?.property_id === state.selectedPropertyId,
      );
    }
    if (state.selectedHouseTypeId) {
      propertyFilteredTenants = propertyFilteredTenants.filter(
        tenant => tenant.contracts?.[0]?.house?.type === state.selectedHouseTypeId,
      );
    }

    let searchFilteredTenants = propertyFilteredTenants;
    if (state.searchQuery) {
      const searchLower = state.searchQuery.toLowerCase();
      searchFilteredTenants = propertyFilteredTenants.filter(
        tenant =>
          tenant.name?.toLowerCase().includes(searchLower) ||
          tenant.phone?.toLowerCase().includes(searchLower) ||
          tenant.email?.toLowerCase().includes(searchLower) ||
          tenant.contracts?.[0]?.house?.house_number
            ?.toLowerCase()
            .includes(searchLower) ||
          tenant.contracts?.[0]?.house?.property?.name
            ?.toLowerCase()
            .includes(searchLower),
      );
    }

    return searchFilteredTenants.sort((a, b) => {
      const aHasEmail = a.email && !a.email.startsWith('placeholder');
      const bHasEmail = b.email && !b.email.startsWith('placeholder');
      if (aHasEmail && !bHasEmail) return -1;
      if (!aHasEmail && bHasEmail) return 1;
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      return aName.localeCompare(bName);
    });
  }, [
    state.searchQuery,
    state.selectedCategory,
    state.selectedPropertyId,
    state.selectedHouseTypeId,
    tenants,
    newTenants,
    allTenants,
    state.contractStatusFilter,
    state.dataCleanupStatusFilter,
  ]);

  const filteredReminders = useMemo(() => {
    if (!state.searchQuery) return reminderLogs;
    return reminderLogs.filter(reminder => {
      const searchLower = state.searchQuery.toLowerCase();
      return (
        reminder.tenant?.name?.toLowerCase().includes(searchLower) ||
        reminder.tenant?.phone?.toLowerCase().includes(searchLower) ||
        reminder.tenant?.email?.toLowerCase().includes(searchLower) ||
        reminder.message?.toLowerCase().includes(searchLower)
      );
    });
  }, [state.searchQuery, reminderLogs]);

  const getGroupTitle = useCallback(
    (type: string) => {
      const catTitle =
        reminderCategories.find(c => c.id === state.selectedCategory)?.title ||
        'Reminder';
      switch (type) {
        case 'pending':
          return `${catTitle} Pending`;
        case 'sent':
          return `${catTitle} Sent`;
        case 'failed':
          return `${catTitle} Failed`;
        default:
          return '';
      }
    },
    [reminderCategories, state.selectedCategory],
  );

  const groupedReminders = useMemo(() => {
    if (!state.selectedCategory) return [];

    const pendingData = getPendingTenants || [];
    const filterByDate = (r: any) => {
      if (state.selectedCategory !== 'payment') return true;
      const metadata = r.metadata as any;
      if (!metadata?.target_date) return true;
      const target = new Date(metadata.target_date);
      return (
        target.getMonth() === state.selectedDate.getMonth() &&
        target.getFullYear() === state.selectedDate.getFullYear()
      );
    };

    const failedData = (filteredReminders || []).filter(
      (r: any) =>
        r.status === 'failed' &&
        r.reminder_type === state.selectedCategory &&
        filterByDate(r),
    );

    const groups = [
      {
        key: 'pending',
        title: getGroupTitle('pending'),
        color: colors.warning,
        icon: 'clock',
        data: state.expandedSections.has('pending') ? pendingData : [],
        count: pendingData.length,
      },
      {
        key: 'failed',
        title: getGroupTitle('failed'),
        color: colors.error,
        icon: 'alert-circle',
        data: state.expandedSections.has('failed') ? failedData : [],
        count: failedData.length,
      },
    ];

    return groups.filter(g => g.count > 0);
  }, [
    filteredReminders,
    getPendingTenants,
    state.selectedCategory,
    colors,
    state.expandedSections,
    getGroupTitle,
    state.selectedDate,
  ]);

  return {
    properties,
    reminderCategories,
    reminderLogs,
    getPendingTenants,
    filteredReminders,
    groupedReminders,
    colors,
  };
}
