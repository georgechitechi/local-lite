import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { calculateBusinessOverview } from '@/features/dashboard/utils/businessMetrics';
import { EXPENSE_CATEGORY } from '@/features/expenses/utils/expenseUtils';
import {
  generateCSV,
  generatePDFContent,
  getPDFPrintOptions,
  processReportData,
} from '@/features/reports/utils';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useCurrency } from '@/shared/hooks/useCurrency';
import {
  useBookings,
  useContracts,
  useExpenses,
  useHouses,
  useMaintenanceRequests,
  usePaymentMessageReceipts,
  usePaymentMessages,
  usePromotions,
  useProperties,
  useReceipts,
  useTenants,
} from '@/shared/hooks/useStore';
import { formatDateForDB, formatPeriod, parsePeriod } from '@/shared/utils/formatters';
import { calculateEffectiveRent } from '@/shared/utils/helper';
import { isActiveContractStatus, isContractPaused } from '@/shared/utils/statusHelper';
import type { Tenant } from '@/stores/types';

export function useReports() {
  const { selectedBusiness } = useBusiness();
  const { showSnackbar } = useSnackbar();
  const { hasAccess } = useAccessControl();
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);

  const storeProperties = useProperties(selectedBusiness?.id);
  const storeHouses = useHouses(selectedBusiness?.id);
  const storeTenants = useTenants(selectedBusiness?.id);
  const storeContracts = useContracts(selectedBusiness?.id);
  const storeReceipts = useReceipts(selectedBusiness?.id);
  const storeExpenses = useExpenses(selectedBusiness?.id);
  const storeBookings = useBookings(selectedBusiness?.id);
  const storePromotions = usePromotions(selectedBusiness?.id);
  const storeMaintenanceRequests = useMaintenanceRequests(selectedBusiness?.id);
  const storePaymentMessages = usePaymentMessages(selectedBusiness?.id);
  const storePaymentMessageReceipts = usePaymentMessageReceipts(selectedBusiness?.id);

  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [showFormatMenu, setShowFormatMenu] = useState(false);

  const [activeModal, setActiveModal] = useState<string | null>(null);

  // Consolidated Report parameters
  const [reportParams, setReportParams] = useState<Record<string, any>>({
    pending_rent: {
      reportDate: new Date(),
      groupBy: 'none',
      allTime: false,
      isYTD: false,
    },
    financials: {
      startDate: (() => {
        const d = new Date();
        d.setMonth(0);
        d.setDate(1);
        return d;
      })(),
      endDate: new Date(),
      propertyId: 'all',
      groupByMonth: true,
      isYTD: true,
      allTime: false,
      expenseCategories: EXPENSE_CATEGORY.map(c => c.key),
    },
    business_summary: {
      startDate: (() => {
        const d = new Date();
        d.setMonth(0);
        d.setDate(1);
        return d;
      })(),
      endDate: new Date(),
      isYTD: true,
      allTime: false,
    },
    tenants: {
      status: 'active',
      missingEmail: false,
      missingPhone: false,
      missingNextOfKin: false,
      groupByProperty: true,
      moveOutMonth: null as Date | null,
    },
    houses: {
      propertyId: 'all',
      status: 'all',
      groupByProperty: true,
    },
    receipts: {
      propertyId: 'all',
      monthsBack: '3',
      includeFormerTenants: false,
    },
    contracts: {
      status: 'active',
      groupByProperty: true,
    },
    stay_history: {
      groupBy: 'none',
      sortBy: 'check_in',
      sortOrder: 'asc',
      status: 'active',
    },
    holidays: {
      sortBy: 'tenant',
      sortOrder: 'asc',
      status: 'all',
      date: new Date(),
      allTime: false,
    },
    promotions: {
      sortBy: 'code',
      sortOrder: 'asc',
      status: 'all',
      date: new Date(),
      allTime: false,
    },
    breaks_with_payments: {
      date: new Date(),
      allTime: true,
      includePromo: false,
    },
    expenses_analysis: {
      date: new Date(),
      showDetails: true,
      isYTD: false,
      allTime: false,
    },
    tenant_ledger: {
      tenant: null as Tenant | null,
      groupByStatus: false,
    },
    maintenance: {
      status: 'all',
      priority: 'all',
      propertyId: 'all',
      groupByProperty: true,
    },
    vacant_rooms: {
      propertyId: 'all',
      groupByProperty: true,
    },
    rent_collection: {
      startDate: (() => {
        const d = new Date();
        d.setMonth(0);
        d.setDate(1);
        return d;
      })(),
      endDate: new Date(),
      propertyId: 'all',
      isYTD: true,
    },
    occupancy_rate: {
      startDate: (() => {
        const d = new Date();
        d.setMonth(0);
        d.setDate(1);
        return d;
      })(),
      endDate: new Date(),
      propertyId: 'all',
      groupByMonth: true,
    },
    expiring_contracts: {
      daysAhead: '30',
      propertyId: 'all',
      groupByProperty: true,
    },
    refunds: {
      propertyId: 'all',
      monthsBack: '3',
      includeFormerTenants: false,
    },
  });

  const updateParam = (reportId: string, updates: Record<string, any>) => {
    setReportParams(prev => ({
      ...prev,
      [reportId]: { ...prev[reportId], ...updates },
    }));
  };

  const [pendingExport, setPendingExport] = useState<{
    type: string;
    format: string;
    orientation?: 'portrait' | 'landscape';
    extra?: any;
  } | null>(null);

  const handleExport = async (
    type: string,
    format: string,
    dateOverride?: Date,
    extraOptions?: any,
    orientation?: 'portrait' | 'landscape',
  ) => {
    if (!selectedBusiness?.id) return;

    const targetOrientation =
      extraOptions?.orientation ||
      orientation ||
      pendingExport?.orientation ||
      'portrait';

    const openModal = (modalName: string) => {
      setPendingExport({
        type,
        format,
        orientation: targetOrientation,
        extra: extraOptions,
      });
      setActiveModal(modalName);
      setShowFormatMenu(false);
    };

    if (type === 'pending_rent' && !dateOverride) {
      openModal('pending_rent');
      return;
    }

    if (type === 'financials' && !extraOptions?.period) {
      openModal('financials');
      return;
    }

    if (type === 'tenants' && !extraOptions?.status) {
      openModal('tenants');
      return;
    }

    const needsBuildingFilter = ['houses', 'vacant_rooms', 'receipts'].includes(type);
    if (needsBuildingFilter && !extraOptions?.propertyId) {
      openModal(type);
      return;
    }

    if (type === 'contracts' && !extraOptions?.status) {
      openModal('contracts');
      return;
    }

    if (type === 'tenant_ledger' && !extraOptions?.tenantId) {
      openModal('tenant_ledger');
      return;
    }

    if (type === 'stay_history' && !extraOptions?.sortBy) {
      openModal('stay_history');
      return;
    }

    if (type === 'holidays' && !extraOptions?.status) {
      openModal('holidays');
      return;
    }

    if (type === 'promotions' && !extraOptions?.status) {
      openModal('promotions');
      return;
    }

    if (type === 'breaks_with_payments' && !extraOptions?.configured) {
      openModal('breaks_with_payments');
      return;
    }

    if (type === 'business_summary' && !extraOptions?.period) {
      openModal('business_summary');
      return;
    }

    if (type === 'expenses_analysis' && !extraOptions?.date) {
      openModal('expenses_analysis');
      return;
    }

    if (type === 'maintenance' && !extraOptions?.configured) {
      openModal('maintenance');
      return;
    }

    if (type === 'vacant_rooms' && !extraOptions?.configured) {
      openModal('vacant_rooms');
      return;
    }

    if (type === 'rent_collection' && !extraOptions?.period) {
      openModal('rent_collection');
      return;
    }

    if (type === 'occupancy_rate' && !extraOptions?.period) {
      openModal('occupancy_rate');
      return;
    }

    if (type === 'expiring_contracts' && !extraOptions?.configured) {
      openModal('expiring_contracts');
      return;
    }

    if (type === 'refunds' && !extraOptions?.configured) {
      openModal('refunds');
      return;
    }

    try {
      setExportLoading(true);
      let data: any[] = [];
      const reportType = type as any;

      if (type === 'pending_rent') {
        const targetDate = dateOverride || reportParams.pending_rent.reportDate;
        const isAllTime = extraOptions?.allTime ?? reportParams.pending_rent.allTime;
        const isYearToDate =
          extraOptions?.isYearToDate ??
          extraOptions?.isYTD ??
          reportParams.pending_rent.isYTD;

        const periodsToCheck: { month: number; year: number }[] = [];

        if (isAllTime) {
          const now = new Date();
          const currentMonth = now.getMonth() + 1;
          const currentYear = now.getFullYear();

          // Find earliest contract start date
          let earliestDate = new Date();
          storeContracts.forEach(c => {
            if (c.start_date) {
              const d = new Date(c.start_date);
              if (d < earliestDate) earliestDate = d;
            }
          });

          const cur = new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1);
          while (
            cur.getFullYear() < currentYear ||
            (cur.getFullYear() === currentYear && cur.getMonth() + 1 <= currentMonth)
          ) {
            periodsToCheck.push({ month: cur.getMonth() + 1, year: cur.getFullYear() });
            cur.setMonth(cur.getMonth() + 1);
          }
        } else if (isYearToDate) {
          const year = targetDate.getFullYear();
          const endMonth = targetDate.getMonth() + 1;
          for (let m = 1; m <= endMonth; m++) {
            periodsToCheck.push({ month: m, year });
          }
        } else {
          periodsToCheck.push({
            month: targetDate.getMonth() + 1,
            year: targetDate.getFullYear(),
          });
        }

        data = periodsToCheck.flatMap(({ month: periodMonth, year: periodYear }) => {
          const lastDayOfPeriod = formatDateForDB(new Date(periodYear, periodMonth, 0));
          const firstDayOfPeriod = formatDateForDB(
            new Date(periodYear, periodMonth - 1, 1),
          );

          return storeTenants
            .map(tenant => {
              const activeContracts = storeContracts.filter(
                c =>
                  c.tenant_id === tenant.id &&
                  isActiveContractStatus(c.status) &&
                  !isContractPaused(c) &&
                  c.start_date <= lastDayOfPeriod &&
                  (!c.end_date || c.end_date >= firstDayOfPeriod),
              );
              if (activeContracts.length === 0) return null;

              const contract = activeContracts.sort(
                (a, b) =>
                  new Date(b.start_date || 0).getTime() -
                  new Date(a.start_date || 0).getTime(),
              )[0];

              const rentAmount = parseFloat(String(contract.rent_amount || 0));

              // Check for breaks (holiday breaks)
              const breaks = (contract.metadata as any)?.breaks || [];
              const { effectiveRent: effectiveRentAmount, isOnFullBreak } =
                calculateEffectiveRent(rentAmount, periodMonth, periodYear, breaks);

              if (isOnFullBreak) return null;

              const paidReceipts = storeReceipts.filter(r => {
                const parsedPeriod = parsePeriod(r.payment_period);
                return (
                  r.contract_id === contract.id &&
                  parsedPeriod.month === periodMonth &&
                  parsedPeriod.year === periodYear
                );
              });

              const paidAmount = paidReceipts.reduce(
                (sum, r) =>
                  sum +
                  (parseFloat(String(r.amount || 0)) -
                    parseFloat(String(r.refunded_amount || 0))),
                0,
              );

              const pendingAmount = Math.max(0, effectiveRentAmount - paidAmount);
              if (pendingAmount <= 0) return null;

              const house = storeHouses.find(h => h.id === contract.house_id);
              const property = storeProperties.find(p => p.id === house?.property_id);

              return {
                property_name: property?.name || 'Unknown',
                house_number: house?.house_number || 'Unknown',
                tenant_name: tenant.name || 'Unknown',
                tenant_phone: tenant.phone || 'N/A',
                contract_amount: effectiveRentAmount,
                amount_paid: paidAmount,
                amount_pending: pendingAmount,
                payment_status: paidAmount > 0 ? 'partial' : 'unpaid',
                target_month: periodMonth,
                target_year: periodYear,
              };
            })
            .filter(Boolean);
        });
      } else if (type === 'financials') {
        const allTime = extraOptions?.allTime ?? reportParams.financials.allTime;

        let startD = new Date(extraOptions.period.start);
        if (allTime) {
          const firstReceipt = [...storeReceipts]
            .filter(r => r.payment_date)
            .sort(
              (a, b) =>
                new Date(a.payment_date as string).getTime() -
                new Date(b.payment_date as string).getTime(),
            )[0];
          startD = firstReceipt
            ? new Date(firstReceipt.payment_date as string)
            : new Date();
          startD.setDate(1); // Start of that month
        }

        const endD = allTime ? new Date() : new Date(extraOptions.period.end);
        const filterPropertyId: string | undefined =
          extraOptions.propertyId === 'all' ? undefined : extraOptions.propertyId;
        const allowedCategories: string[] =
          extraOptions.expenseCategories || EXPENSE_CATEGORY.map(c => c.key);
        const groupByMonth: boolean = extraOptions.groupByMonth ?? false;

        const inRange = (dateStr: string) => {
          const d = new Date(dateStr);
          d.setHours(0, 0, 0, 0);
          const start = new Date(startD);
          start.setHours(0, 0, 0, 0);
          const end = new Date(endD);
          end.setHours(23, 59, 59, 999);
          return d >= start && d <= end;
        };

        const pReceipts = storeReceipts.filter(r => {
          if (!r.payment_date || !inRange(r.payment_date)) return false;
          if (filterPropertyId) {
            const contract = storeContracts.find(c => c.id === r.contract_id);
            const house = storeHouses.find(h => h.id === contract?.house_id);
            if (house?.property_id !== filterPropertyId) return false;
          }
          return true;
        });

        const pExpenses = storeExpenses.filter(e => {
          if (!e.date || !inRange(e.date)) return false;
          if (!allowedCategories.includes(e.category || '')) return false;
          return true;
        });

        const netAmount = (r: any) =>
          parseFloat(String(r.amount || 0)) - parseFloat(String(r.refunded_amount || 0));
        const monthKey = (dateStr: string) => {
          const d = new Date(dateStr);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        };
        const monthLabel = (key: string) => {
          const [y, m] = key.split('-');
          return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1).toLocaleString(
            'default',
            {
              month: 'long',
              year: 'numeric',
            },
          );
        };

        if (groupByMonth) {
          const months: string[] = [];
          const cur = new Date(startD.getFullYear(), startD.getMonth(), 1);
          const last = new Date(endD.getFullYear(), endD.getMonth(), 1);
          while (cur <= last) {
            months.push(
              `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`,
            );
            cur.setMonth(cur.getMonth() + 1);
          }

          data = months.map(mk => {
            const rev = pReceipts
              .filter(
                r => monthKey(r.payment_date as string) === mk && r.status !== 'promo',
              )
              .reduce((s, r) => s + netAmount(r), 0);
            const exp = pExpenses
              .filter(e => monthKey(e.date as string) === mk)
              .reduce((s, e) => s + parseFloat(String(e.amount || 0)), 0);
            return {
              period: monthLabel(mk),
              total_revenue: rev,
              total_expenses: exp,
              net_profit: rev - exp,
            };
          });
        } else {
          const totalRevenue = pReceipts
            .filter(r => r.status !== 'promo')
            .reduce((s, r) => s + netAmount(r), 0);
          const totalExpenses = pExpenses.reduce(
            (s, e) => s + parseFloat(String(e.amount || 0)),
            0,
          );
          data = [
            {
              period: `${startD.toLocaleDateString()} - ${endD.toLocaleDateString()}`,
              total_revenue: totalRevenue,
              total_expenses: totalExpenses,
              net_profit: totalRevenue - totalExpenses,
            },
          ];
        }
      } else {
        switch (type) {
          case 'business_summary': {
            data = calculateBusinessOverview(
              {
                properties: storeProperties,
                houses: storeHouses,
                tenants: storeTenants,
                contracts: storeContracts,
                receipts: storeReceipts,
                expenses: storeExpenses,
                maintenanceRequests: storeMaintenanceRequests,
              },
              {
                startDate: extraOptions.period.start,
                endDate: extraOptions.period.end,
                allTime: extraOptions?.allTime,
                isYTD: extraOptions?.isYearToDate ?? extraOptions?.isYTD,
              },
            );
            break;
          }
          case 'houses':
            data = storeHouses.map(h => ({
              ...h,
              property: storeProperties.find(p => p.id === h.property_id),
              contracts: storeContracts
                .filter(c => c.house_id === h.id)
                .map(c => ({
                  ...c,
                  tenant: storeTenants.find(t => t.id === c.tenant_id),
                })),
            }));
            break;
          case 'tenants':
            data = storeTenants.map(t => ({
              ...t,
              contracts: storeContracts
                .filter(c => c.tenant_id === t.id)
                .map(c => ({
                  ...c,
                  house: storeHouses.find(h => h.id === c.house_id),
                  property: storeProperties.find(
                    p => p.id === storeHouses.find(h => h.id === c.house_id)?.property_id,
                  ),
                })),
            }));
            break;
          case 'contracts':
            data = storeContracts.map(c => ({
              ...c,
              tenant: storeTenants.find(t => t.id === c.tenant_id),
              house: storeHouses.find(h => h.id === c.house_id),
              property: storeProperties.find(
                p => p.id === storeHouses.find(h => h.id === c.house_id)?.property_id,
              ),
            }));
            break;
          case 'receipts':
          case 'tenant_ledger':
            data = storeReceipts
              .sort((a, b) => {
                const dateA = new Date(a.payment_date || 0).getTime();
                const dateB = new Date(b.payment_date || 0).getTime();
                return dateA - dateB;
              })
              .map(r => {
                const contract = storeContracts.find(c => c.id === r.contract_id);
                const house = storeHouses.find(h => h.id === contract?.house_id);
                const linkedPmr = storePaymentMessageReceipts.filter(
                  pmr => pmr.receipt_id === r.id,
                );
                const msgs = linkedPmr
                  .map(pmr =>
                    storePaymentMessages.find(pm => pm.id === pmr.payment_message_id),
                  )
                  .filter(Boolean);
                return {
                  ...r,
                  payment_messages: msgs,
                  contract: {
                    ...contract,
                    tenant: storeTenants.find(t => t.id === contract?.tenant_id),
                    house: {
                      ...house,
                      property: storeProperties.find(p => p.id === house?.property_id),
                    },
                  },
                };
              });
            break;
          case 'expenses':
          case 'expenses_analysis':
            data = storeExpenses;
            break;
          case 'stay_history':
            data = storeTenants.map(t => {
              const tContracts = storeContracts.filter(c => c.tenant_id === t.id);
              const tContractIds = tContracts.map(c => c.id);
              const tReceipts = storeReceipts.filter(
                r => r.contract_id && tContractIds.includes(r.contract_id),
              );

              return {
                ...t,
                contracts: tContracts,
                receipts: tReceipts,
              };
            });
            break;
          case 'holidays': {
            const allHolidays: any[] = [];
            storeContracts.forEach((c: any) => {
              const breaks = c.metadata?.breaks || [];
              if (breaks.length > 0) {
                const tenant = storeTenants.find(t => t.id === c.tenant_id);
                const house = storeHouses.find(h => h.id === c.house_id);
                const property = house
                  ? storeProperties.find(p => p.id === house.property_id)
                  : null;

                breaks.forEach((b: any) => {
                  const isAllTime =
                    extraOptions?.allTime ?? reportParams.holidays.allTime;
                  const isYTD =
                    extraOptions?.isYearToDate ??
                    extraOptions?.isYTD ??
                    reportParams.holidays.isYTD ??
                    false;
                  const statusFilter =
                    extraOptions?.status || reportParams.holidays.status;
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);

                  const breakStart = new Date(b.start_date);
                  const breakEnd =
                    !b.end_date || String(b.end_date).includes('2099')
                      ? new Date(2099, 11, 31)
                      : new Date(b.end_date);

                  // Status filter
                  if (statusFilter === 'active' && breakEnd < today) return;
                  if (statusFilter === 'past' && breakEnd >= today) return;

                  // Date filter
                  if (!isAllTime && extraOptions?.date) {
                    const hDate = new Date(extraOptions.date);
                    const filterYear = hDate.getFullYear();
                    const rangeStart = isYTD
                      ? new Date(filterYear, 0, 1)
                      : new Date(filterYear, hDate.getMonth(), 1);
                    const rangeEnd = new Date(
                      filterYear,
                      hDate.getMonth() + 1,
                      0,
                      23,
                      59,
                      59,
                      999,
                    );

                    if (breakStart > rangeEnd || breakEnd < rangeStart) return;
                  }

                  allHolidays.push({
                    ...b,
                    contractId: c.id,
                    tenantName: tenant?.name || 'Unknown',
                    propertyName: property?.name || 'Unknown',
                    houseNumber: house?.house_number || 'Unknown',
                    propertyId: property?.id,
                  });
                });
              }
            });
            data = allHolidays;
            break;
          }
          case 'promotions': {
            const promoAllTime = extraOptions?.allTime ?? reportParams.promotions.allTime;
            const promoYTD =
              extraOptions?.isYearToDate ??
              extraOptions?.isYTD ??
              reportParams.promotions.isYTD ??
              false;
            const promoStatus = extraOptions?.status || reportParams.promotions.status;
            const promoDate = extraOptions?.date ? new Date(extraOptions.date) : null;

            data = storePromotions
              .filter((p: any) => {
                // Status filter
                if (promoStatus === 'active' && p.status === 'inactive') return false;
                if (promoStatus === 'inactive' && p.status === 'active') return false;

                // Date filter
                if (!promoAllTime && promoDate && p.valid_from) {
                  const filterMonth = promoDate.getMonth();
                  const filterYear = promoDate.getFullYear();
                  const vDate = new Date(p.valid_from);
                  if (promoYTD) {
                    if (
                      vDate.getFullYear() !== filterYear ||
                      vDate.getMonth() > filterMonth
                    ) {
                      return false;
                    }
                  } else {
                    if (
                      vDate.getMonth() !== filterMonth ||
                      vDate.getFullYear() !== filterYear
                    ) {
                      return false;
                    }
                  }
                }
                return true;
              })
              .map((p: any) => ({
                ...p,
                propertyName: p.property_id
                  ? storeProperties.find(prop => prop.id === p.property_id)?.name
                  : null,
                tenantName: p.tenant_id
                  ? storeTenants.find(t => t.id === p.tenant_id)?.name
                  : null,
              }));
            break;
          }
          case 'breaks_with_payments': {
            const bpAllTime =
              extraOptions?.allTime ?? reportParams.breaks_with_payments.allTime;
            const bpYTD =
              extraOptions?.isYearToDate ??
              extraOptions?.isYTD ??
              reportParams.breaks_with_payments.isYTD ??
              false;
            const bpDate = extraOptions?.date
              ? new Date(extraOptions?.date)
              : reportParams.breaks_with_payments.date;
            const bpMonth = bpDate.getMonth() + 1;
            const bpYear = bpDate.getFullYear();
            const result: any[] = [];

            storeContracts.forEach((c: any) => {
              const breaks = c.metadata?.breaks || [];
              if (breaks.length === 0) return;

              const tenant = storeTenants.find(t => t.id === c.tenant_id);
              const house = storeHouses.find(h => h.id === c.house_id);
              const property = house
                ? storeProperties.find(p => p.id === house.property_id)
                : null;

              breaks.forEach((b: any) => {
                const breakStart = new Date(b.start_date);
                const breakEnd =
                  !b.end_date || String(b.end_date).includes('2099')
                    ? new Date(2099, 11, 31)
                    : new Date(b.end_date);

                const months: { month: number; year: number }[] = [];
                if (bpAllTime) {
                  const cur = new Date(
                    breakStart.getFullYear(),
                    breakStart.getMonth(),
                    1,
                  );
                  const maxAllowedDate = new Date(new Date().getFullYear() + 1, 11, 31);
                  const effectiveEnd = new Date(
                    Math.min(
                      new Date(breakEnd.getFullYear(), breakEnd.getMonth(), 1).getTime(),
                      maxAllowedDate.getTime(),
                    ),
                  );
                  while (cur <= effectiveEnd) {
                    months.push({ month: cur.getMonth() + 1, year: cur.getFullYear() });
                    cur.setMonth(cur.getMonth() + 1);
                  }
                } else if (bpYTD) {
                  for (let m = 1; m <= bpMonth; m++) {
                    const monthStart = new Date(bpYear, m - 1, 1);
                    const monthEnd = new Date(bpYear, m, 0);
                    if (breakStart <= monthEnd && breakEnd >= monthStart) {
                      months.push({ month: m, year: bpYear });
                    }
                  }
                } else {
                  const monthStart = new Date(bpYear, bpMonth - 1, 1);
                  const monthEnd = new Date(bpYear, bpMonth, 0);
                  if (breakStart > monthEnd || breakEnd < monthStart) return;
                  months.push({ month: bpMonth, year: bpYear });
                }

                months.forEach(({ month, year }) => {
                  const paidReceipts = storeReceipts.filter(r => {
                    const parsedPeriod = parsePeriod(r.payment_period);
                    return (
                      r.contract_id === c.id &&
                      parsedPeriod.month === month &&
                      parsedPeriod.year === year
                    );
                  });

                  const amountPaid = paidReceipts.reduce((sum: number, r: any) => {
                    if (r.status === 'promo' && !extraOptions?.includePromo) return sum;
                    const amount = parseFloat(String(r.amount || 0));
                    const refunded = parseFloat(String(r.refunded_amount || 0));
                    return sum + (amount - refunded);
                  }, 0);

                  if (amountPaid > 0) {
                    const monthLabel = formatPeriod({ month, year });
                    result.push({
                      tenant_name: tenant?.name || 'Unknown',
                      property: property?.name || 'Unknown',
                      house: house?.house_number || 'Unknown',
                      payment_month: monthLabel,
                      break_start: b.start_date,
                      break_end: b.end_date,
                      break_type: b.is_partial ? 'Partial Break' : 'Full Waiver',
                      rent_amount: c.rent_amount || 0,
                      amount_paid: amountPaid,
                    });
                  }
                });
              });
            });
            data = result;
            break;
          }
          case 'maintenance':
            data = storeMaintenanceRequests.map(m => ({
              ...m,
              property: storeProperties.find(p => p.id === m.property_id) || null,
              house: storeHouses.find(h => h.id === m.house_id) || null,
              tenant: storeTenants.find(t => t.id === m.tenant_id) || null,
            }));
            break;
          case 'vacant_rooms':
            data = storeHouses
              .filter(h => h.status === 'available')
              .map(h => ({
                ...h,
                property: storeProperties.find(p => p.id === h.property_id) || null,
                lastContract:
                  storeContracts
                    .filter(c => c.house_id === h.id)
                    .sort(
                      (a, b) =>
                        new Date((b as any).end_date || 0).getTime() -
                        new Date((a as any).end_date || 0).getTime(),
                    )[0] || null,
              }));
            break;
          case 'rent_collection':
            data = storeReceipts.map(r => {
              const contract = storeContracts.find(c => c.id === r.contract_id);
              const house = storeHouses.find(h => h.id === contract?.house_id);
              return {
                ...r,
                contract: contract
                  ? {
                      ...contract,
                      tenant: storeTenants.find(t => t.id === contract.tenant_id),
                      house: house
                        ? {
                            ...house,
                            property: storeProperties.find(
                              p => p.id === house.property_id,
                            ),
                          }
                        : null,
                    }
                  : null,
              };
            });
            break;
          case 'occupancy_rate':
            data = storeHouses.map(h => ({
              ...h,
              property: storeProperties.find(p => p.id === h.property_id),
              contracts: storeContracts.filter(c => c.house_id === h.id),
            }));
            break;
          case 'expiring_contracts':
            data = storeContracts.map(c => {
              const house = storeHouses.find(h => h.id === c.house_id);
              return {
                ...c,
                tenant: storeTenants.find(t => t.id === c.tenant_id),
                house: house
                  ? {
                      ...house,
                      property: storeProperties.find(p => p.id === house.property_id),
                    }
                  : null,
              };
            });
            break;
          case 'refunds':
            data = storeReceipts
              .filter(
                r =>
                  parseFloat(String(r.refunded_amount || 0)) > 0 ||
                  (r as any).is_refunded,
              )
              .map(r => {
                const contract = storeContracts.find(c => c.id === r.contract_id);
                const house = storeHouses.find(h => h.id === contract?.house_id);
                return {
                  ...r,
                  contract: contract
                    ? {
                        ...contract,
                        tenant: storeTenants.find(t => t.id === contract.tenant_id),
                        house: house
                          ? {
                              ...house,
                              property: storeProperties.find(
                                p => p.id === house.property_id,
                              ),
                            }
                          : null,
                      }
                    : null,
                };
              });
            break;
          default:
            data = [];
        }
      }

      const reportOptions = {
        groupByProperty:
          extraOptions?.groupByProperty ?? reportParams.tenants.groupByProperty,
        tenantStatus: extraOptions?.status || reportParams.tenants.status,
        propertyId:
          extraOptions?.propertyId === 'all' ? undefined : extraOptions?.propertyId,
        includeFormerTenants:
          extraOptions?.includeFormerTenants ||
          reportParams.receipts.includeFormerTenants,
        monthsBack: extraOptions?.monthsBack
          ? parseInt(extraOptions.monthsBack, 10)
          : parseInt(reportParams.receipts.monthsBack, 10),
        houseStatus: extraOptions?.status || reportParams.houses.status,
        contractStatus: extraOptions?.status || reportParams.contracts.status,
        missingEmail: extraOptions?.missingEmail || reportParams.tenants.missingEmail,
        missingPhone: extraOptions?.missingPhone || reportParams.tenants.missingPhone,
        missingNextOfKin:
          extraOptions?.missingNextOfKin || reportParams.tenants.missingNextOfKin,
        moveOutMonth:
          extraOptions?.moveOutMonth !== undefined
            ? extraOptions.moveOutMonth
            : reportParams.tenants.moveOutMonth,
        moveOutYTD:
          extraOptions?.isYTD !== undefined
            ? extraOptions.isYTD
            : (reportParams.tenants.isYTD ?? false),
        tenantId: extraOptions?.tenantId || reportParams.tenant_ledger.tenant?.id,
        groupByStatus:
          extraOptions?.groupByStatus ?? reportParams.tenant_ledger.groupByStatus,
        sortBy:
          extraOptions?.sortBy ||
          (reportType === 'stay_history'
            ? reportParams.stay_history.sortBy
            : reportType === 'holidays'
              ? reportParams.holidays.sortBy
              : reportType === 'promotions'
                ? reportParams.promotions.sortBy
                : undefined),
        sortOrder:
          extraOptions?.sortOrder ||
          (reportType === 'stay_history'
            ? reportParams.stay_history.sortOrder
            : reportType === 'holidays'
              ? reportParams.holidays.sortOrder
              : reportType === 'promotions'
                ? reportParams.promotions.sortOrder
                : undefined),
        groupBy:
          extraOptions?.groupBy ||
          (reportType === 'stay_history' ? reportParams.stay_history.groupBy : undefined),
        bookingStatus:
          extraOptions?.status ||
          (reportType === 'stay_history' ? reportParams.stay_history.status : undefined),
        holidayStatus: extraOptions?.status || reportParams.holidays.status,
        promotionStatus: extraOptions?.status || reportParams.promotions.status,
        includePromo:
          extraOptions?.includePromo ?? reportParams.breaks_with_payments.includePromo,
        allTime:
          extraOptions?.allTime ??
          (reportType === 'expenses_analysis'
            ? reportParams.expenses_analysis.allTime
            : reportType === 'promotions'
              ? reportParams.promotions.allTime
              : reportParams.holidays.allTime),
        date: extraOptions?.date,
        groupByPeriod: extraOptions?.groupByPeriod,
        isYearToDate:
          extraOptions?.isYearToDate ??
          extraOptions?.isYTD ??
          (reportType === 'pending_rent'
            ? reportParams.pending_rent.isYTD
            : reportType === 'expenses_analysis'
              ? reportParams.expenses_analysis.isYTD
              : reportType === 'business_summary'
                ? reportParams.business_summary.isYTD
                : reportType === 'holidays'
                  ? reportParams.holidays.isYTD
                  : reportType === 'promotions'
                    ? reportParams.promotions.isYTD
                    : reportType === 'breaks_with_payments'
                      ? reportParams.breaks_with_payments.isYTD
                      : reportParams.financials.isYTD),
        defaultCurrency,
        showDetails:
          extraOptions?.showDetails ?? reportParams.expenses_analysis.showDetails,
        // New report options
        maintenanceStatus:
          extraOptions?.maintenanceStatus ?? reportParams.maintenance?.status,
        maintenancePriority:
          extraOptions?.maintenancePriority ?? reportParams.maintenance?.priority,
        daysAhead: extraOptions?.daysAhead
          ? parseInt(extraOptions.daysAhead, 10)
          : parseInt(reportParams.expiring_contracts?.daysAhead || '30', 10),
        groupByMonth:
          extraOptions?.groupByMonth ??
          (reportType === 'occupancy_rate'
            ? reportParams.occupancy_rate?.groupByMonth
            : reportType === 'rent_collection'
              ? reportParams.rent_collection?.groupByMonth
              : undefined),
        startDate: extraOptions?.period?.start
          ? new Date(extraOptions.period.start)
          : reportType === 'rent_collection'
            ? reportParams.rent_collection?.startDate
            : reportType === 'occupancy_rate'
              ? reportParams.occupancy_rate?.startDate
              : undefined,
        endDate: extraOptions?.period?.end
          ? new Date(extraOptions.period.end)
          : reportType === 'rent_collection'
            ? reportParams.rent_collection?.endDate
            : reportType === 'occupancy_rate'
              ? reportParams.occupancy_rate?.endDate
              : undefined,
      };

      const {
        headers,
        data: processedData,
        filename,
      } = processReportData(reportType, data || [], reportOptions);

      const finalOrientation =
        extraOptions?.orientation ||
        orientation ||
        pendingExport?.orientation ||
        'portrait';

      const fullReportOptions = {
        ...reportOptions,
        orientation: finalOrientation,
      };

      if (format === 'pdf') {
        const htmlContent = generatePDFContent(
          processedData,
          reportType,
          selectedBusiness,
          headers,
          fullReportOptions,
        );
        const { uri } = await Print.printToFileAsync({
          html: htmlContent,
          base64: false,
          ...getPDFPrintOptions(reportType, finalOrientation),
        });

        if (!uri) throw new Error('Failed to generate PDF');

        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Share ${filename.replace('.csv', '.pdf')}`,
        });
      } else {
        const reportTypesInternal: any[] = [
          { id: 'financials', pdfOnly: true },
          { id: 'business_summary', pdfOnly: true },
        ];
        const reportTypeObj = reportTypesInternal.find(r => r.id === type);
        if (reportTypeObj?.pdfOnly) {
          showSnackbar('This report is only available in PDF format', 'info');
          return;
        }

        const csvContent = generateCSV(processedData, headers, reportType);
        const file = new File(Paths.cache, filename);
        file.write(csvContent);

        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: `Share ${filename}`,
        });
      }

      setSelectedReport(null);
      setShowFormatMenu(false);
    } catch (error) {
      console.error('Error exporting report:', error);
      showSnackbar('Failed to export report', 'error');
    } finally {
      setExportLoading(false);
    }
  };

  return {
    selectedBusiness,
    storeProperties,
    storeHouses,
    storeTenants,
    storeContracts,
    storeReceipts,
    storeExpenses,
    storeBookings,
    storePromotions,
    storeMaintenanceRequests,
    loading,
    setLoading,
    exportLoading,
    setExportLoading,
    selectedReport,
    setSelectedReport,
    showFormatMenu,
    setShowFormatMenu,
    activeModal,
    setActiveModal,
    reportParams,
    updateParam,
    handleExport,
    pendingExport,
    setPendingExport,
    hasAccess,
  };
}
