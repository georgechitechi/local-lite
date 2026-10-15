import { EXPENSE_CATEGORY } from '@/features/expenses/utils/expenseUtils';
import {
  formatDate,
  formatDateForDB,
  formatPeriod,
  parseLocalDate,
  parsePeriod,
} from '@/shared/utils/formatters';
import { calculateEffectiveRent, parseMetadata, properCase } from '@/shared/utils/helper';
import { extractMessageMetadata } from '@/shared/utils/parsers';
import {
  isActiveContractStatus,
  isActiveTenantStatus,
  isFormerTenantStatus,
} from '@/shared/utils/statusHelper';
import {
  findEarliestContractDate,
  findEarliestDate,
  getAllTimeStartDate,
  getEffectiveDate,
  getPropertyName,
  groupDataByPeriod,
  groupDataByProperty,
  groupDataByStatus,
  isCommissionedAsOf,
  isReportAllTime,
} from './helpers';
import type { ReportData, ReportType } from './types';
export const processReportData = (
  type: ReportType,
  reportData: unknown[],
  options?: {
    tenantStatus?: 'active' | 'former';
    propertyId?: string;
    includeFormerTenants?: boolean;
    monthsBack?: number;
    houseStatus?: string;
    missingEmail?: boolean;
    missingPhone?: boolean;
    missingNextOfKin?: boolean;
    contractStatus?: 'all' | 'active' | 'archived';
    groupByProperty?: boolean;
    groupByStatus?: boolean;
    groupBy?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    bookingStatus?: 'active' | 'former' | 'all';
    holidayStatus?: 'all' | 'active' | 'past';
    holidayDate?: Date;
    promotionStatus?: 'all' | 'active' | 'inactive';
    promotionDate?: Date;
    tenantId?: string;
    startDate?: Date;
    endDate?: Date;
    includePromo?: boolean;
    allTime?: boolean;
    groupByPeriod?: boolean;
    date?: Date;
    isYearToDate?: boolean;
    defaultCurrency?: any;
    expenseCategories?: string[];
    showDetails?: boolean;
    maintenanceStatus?: string;
    maintenancePriority?: string;
    daysAhead?: number;
    groupByMonth?: boolean;
    moveOutMonth?: Date | null;
    moveOutYTD?: boolean;
  },
): ReportData => {
  let data: Record<string, unknown>[] = [];
  let headers: string[] = [];
  let filename = `report_${type}_${formatDateForDB(new Date())}.csv`;

  // Handle null or empty data
  if (!reportData || reportData.length === 0) {
    return {
      data: [{ message: 'No data found for this report' }],
      headers: ['message'],
      filename: `${type}_report.csv`,
    };
  }

  switch (type) {
    case 'expenses': {
      // Sort expenses by date (newest first)
      const sortedExpenses = [
        ...(reportData as {
          date: string;
          category?: string;
          amount?: number | string;
        }[]),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      data = sortedExpenses.map(expense => ({
        category: expense.category || '',
        amount: (expense.amount || 0).toLocaleString(),
        date: formatDate(expense.date),
      }));

      // Add category totals
      const categoryTotals = (
        reportData as { category?: string; amount?: number | string }[]
      ).reduce((acc: Record<string, number>, expense) => {
        const category = expense.category || 'Other';
        if (!acc[category]) {
          acc[category] = 0;
        }
        acc[category] += parseFloat(String(expense.amount || 0));
        return acc;
      }, {});

      // Add total row
      const totalAmount = Object.values(categoryTotals).reduce(
        (sum, amount) => sum + amount,
        0,
      );
      data.push({
        category: 'TOTAL',
        amount: totalAmount.toLocaleString(),
        date: '',
      });

      headers = ['category', 'amount', 'date'];
      filename = 'expenses_report.csv';
      break;
    }

    case 'expenses_analysis': {
      const resAnalysis = processExpensesAnalysis(reportData, options);
      data = resAnalysis.data;
      headers = resAnalysis.headers;
      filename = resAnalysis.filename;
      break;
    }

    case 'houses':
      data = (
        reportData as {
          property?: { name: string };
          house_number?: string;
          type?: string;
          status?: string;
          monthly_rent?: number | string;
          contracts?: { status: string; tenant?: { name: string } }[];
        }[]
      )
        .filter(h => {
          const matchesProperty =
            !options?.propertyId || (h as any).property_id === options.propertyId;
          const matchesStatus =
            !options?.houseStatus ||
            options.houseStatus === 'all' ||
            h.status === options.houseStatus;
          return matchesProperty && matchesStatus;
        })
        .map(h => {
          const activeContract = h.contracts?.find(c => isActiveContractStatus(c.status));

          const effDate = getEffectiveDate(h);
          const effDateStr = effDate ? formatDate(effDate) : 'Unknown';
          const isFuture = !isCommissionedAsOf(h, new Date());

          return {
            property: getPropertyName(h.property),
            house_number: h.house_number || '',
            type: h.type || '',
            status: isFuture ? 'Pre-Commissioned' : h.status || '',
            monthly_rent: (h.monthly_rent || 0).toLocaleString(),
            current_tenant: activeContract?.tenant?.name || '-',
            commissioned_on: effDateStr,
          };
        })
        .sort((a, b) => {
          if (a.property !== b.property) {
            return a.property.localeCompare(b.property);
          }
          if (a.type !== b.type) {
            return a.type.localeCompare(b.type);
          }
          return String(a.house_number).localeCompare(String(b.house_number), undefined, {
            numeric: true,
          });
        });

      if (options?.groupByProperty) {
        data = groupDataByProperty(data);
      }

      headers = [
        'property',
        'house_number',
        'type',
        'status',
        'monthly_rent',
        'current_tenant',
        'commissioned_on',
      ];
      filename = 'houses_report.csv';
      break;

    case 'receipts': {
      const resReceipts = processReceipts(reportData, options);
      data = resReceipts.data;
      headers = resReceipts.headers;
      filename = resReceipts.filename;
      break;
    }

    case 'tenants': {
      data = (
        reportData as {
          name?: string;
          phone?: string;
          email?: string;
          next_of_kin?: any[];
          status?: string;
          contracts?: {
            status: string;
            start_date?: string;
            end_date?: string;
            house?: { house_number?: string };
            property?: { name?: string };
          }[];
        }[]
      )
        .filter(t => {
          const status = t.status?.toLowerCase() || '';
          let inStatusBucket = false;

          if (options?.tenantStatus === 'former') {
            inStatusBucket = isFormerTenantStatus(status);
          } else {
            inStatusBucket = isActiveTenantStatus(status);
          }

          if (!inStatusBucket) return false;

          // Move-out date filter: exact month, YTD (this calendar year), or all time (no filter)
          if (options?.moveOutYTD) {
            // Year-to-date: moved out any month in the current calendar year
            const currentYear = new Date().getFullYear();
            const endedContracts = (t.contracts || [])
              .filter((c: any) => c.end_date)
              .sort(
                (a: any, b: any) =>
                  new Date(b.end_date).getTime() - new Date(a.end_date).getTime(),
              );
            if (endedContracts.length === 0) return false;
            const latestEnd = new Date(endedContracts[0].end_date as any);
            if (latestEnd.getFullYear() !== currentYear) return false;
          } else if (options?.moveOutMonth) {
            // Specific month filter
            const filterYear = options.moveOutMonth.getFullYear();
            const filterMonth = options.moveOutMonth.getMonth(); // 0-indexed

            // Find the most recent contract that ended (expired / terminated)
            const endedContracts = (t.contracts || [])
              .filter((c: any) => c.end_date)
              .sort(
                (a: any, b: any) =>
                  new Date(b.end_date).getTime() - new Date(a.end_date).getTime(),
              );

            if (endedContracts.length === 0) return false;

            const latestEnd = new Date(endedContracts[0].end_date as any);
            if (
              latestEnd.getFullYear() !== filterYear ||
              latestEnd.getMonth() !== filterMonth
            ) {
              return false;
            }
          }
          // else: allTime — no date filter applied

          // Additional filters
          if (options?.missingEmail) {
            if (t.email && t.email.trim() !== '') return false;
          }
          if (options?.missingPhone) {
            if (t.phone && t.phone.trim() !== '') return false;
          }
          if (options?.missingNextOfKin) {
            // Check if array exists and has elements
            if (Array.isArray(t.next_of_kin) && t.next_of_kin.length > 0) return false;
            // Also handle case where it might be non-null but valid?
            // If it is [ ] it has length 0.
          }

          return true;
        })
        .map(t => {
          const activeContract =
            t.contracts?.find(c => isActiveContractStatus(c.status)) || t.contracts?.[0];

          // For former tenants: show the most recent move-out date
          // For active tenants: show their contract start (join) date
          let dateLabel = '-';
          let dateColumnKey = 'date';

          if (options?.tenantStatus === 'former') {
            dateColumnKey = 'move_out_date';
            const endedContracts = (t.contracts || [])
              .filter((c: any) => c.end_date)
              .sort(
                (a: any, b: any) =>
                  new Date(b.end_date).getTime() - new Date(a.end_date).getTime(),
              );
            if (endedContracts.length > 0) {
              dateLabel = new Date(
                endedContracts[0].end_date as any,
              ).toLocaleDateString();
            }
          } else {
            dateColumnKey = 'move_in_date';
            if (activeContract?.start_date) {
              dateLabel = new Date(activeContract.start_date).toLocaleDateString();
            }
          }

          return {
            name: t.name || '-',
            phone: t.phone || '-',
            property: getPropertyName(activeContract?.property),
            house_number: activeContract?.house?.house_number || 'Not assigned',
            [dateColumnKey]: dateLabel,
          };
        })
        .sort((a, b) => {
          if (a.property !== b.property) {
            return (a.property as string).localeCompare(b.property as string);
          }
          return String(a.house_number).localeCompare(String(b.house_number), undefined, {
            numeric: true,
          });
        });

      if (options?.groupByProperty) {
        data = groupDataByProperty(data);
      }

      const dateCol =
        options?.tenantStatus === 'former' ? 'move_out_date' : 'move_in_date';
      headers = ['name', 'phone', 'property', 'house_number', dateCol];
      filename = `tenants_${options?.tenantStatus || 'active'}_report_${formatDateForDB(
        new Date(),
      )}.csv`;
      break;
    }

    case 'contracts':
      data = (
        reportData as {
          tenant?: { name?: string };
          house?: { house_number?: string };
          property?: { name?: string };
          start_date?: string;
          end_date?: string;
          rent_amount?: number | string;
          status?: string;
        }[]
      )
        .filter(c => {
          const status = c.status?.toLowerCase() || '';

          if (!options?.contractStatus || options.contractStatus === 'all') return true;

          // Status Bucket Filter
          if (options.contractStatus === 'archived') {
            if (status !== 'expired' && status !== 'terminated') return false;
          } else {
            if (!isActiveContractStatus(status)) return false;
          }

          return true;
        })
        .map(c => ({
          tenant_name: c.tenant?.name || 'Not assigned',
          property: getPropertyName(c.property),
          house_number: c.house?.house_number || 'Not assigned',
          start_date: c.start_date || 'Not assigned',
          end_date: c.end_date || 'Not assigned',
          rent_amount: c.rent_amount || 'Not assigned',
          status: c.status || 'Not assigned',
        }))
        .sort((a, b) => {
          if (a.property !== b.property) {
            return a.property.localeCompare(b.property);
          }
          return String(a.house_number).localeCompare(String(b.house_number), undefined, {
            numeric: true,
          });
        });

      if (options?.groupByProperty) {
        data = groupDataByProperty(data);
      }

      headers = [
        'tenant_name',
        'property',
        'house_number',
        'start_date',
        'end_date',
        'rent_amount',
        'status',
      ];
      filename = `contracts_${options?.contractStatus || 'active'}_report.csv`;
      break;

    case 'pending_rent':
      data = (
        reportData as {
          property_name?: string;
          house_number?: string;
          tenant_name?: string;
          tenant_phone?: string;
          contract_amount?: number | string;
          amount_paid?: number | string;
          amount_pending?: number | string;
          payment_status?: string;
          current_month?: number;
          current_year?: number;
          target_month?: number;
          target_year?: number;
        }[]
      )
        .map(item => {
          const m = item.current_month || item.target_month;
          const y = item.current_year || item.target_year;
          return {
            period: m && y ? formatPeriod({ month: m, year: y }) : 'N/A',
            property: item.property_name || 'Unknown',
            house_number: item.house_number || 'Unknown',
            tenant: item.tenant_name || 'Unknown',
            phone: item.tenant_phone || 'N/A',
            contract_amount: (item.contract_amount || 0).toLocaleString(),
            amount_paid: (item.amount_paid || 0).toLocaleString(),
            amount_pending: (item.amount_pending || 0).toLocaleString(),
            payment_status: item.payment_status || 'unpaid',
            current_month: m,
            current_year: y,
          };
        })
        .sort((a, b) => {
          // If grouping by period, sort by month/year first
          if (options?.groupByPeriod) {
            const yearA = parseInt(String(a.current_year || 0), 10);
            const yearB = parseInt(String(b.current_year || 0), 10);
            if (yearA !== yearB) return yearA - yearB;
            const monthA = parseInt(String(a.current_month || 0), 10);
            const monthB = parseInt(String(b.current_month || 0), 10);
            if (monthA !== monthB) return monthA - monthB;
          }

          const propertyCompare = String(a.property).localeCompare(String(b.property));
          if (propertyCompare !== 0) return propertyCompare;
          return String(a.house_number).localeCompare(String(b.house_number), undefined, {
            numeric: true,
          });
        });

      if (options?.groupByPeriod) {
        data = groupDataByPeriod(data);
      } else if (options?.groupByProperty) {
        data = groupDataByProperty(data);
      }

      headers = [
        'period',
        'property',
        'house_number',
        'tenant',
        'phone',
        'contract_amount',
        'amount_paid',
        'amount_pending',
        'payment_status',
        'current_month',
        'current_year',
      ];
      filename = 'pending_rent_report.csv';
      break;

    case 'financials':
      data = (reportData as any[]).map(row => ({
        period: row.period,
        total_revenue: parseFloat(row.total_revenue).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        total_expenses: parseFloat(row.total_expenses).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        net_profit: parseFloat(row.net_profit).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      }));
      headers = ['period', 'total_revenue', 'total_expenses', 'net_profit'];
      filename = `financials_report_${formatDateForDB(new Date())}.csv`;
      break;

    case 'stay_history': {
      const tenants = (reportData as any[]).filter(t => {
        // Must have at least one contract to be in a "stay" report
        if (!t.contracts || t.contracts.length === 0) return false;

        const statusFilter = options?.bookingStatus || 'active';
        if (statusFilter === 'all') return true;

        const hasActiveContract = t.contracts.some((c: any) =>
          isActiveContractStatus(c.status),
        );

        if (statusFilter === 'active') return hasActiveContract;
        if (statusFilter === 'former') return !hasActiveContract;

        return true;
      });

      data = tenants
        .map(t => {
          const tContracts = (t.contracts || []).sort(
            (a: any, b: any) =>
              new Date(a.start_date || 0).getTime() -
              new Date(b.start_date || 0).getTime(),
          );

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          let checkIn = t.created_at ? new Date(t.created_at) : today;
          let checkOut = today;
          let totalRevenue = 0;

          if (tContracts.length > 0) {
            // Check-in is the first contract start date
            if (tContracts[0].start_date) {
              checkIn = new Date(tContracts[0].start_date);
              checkIn.setHours(0, 0, 0, 0);
            }

            // Check-out is the last contract end date, capped at today
            const lastContract = tContracts[tContracts.length - 1];
            if (lastContract.end_date) {
              const endD = new Date(lastContract.end_date);
              endD.setHours(0, 0, 0, 0);
              checkOut = endD > today ? today : endD;
            }

            // Sum revenue from actual receipts
            const receipts = t.receipts || [];
            totalRevenue = receipts.reduce((sum: number, r: any) => {
              if (r.status === 'promo' && !options?.includePromo) return sum;
              const amount = parseFloat(String(r.amount || 0));
              const refunded = parseFloat(String(r.refunded_amount || 0));
              return sum + (amount - refunded);
            }, 0);
          }

          const nights = Math.max(
            1,
            Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)),
          );

          return {
            guest: t.name || 'Unknown',
            status: t.status || 'active',
            check_in: formatDate(checkIn),
            check_out: formatDate(checkOut),
            nights: nights.toString(),
            revenue: totalRevenue.toLocaleString(),
            raw_check_in: checkIn.getTime(),
            raw_revenue: totalRevenue,
            raw_nights: nights,
            raw_guest: (t.name || 'Unknown').toLowerCase(),
          };
        })
        .sort((a, b) => {
          const sortBy = options?.sortBy || 'check_in';
          const sortOrder = options?.sortOrder || 'asc';
          let comparison = 0;

          switch (sortBy) {
            case 'guest':
              comparison = a.raw_guest.localeCompare(b.raw_guest);
              break;
            case 'revenue':
              comparison = a.raw_revenue - b.raw_revenue;
              break;
            case 'nights':
              comparison = a.raw_nights - b.raw_nights;
              break;
            default:
              comparison = a.raw_check_in - b.raw_check_in;
          }

          return sortOrder === 'asc' ? comparison : -comparison;
        });

      if (options?.groupBy === 'property') {
        data = groupDataByProperty(data);
      } else if (options?.groupBy === 'status') {
        data = groupDataByStatus(data);
      }

      data = data.map(item => {
        const rest = { ...item };
        delete rest.raw_check_in;
        delete rest.raw_revenue;
        delete rest.raw_nights;
        delete rest.raw_guest;
        return rest;
      });

      headers = ['guest', 'status', 'check_in', 'check_out', 'nights', 'revenue'];
      filename = 'bookings_report.csv';
      break;
    }

    case 'tenant_ledger': {
      const tenantReceipts = (reportData as any[]).filter(r => {
        if (r.contract?.tenant_id !== options?.tenantId) return false;
        if (r.status === 'promo' && !options?.includePromo) return false;
        return true;
      });

      const ledgerRows: any[] = [];

      tenantReceipts.forEach(r => {
        const amountDue = r.contract?.rent_amount || 0;
        const totalPaidOnReceipt =
          parseFloat(String(r.amount || 0)) - parseFloat(String(r.refunded_amount || 0));
        const periodObj =
          typeof r.payment_period === 'string'
            ? parsePeriod(r.payment_period)
            : r.payment_period;
        const periodYear = periodObj?.year || 0;
        const periodMonth = periodObj?.month || 0;
        const period = formatPeriod(periodObj || { month: 0, year: 0 });
        const propertyName = getPropertyName(r.contract?.house?.property);
        const houseNum = r.contract?.house?.house_number || '-';
        const tenantName = r.contract?.tenant?.name || 'Unknown';

        if (r.payment_messages && r.payment_messages.length > 0) {
          let first = true;
          let sumMessages = 0;
          const sortedMsgs = [...r.payment_messages].sort(
            (m1, m2) =>
              new Date(m1.transaction_date || 0).getTime() -
              new Date(m2.transaction_date || 0).getTime(),
          );

          sortedMsgs.forEach(pm => {
            const parsedMeta = extractMessageMetadata(pm.message_content || '');
            const pmAmount = parsedMeta.amount
              ? parseFloat(String(parsedMeta.amount))
              : 0;
            sumMessages += pmAmount;

            ledgerRows.push({
              date: pm.transaction_date ? formatDate(pm.transaction_date) : '-',
              period: period,
              property: propertyName,
              house: houseNum,
              amount_due: 0,
              amount_paid: pmAmount.toLocaleString(),
              status: r.status || 'paid',
              tenant_name: tenantName,
              reference: parsedMeta.ref || 'MPesa/Bank',
              _raw_year: periodYear,
              _raw_month: periodMonth,
              _raw_date: pm.transaction_date
                ? new Date(pm.transaction_date).getTime()
                : 0,
              _raw_charge: first ? amountDue : 0,
              _raw_paid: pmAmount,
            });
            first = false;
          });

          if (totalPaidOnReceipt > sumMessages) {
            const diff = totalPaidOnReceipt - sumMessages;
            ledgerRows.push({
              date: r.payment_date ? formatDate(r.payment_date) : '-',
              period: period,
              property: propertyName,
              house: houseNum,
              amount_due: 0,
              amount_paid: diff.toLocaleString(),
              status: 'manual payment',
              tenant_name: tenantName,
              reference: 'Manual/Other',
              _raw_year: periodYear,
              _raw_month: periodMonth,
              _raw_date: r.payment_date ? new Date(r.payment_date).getTime() : 0,
              _raw_charge: first ? amountDue : 0,
              _raw_paid: diff,
            });
          }
        } else {
          ledgerRows.push({
            date: r.payment_date ? formatDate(r.payment_date) : '-',
            period: period,
            property: propertyName,
            house: houseNum,
            amount_due: 0,
            amount_paid: totalPaidOnReceipt.toLocaleString(),
            status: r.status || 'paid',
            tenant_name: tenantName,
            reference: 'Manual',
            _raw_year: periodYear,
            _raw_month: periodMonth,
            _raw_date: r.payment_date ? new Date(r.payment_date).getTime() : 0,
            _raw_charge: amountDue,
            _raw_paid: totalPaidOnReceipt,
          });
        }
      });

      // Sort by period (year -> month) then by date
      ledgerRows.sort((a, b) => {
        if (a._raw_year !== b._raw_year) return a._raw_year - b._raw_year;
        if (a._raw_month !== b._raw_month) return a._raw_month - b._raw_month;
        return a._raw_date - b._raw_date;
      });

      // Calculate sequential balance
      let runningBalance = 0;
      ledgerRows.forEach(row => {
        runningBalance += row._raw_charge || 0;
        row.amount_due = runningBalance.toLocaleString();
        runningBalance -= row._raw_paid || 0;
      });

      // Clean up raw fields
      data = ledgerRows.map(row => {
        const rest = { ...row };
        delete rest._raw_year;
        delete rest._raw_month;
        delete rest._raw_date;
        delete rest._raw_charge;
        delete rest._raw_paid;
        return rest;
      });

      if (options?.groupByStatus) {
        data = groupDataByStatus(data);
      }

      headers = [
        'date',
        'period',
        'property',
        'house',
        'amount_due',
        'amount_paid',
        'status',
        'reference',
      ];
      const ledgerTenantName =
        tenantReceipts[0]?.contract?.tenant?.name || options?.tenantId || 'Unknown';
      filename = `tenant_ledger_${ledgerTenantName.replace(/\s+/g, '_')}_${formatDateForDB(new Date())}.csv`;
      break;
    }

    case 'holidays': {
      const todayStr = formatDateForDB(new Date());
      data = (reportData as any[])
        .filter(h => {
          if (!options?.holidayStatus || options.holidayStatus === 'all') return true;
          const end = h.end_date || '';
          if (options.holidayStatus === 'active') return todayStr <= end;
          if (options.holidayStatus === 'past') return todayStr > end;
          return true;
        })
        .filter(h => {
          if (!options?.holidayDate) return true;
          const filterDate = options.holidayDate;
          const startOfMonth = new Date(
            filterDate.getFullYear(),
            filterDate.getMonth(),
            1,
          );
          const endOfMonth = new Date(
            filterDate.getFullYear(),
            filterDate.getMonth() + 1,
            0,
          );

          const hStart = new Date(h.start_date);
          const hEnd = new Date(h.end_date);

          // Standard overlap check: (StartA <= EndB) and (EndA >= StartB)
          return hStart <= endOfMonth && hEnd >= startOfMonth;
        })
        .map(h => ({
          property: h.propertyName || 'Unknown',
          house: h.houseNumber || 'Unknown',
          tenant: h.tenantName || 'Unknown',
          start_date: h.start_date ? formatDate(h.start_date) : '-',
          end_date: h.end_date ? formatDate(h.end_date) : '-',
          type: h.is_partial ? 'Partial Rent' : 'Full Break',
          reason: h.reason || '-',
          _raw_start: h.start_date || '',
          _raw_tenant: (h.tenantName || '').toLowerCase(),
          _raw_property: (h.propertyName || '').toLowerCase(),
        }))
        .sort((a, b) => {
          // Automatic sorting: Property -> House
          let comparison = a._raw_property.localeCompare(b._raw_property);
          if (comparison === 0) {
            comparison = String(a.house).localeCompare(String(b.house), undefined, {
              numeric: true,
            });
          }
          return comparison;
        });

      if (options?.groupByProperty) {
        data = groupDataByProperty(data);
      }

      data = data.map(item => {
        const rest = { ...item };
        delete rest._raw_start;
        delete rest._raw_tenant;
        delete rest._raw_property;
        return rest;
      });

      headers = [
        'property',
        'house',
        'tenant',
        'start_date',
        'end_date',
        'type',
        'reason',
      ];
      filename = `holidays_report_${formatDateForDB(new Date())}.csv`;
      break;
    }

    case 'promotions':
      data = (reportData as any[])
        .filter(p => {
          if (!options?.promotionStatus || options.promotionStatus === 'all') return true;
          if (options.promotionStatus === 'active') return p.is_active;
          if (options.promotionStatus === 'inactive') return !p.is_active;
          return true;
        })
        .filter(p => {
          if (!options?.promotionDate) return true;
          const filterDate = options.promotionDate;
          const startOfMonth = new Date(
            filterDate.getFullYear(),
            filterDate.getMonth(),
            1,
          );
          const endOfMonth = new Date(
            filterDate.getFullYear(),
            filterDate.getMonth() + 1,
            0,
          );

          const pStart = p.valid_from ? new Date(p.valid_from) : null;
          const pEnd = p.valid_until ? new Date(p.valid_until) : null;

          if (!pStart) return true;

          // Overlap check: Promotion starts before end of month AND (it has no end OR ends after start of month)
          return pStart <= endOfMonth && (!pEnd || pEnd >= startOfMonth);
        })
        .map(p => ({
          code: p.code || 'Unknown',
          type:
            p.type === 'full_month'
              ? 'Full Month Free'
              : p.type === 'fixed'
                ? 'Fixed Amount'
                : 'Percentage',
          amount: p.amount
            ? p.type === 'percentage'
              ? `${p.amount}%`
              : parseFloat(String(p.amount)).toLocaleString()
            : '-',
          scope: p.scope || 'business',
          target:
            p.scope === 'property'
              ? p.propertyName || 'Unknown Property'
              : p.scope === 'tenant'
                ? p.tenantName || 'Unknown Tenant'
                : 'All',
          valid_from: p.valid_from ? formatDate(p.valid_from) : '-',
          valid_until: p.valid_until ? formatDate(p.valid_until) : 'No Expiry',
          status: p.is_active ? 'Active' : 'Inactive',
          _raw_code: (p.code || '').toLowerCase(),
          _raw_type: (p.type || '').toLowerCase(),
          _raw_valid_from: p.valid_from || '',
        }))
        .sort((a, b) => {
          // Automatic sorting: Promotion Code
          return a._raw_code.localeCompare(b._raw_code);
        });

      data = data.map(item => {
        const rest = { ...item };
        delete rest._raw_code;
        delete rest._raw_type;
        delete rest._raw_valid_from;
        return rest;
      });

      headers = [
        'code',
        'type',
        'amount',
        'scope',
        'target',
        'valid_from',
        'valid_until',
        'status',
      ];
      filename = `promotions_report_${formatDateForDB(new Date())}.csv`;
      break;

    case 'breaks_with_payments':
      data = (reportData as any[])
        .map(r => ({
          property: r.property,
          house: r.house,
          tenant_name: r.tenant_name,
          payment_month: r.payment_month,
          break_start: r.break_start ? formatDate(r.break_start) : '-',
          break_end: r.break_end ? formatDate(r.break_end) : '-',
          rent_amount: parseFloat(String(r.rent_amount || 0)).toLocaleString(),
          amount_paid: parseFloat(String(r.amount_paid || 0)).toLocaleString(),
        }))
        .sort((a, b) => {
          const propCmp = a.property.localeCompare(b.property);
          if (propCmp !== 0) return propCmp;
          return a.house.localeCompare(b.house);
        });

      headers = [
        'property',
        'house',
        'tenant_name',
        'payment_month',
        'break_start',
        'break_end',
        'rent_amount',
        'amount_paid',
      ];
      filename = `breaks_with_payments_report_${formatDateForDB(new Date())}.csv`;
      break;

    case 'business_summary':
      data = reportData as Record<string, unknown>[];
      headers = [];
      filename = `business_summary_report_${formatDateForDB(new Date())}.pdf`;
      break;

    case 'maintenance': {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      data = (reportData as any[])
        .filter(m => {
          if (options?.propertyId && m.property_id !== options.propertyId) return false;
          const statusFilter = options?.maintenanceStatus || 'all';
          if (statusFilter !== 'all' && m.status !== statusFilter) return false;
          const priorityFilter = options?.maintenancePriority || 'all';
          if (priorityFilter !== 'all' && m.priority !== priorityFilter) return false;
          return true;
        })
        .map(m => ({
          property: m.property?.name || 'Not assigned',
          house:
            m.house?.house_number ||
            (m.affected_houses?.length ? m.affected_houses.join(', ') : 'General'),
          tenant: m.tenant?.name || '-',
          description: m.description || '-',
          priority: properCase(m.priority || 'low'),
          status: properCase((m.status || 'pending').replace(/_/g, ' ')),
          event_date: m.event_date ? formatDate(m.event_date) : '-',
          created_at: m.created_at ? formatDate(m.created_at) : '-',
          _raw_property: (m.property?.name || '').toLowerCase(),
        }))
        .sort((a, b) => {
          const propCmp = a._raw_property.localeCompare(b._raw_property);
          if (propCmp !== 0) return propCmp;
          return a.house.localeCompare(b.house, undefined, { numeric: true });
        });

      if (options?.groupByProperty) {
        data = groupDataByProperty(data);
      }

      data = data.map(({ _raw_property, ...rest }) => rest);

      headers = [
        'property',
        'house',
        'tenant',
        'description',
        'priority',
        'status',
        'event_date',
        'created_at',
      ];
      filename = `maintenance_report_${formatDateForDB(new Date())}.csv`;
      break;
    }

    case 'vacant_rooms': {
      const todayV = new Date();
      todayV.setHours(0, 0, 0, 0);
      data = (reportData as any[])
        .filter(h => {
          if (options?.propertyId && h.property_id !== options.propertyId) return false;

          if (!isCommissionedAsOf(h, todayV)) return false;

          return h.status === 'available';
        })
        .map(h => {
          const lastEndDate = h.lastContract?.end_date
            ? new Date(h.lastContract.end_date)
            : null;
          const daysVacant = lastEndDate
            ? Math.max(
                0,
                Math.floor(
                  (todayV.getTime() - lastEndDate.getTime()) / (1000 * 60 * 60 * 24),
                ),
              )
            : null;
          return {
            property: h.property?.name || 'Not assigned',
            house_number: h.house_number || '-',
            type: h.type || '-',
            monthly_rent: (h.monthly_rent || 0).toLocaleString(),
            last_vacated: lastEndDate ? formatDate(lastEndDate) : 'Never occupied',
            days_vacant: daysVacant !== null ? String(daysVacant) : 'Unknown',
            _raw_property: (h.property?.name || '').toLowerCase(),
          };
        })
        .sort((a, b) => {
          const propCmp = a._raw_property.localeCompare(b._raw_property);
          if (propCmp !== 0) return propCmp;
          return a.house_number.localeCompare(b.house_number, undefined, {
            numeric: true,
          });
        });

      if (options?.groupByProperty) {
        data = groupDataByProperty(data);
      }

      data = data.map(({ _raw_property, ...rest }) => rest);

      headers = [
        'property',
        'house_number',
        'type',
        'monthly_rent',
        'last_vacated',
        'days_vacant',
      ];
      filename = `vacant_rooms_report_${formatDateForDB(new Date())}.csv`;
      break;
    }

    case 'rent_collection': {
      const isRcAllTime = isReportAllTime(options);

      let rcStartDate: Date;
      let rcEndDate: Date = new Date();
      rcEndDate.setHours(23, 59, 59, 999);

      if (isRcAllTime) {
        let earliestDate = findEarliestDate(reportData as any[], 'payment_date');
        (reportData as any[]).forEach(r => {
          const houseEffective = getEffectiveDate(r.contract?.house);
          if (houseEffective && (!earliestDate || houseEffective < earliestDate)) {
            earliestDate = houseEffective;
          }
        });
        rcStartDate = getAllTimeStartDate(earliestDate);
        rcEndDate = new Date();
        rcEndDate.setHours(23, 59, 59, 999);
      } else {
        rcStartDate = options?.startDate ? new Date(options.startDate) : new Date();
        rcStartDate.setHours(0, 0, 0, 0);
        rcEndDate = options?.endDate ? new Date(options.endDate) : new Date();
        rcEndDate.setHours(23, 59, 59, 999);
      }

      const inRange = (dateStr: string) => {
        const d = new Date(dateStr);
        return d >= rcStartDate && d <= rcEndDate;
      };

      // Filter receipts to date range and optional property
      const rcReceipts = (reportData as any[]).filter(r => {
        if (!r.payment_date || !inRange(r.payment_date)) return false;
        if (options?.propertyId && r.contract?.house?.property_id !== options.propertyId)
          return false;
        if (r.status === 'promo') return false;
        return true;
      });

      // Build a map: propertyId -> { propertyName, expected, collected }
      const propertyMap: Record<
        string,
        { propertyName: string; expected: number; collected: number; units: Set<string> }
      > = {};

      rcReceipts.forEach(r => {
        const propName = r.contract?.house?.property?.name || 'Unknown';
        const propId = r.contract?.house?.property_id || 'unknown';
        const houseId = r.contract?.house_id || 'unknown';
        if (!propertyMap[propId]) {
          propertyMap[propId] = {
            propertyName: propName,
            expected: 0,
            collected: 0,
            units: new Set(),
          };
        }
        const amount = parseFloat(String(r.amount || 0));
        const refunded = parseFloat(String(r.refunded_amount || 0));
        propertyMap[propId].collected += amount - refunded;
        propertyMap[propId].units.add(houseId);
        const rentAmount = parseFloat(String(r.contract?.rent_amount || 0));
        propertyMap[propId].expected += rentAmount;
      });

      data = Object.values(propertyMap)
        .map(p => ({
          property: p.propertyName,
          units: String(p.units.size),
          expected: p.expected.toLocaleString(),
          collected: p.collected.toLocaleString(),
          collection_rate:
            p.expected > 0 ? `${((p.collected / p.expected) * 100).toFixed(1)}%` : '0%',
          shortfall: Math.max(0, p.expected - p.collected).toLocaleString(),
        }))
        .sort((a, b) => a.property.localeCompare(b.property));

      headers = [
        'property',
        'units',
        'expected',
        'collected',
        'collection_rate',
        'shortfall',
      ];
      filename = `rent_collection_report_${formatDateForDB(new Date())}.csv`;
      break;
    }

    case 'occupancy_rate': {
      // allTime = ignore date range, find earliest contract ever and build months from there
      const isAllTime = isReportAllTime(options);

      const allHouses = (reportData as any[]).filter(
        h => !options?.propertyId || h.property_id === options.propertyId,
      );

      let ocStartDate: Date;
      let ocEndDate: Date = new Date();

      if (isAllTime) {
        ocStartDate = getAllTimeStartDate(findEarliestContractDate(allHouses));
      } else {
        ocStartDate = options?.startDate
          ? new Date(options.startDate)
          : (() => {
              const d = new Date();
              d.setMonth(0, 1);
              return d;
            })();
        ocEndDate = options?.endDate ? new Date(options.endDate) : new Date();
      }

      // Build list of months in the range
      const months: { month: number; year: number; label: string }[] = [];
      const cur = new Date(ocStartDate.getFullYear(), ocStartDate.getMonth(), 1);
      const last = new Date(ocEndDate.getFullYear(), ocEndDate.getMonth(), 1);
      while (cur <= last) {
        months.push({
          month: cur.getMonth() + 1,
          year: cur.getFullYear(),
          label: formatPeriod({ month: cur.getMonth() + 1, year: cur.getFullYear() }),
        });
        cur.setMonth(cur.getMonth() + 1);
      }

      if (options?.groupByMonth) {
        // One row per month showing overall occupancy
        data = months.map(({ month, year, label }) => {
          const monthStartDate = new Date(year, month - 1, 1);
          const monthEndDate = new Date(year, month, 0);
          const monthStart = formatDateForDB(monthStartDate);
          const monthEnd = formatDateForDB(monthEndDate);
          let occupied = 0;
          let total = 0;
          allHouses.forEach(h => {
            if (!isCommissionedAsOf(h, monthEndDate)) return;
            total++;

            const hasActiveContract = (h.contracts || []).some(
              (c: any) =>
                isActiveContractStatus(c.status) &&
                c.start_date <= monthEnd &&
                (!c.end_date || c.end_date >= monthStart),
            );
            if (hasActiveContract) occupied++;
          });
          const rate = total > 0 ? ((occupied / total) * 100).toFixed(1) : '0.0';
          return {
            period: label,
            total_units: String(total),
            occupied: String(occupied),
            vacant: String(total - occupied),
            occupancy_rate: `${rate}%`,
          };
        });
        headers = ['period', 'total_units', 'occupied', 'vacant', 'occupancy_rate'];
      } else {
        // One row per property (snapshot of current occupancy)
        const propMap: Record<
          string,
          { name: string; total: number; occupiedCount: number }
        > = {};
        allHouses.forEach(h => {
          const propName = h.property?.name || 'Not assigned';
          const propId = h.property_id || 'unknown';

          if (!isCommissionedAsOf(h, ocEndDate)) return;

          if (!propMap[propId])
            propMap[propId] = { name: propName, total: 0, occupiedCount: 0 };
          propMap[propId].total++;
          const isOccupied = (h.contracts || []).some((c: any) =>
            isActiveContractStatus(c.status),
          );
          if (isOccupied) propMap[propId].occupiedCount++;
        });
        data = Object.values(propMap)
          .map(p => ({
            property: p.name,
            total_units: String(p.total),
            occupied: String(p.occupiedCount),
            vacant: String(p.total - p.occupiedCount),
            occupancy_rate:
              p.total > 0 ? `${((p.occupiedCount / p.total) * 100).toFixed(1)}%` : '0%',
          }))
          .sort((a, b) => a.property.localeCompare(b.property));
        headers = ['property', 'total_units', 'occupied', 'vacant', 'occupancy_rate'];
      }

      filename = `occupancy_rate_report_${formatDateForDB(new Date())}.csv`;
      break;
    }

    case 'expiring_contracts': {
      const daysAhead = options?.daysAhead ?? 30;
      const todayEC = new Date();
      todayEC.setHours(0, 0, 0, 0);
      const cutoffDate = new Date(todayEC);
      cutoffDate.setDate(cutoffDate.getDate() + daysAhead);

      data = (reportData as any[])
        .filter(c => {
          if (!isActiveContractStatus(c.status)) return false;
          if (!c.end_date) return false;
          if (options?.propertyId) {
            const propId = c.house?.property?.id || c.house?.property_id;
            if (propId !== options.propertyId) return false;
          }
          const endDate = new Date(c.end_date);
          endDate.setHours(0, 0, 0, 0);
          return endDate >= todayEC && endDate <= cutoffDate;
        })
        .map(c => {
          const endDate = new Date(c.end_date);
          endDate.setHours(0, 0, 0, 0);
          const daysLeft = Math.ceil(
            (endDate.getTime() - todayEC.getTime()) / (1000 * 60 * 60 * 24),
          );
          return {
            property: c.house?.property?.name || 'Not assigned',
            house_number: c.house?.house_number || 'Unknown',
            tenant_name: c.tenant?.name || 'Unknown',
            tenant_phone: c.tenant?.phone || '-',
            rent_amount: parseFloat(String(c.rent_amount || 0)).toLocaleString(),
            start_date: c.start_date ? formatDate(c.start_date) : '-',
            end_date: formatDate(c.end_date),
            days_remaining: String(daysLeft),
            _raw_days: daysLeft,
          };
        })
        .sort((a, b) => a._raw_days - b._raw_days);

      if (options?.groupByProperty) {
        data = groupDataByProperty(data);
      }

      data = data.map(({ _raw_days, ...rest }) => rest);

      headers = [
        'property',
        'house_number',
        'tenant_name',
        'tenant_phone',
        'rent_amount',
        'start_date',
        'end_date',
        'days_remaining',
      ];
      filename = `expiring_contracts_report_${formatDateForDB(new Date())}.csv`;
      break;
    }

    case 'refunds': {
      data = (reportData as any[])
        .filter(r => {
          if (
            options?.propertyId &&
            r.contract?.house?.property_id !== options.propertyId
          )
            return false;
          if (
            !options?.includeFormerTenants &&
            !isActiveContractStatus(r.contract?.status)
          )
            return false;
          return true;
        })
        .map(r => {
          const amount = parseFloat(String(r.amount || 0));
          const refunded = parseFloat(String(r.refunded_amount || 0));
          const parsedPeriod = parsePeriod(r.payment_period);
          return {
            property: r.contract?.house?.property?.name || 'Unknown',
            house_number: r.contract?.house?.house_number || '-',
            tenant_name: r.contract?.tenant?.name || 'Unknown',
            payment_date: r.payment_date
              ? new Date(r.payment_date).toLocaleDateString()
              : '-',
            period: formatPeriod(parsedPeriod || { month: 0, year: 0 }),
            original_amount: amount.toLocaleString(),
            refunded_amount: refunded.toLocaleString(),
            net_amount: Math.max(0, amount - refunded).toLocaleString(),
            _raw_date: new Date(r.payment_date || 0).getTime(),
            _raw_property: (r.contract?.house?.property?.name || '').toLowerCase(),
          };
        })
        .sort((a, b) => {
          const propCmp = a._raw_property.localeCompare(b._raw_property);
          if (propCmp !== 0) return propCmp;
          return b._raw_date - a._raw_date;
        });

      if (options?.groupByProperty) {
        data = groupDataByProperty(data);
      }

      data = data.map(({ _raw_date, _raw_property, ...rest }) => rest);

      headers = [
        'property',
        'house_number',
        'tenant_name',
        'payment_date',
        'period',
        'original_amount',
        'refunded_amount',
        'net_amount',
      ];
      filename = `refunds_report_${formatDateForDB(new Date())}.csv`;
      break;
    }
  }

  return { data, headers, filename };
};

// --- Extracted Processors ---

function processExpensesAnalysis(reportData: any[], options?: any) {
  const rawDate = options?.date || new Date();
  const selectedMonthDate = rawDate instanceof Date ? rawDate : new Date(rawDate);
  const isAllTime = isReportAllTime(options);
  const isYTD = options?.isYearToDate || false;

  const targetMonth = selectedMonthDate.getMonth() + 1;
  const targetYear = selectedMonthDate.getFullYear();
  const expenses = reportData as any[];
  const endOfSelectedMonth = new Date(
    selectedMonthDate.getFullYear(),
    selectedMonthDate.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );

  const filteredExpenses = expenses.filter(e => {
    const date = new Date(e.date);
    if (isAllTime) return true;
    if (isYTD) return date.getFullYear() === targetYear && date <= endOfSelectedMonth;
    return date.getMonth() + 1 === targetMonth && date.getFullYear() === targetYear;
  });

  const totalSpent = filteredExpenses.reduce(
    (sum, e) => sum + (parseFloat(String(e.amount)) || 0),
    0,
  );

  const categoryBreakdown = EXPENSE_CATEGORY.map(cat => {
    const catExpenses = filteredExpenses.filter(e => e.category === cat.key);
    const amount = catExpenses.reduce(
      (sum, e) => sum + (parseFloat(String(e.amount)) || 0),
      0,
    );
    const percentage = totalSpent > 0 ? (amount / totalSpent) * 100 : 0;
    const catRecords = catExpenses
      .map(e => ({
        date: e.date,
        amount: parseFloat(String(e.amount)) || 0,
        remarks: e.remarks || '',
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { ...cat, amount, percentage, records: catRecords };
  });

  let comparisonExpenses: any[] = [];
  let comparisonLabel = '';

  if (isAllTime) {
    comparisonLabel = 'All History';
  } else if (isYTD) {
    const lastYear = targetYear - 1;
    comparisonExpenses = expenses.filter(e => {
      const date = new Date(e.date);
      const sameDayLastYear = new Date(selectedMonthDate);
      sameDayLastYear.setFullYear(lastYear);
      return date.getFullYear() === lastYear && date <= sameDayLastYear;
    });
    comparisonLabel = `vs same period ${lastYear}`;
  } else {
    const lastMonthDate = new Date(selectedMonthDate);
    lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    comparisonExpenses = expenses.filter(e => {
      const date = new Date(e.date);
      return (
        date.getMonth() + 1 === lastMonthDate.getMonth() + 1 &&
        date.getFullYear() === lastMonthDate.getFullYear()
      );
    });
    comparisonLabel = 'vs last month';
  }

  const lastPeriodTotalSpent = comparisonExpenses.reduce(
    (sum, e) => sum + (parseFloat(String(e.amount)) || 0),
    0,
  );
  const totalVariance =
    !isAllTime && lastPeriodTotalSpent > 0
      ? ((totalSpent - lastPeriodTotalSpent) / lastPeriodTotalSpent) * 100
      : 0;

  const categoryBreakdownWithVariance = categoryBreakdown.map(cat => {
    const comparisonCatExpenses = comparisonExpenses.filter(e => e.category === cat.key);
    const comparisonAmount = comparisonCatExpenses.reduce(
      (sum, e) => sum + (parseFloat(String(e.amount)) || 0),
      0,
    );
    const variance =
      !isAllTime && comparisonAmount > 0
        ? ((cat.amount - comparisonAmount) / comparisonAmount) * 100
        : 0;
    return { ...cat, comparisonAmount, variance };
  });

  const trendData = [];
  const trendCount = isAllTime ? 12 : isYTD ? targetMonth : 5;
  for (let i = trendCount - 1; i >= 0; i--) {
    const d = new Date(selectedMonthDate);
    d.setMonth(d.getMonth() - i);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const monthLabel = `${d.toLocaleString('default', { month: 'short' })}'${y.toString().slice(-2)}`;

    const monthExpenses = expenses.filter(e => {
      const date = new Date(e.date);
      return date.getMonth() + 1 === m && date.getFullYear() === y;
    });

    const monthTotal = monthExpenses.reduce(
      (sum, e) => sum + (parseFloat(String(e.amount)) || 0),
      0,
    );
    const monthUtilities = monthExpenses
      .filter(e => e.category === 'Utilities')
      .reduce((sum, e) => sum + (parseFloat(String(e.amount)) || 0), 0);
    const monthMaintenance = monthExpenses
      .filter(e => e.category === 'Maintenance')
      .reduce((sum, e) => sum + (parseFloat(String(e.amount)) || 0), 0);
    const monthOther = monthExpenses
      .filter(e => e.category === 'Other')
      .reduce((sum, e) => sum + (parseFloat(String(e.amount)) || 0), 0);
    const monthUtilitiesRecords = monthExpenses
      .filter(e => e.category === 'Utilities')
      .map(e => ({
        date: e.date,
        amount: parseFloat(String(e.amount)) || 0,
        remarks: e.remarks || '',
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    trendData.push({
      label: monthLabel,
      total: monthTotal,
      utilities: monthUtilities,
      maintenance: monthMaintenance,
      other: monthOther,
      records: monthUtilitiesRecords,
      isCurrent: i === 0,
    });
  }

  const suffix = isAllTime
    ? 'all_time'
    : isYTD
      ? `ytd_${targetYear}`
      : `${targetYear}_${targetMonth}`;

  return {
    data: [
      {
        selectedMonthDate,
        totalSpent,
        totalVariance,
        comparisonLabel,
        categoryBreakdown: categoryBreakdownWithVariance,
        changePercentage: totalVariance,
        lastMonthTotalSpent: lastPeriodTotalSpent,
        trendData,
        isAllTime,
        isYTD,
      },
    ],
    headers: [],
    filename: `expenses_analysis_${suffix}.pdf`,
  };
}

function processReceipts(reportData: any[], options?: any) {
  const filteredReceipts = (reportData as any[]).filter(r => {
    if (options?.propertyId && r.contract?.house?.property_id !== options.propertyId)
      return false;
    if (options?.includeFormerTenants) return true;
    if (r.status === 'promo' && !options?.includePromo) return false;
    return isActiveContractStatus(r.contract?.status);
  });

  const receiptData = filteredReceipts.map(r => {
    const amount = parseFloat(String(r.amount || 0));
    const refundedAmount = parseFloat(String(r.refunded_amount || 0));
    const status = r.is_refunded
      ? 'refunded'
      : refundedAmount > 0
        ? 'partial_refund'
        : r.status || 'Unknown';
    const parsedPeriod = parsePeriod(r.payment_period);
    return {
      period: formatPeriod(parsedPeriod || { month: 0, year: 0 }),
      month: parsedPeriod?.month || 0,
      year: parsedPeriod?.year || 0,
      property: getPropertyName(r.contract?.house?.property),
      house_number: r.contract?.house?.house_number || 'Unknown',
      tenant: r.contract?.tenant?.name || 'Unknown',
      contract_amount: r.contract?.rent_amount || 0,
      amount: amount,
      refunded_amount: refundedAmount,
      net_amount: Math.max(0, amount - refundedAmount),
      payment_date: r.payment_date ? formatDate(r.payment_date) : '',
      status,
      contract: r.contract,
    };
  });

  const allPeriods = [...new Set(receiptData.map(r => r.period))].sort((a, b) => {
    const periodA = receiptData.find(
      r => formatPeriod({ month: r.month, year: r.year }) === a,
    );
    const periodB = receiptData.find(
      r => formatPeriod({ month: r.month, year: r.year }) === b,
    );
    if (!periodA || !periodB) return 0;
    if (periodA.year !== periodB.year) return periodA.year - periodB.year;
    return periodA.month - periodB.month;
  });

  const periods = options?.monthsBack
    ? allPeriods.slice(-options.monthsBack)
    : allPeriods;

  const groupedByLocation = receiptData.reduce((acc: any, receipt) => {
    const key = `${receipt.property}-${receipt.house_number}`;
    if (!acc[key]) {
      acc[key] = {
        property: receipt.property,
        house_number: receipt.house_number,
        tenant: receipt.tenant,
        contract_amount: receipt.contract_amount,
        contract: receipt.contract,
        periods: {},
      };
    }
    if (!acc[key].contract && receipt.contract) {
      acc[key].contract = receipt.contract;
    }
    if (!acc[key].periods[receipt.period]) {
      acc[key].periods[receipt.period] = { total_amount: 0, payments: [], statuses: [] };
    }
    acc[key].periods[receipt.period].total_amount += receipt.net_amount;
    acc[key].periods[receipt.period].payments.push(receipt.payment_date);
    acc[key].periods[receipt.period].statuses.push(receipt.status);
    return acc;
  }, {});

  const data = Object.values(groupedByLocation).map((location: any) => {
    const row: any = {
      property: location.property,
      house_number: location.house_number,
      tenant: location.tenant,
      contract_amount: (location.contract_amount || 0).toLocaleString(),
    };
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const twoMonthsAhead = new Date(currentYear, currentMonth + 1, 1);
    const MONTH_NAMES = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    periods.forEach(period => {
      const periodData = location.periods[period];
      const matchPeriod = receiptData.find(r => r.period === period);
      const [mName, yStr] = String(period).trim().split(/\s+/);
      const mIdx = MONTH_NAMES.indexOf(mName);
      const pMonth = mIdx !== -1 ? mIdx + 1 : Number(matchPeriod?.month);
      const pYear = parseInt(yStr, 10) || Number(matchPeriod?.year);

      const contract = location.contract;
      const contractBreaks = [
        ...(parseMetadata(contract?.metadata)?.breaks || []),
        ...((contract as any)?.breaks || []),
      ];

      const hasFullBreak =
        contract &&
        pMonth > 0 &&
        pYear > 0 &&
        calculateEffectiveRent(location.contract_amount, pMonth, pYear, contractBreaks)
          .isOnFullBreak;

      const isWaived = periodData?.statuses?.includes('waived') || Boolean(hasFullBreak);

      const hasIndefiniteBreak = contractBreaks.some((b: any) => {
        if (!b) return false;
        if (!b.end_date || b.is_indefinite) return true;
        const endStr = String(b.end_date);
        if (endStr.includes('2099')) return true;
        const end = parseLocalDate(endStr);
        return !Number.isNaN(end.getTime()) && end > twoMonthsAhead;
      });

      const isCurrentOrFuture =
        pYear > currentYear || (pYear === currentYear && pMonth >= currentMonth);

      if (isWaived && hasIndefiniteBreak && isCurrentOrFuture) {
        row[period] = 'Holiday';
        row[`${period}_status`] = ['holiday'];
      } else if (isWaived) {
        row[period] = 'Waived';
        row[`${period}_status`] = ['waived'];
      } else if (periodData) {
        const isFullyRefunded =
          periodData.statuses?.includes('refunded') &&
          !periodData.statuses?.some((s: string) => s === 'paid' || s === 'partial');
        row[period] = isFullyRefunded
          ? 'Refunded'
          : periodData.total_amount.toLocaleString();
        row[`${period}_status`] = periodData.statuses || [];
      } else {
        row[period] = '-';
        row[`${period}_status`] = [];
      }
    });
    return row;
  });

  data.sort((a, b) => {
    const propertyCompare = String(a.property).localeCompare(String(b.property));
    if (propertyCompare !== 0) return propertyCompare;
    return String(a.house_number).localeCompare(String(b.house_number), undefined, {
      numeric: true,
    });
  });

  return {
    data,
    headers: ['property', 'house_number', 'tenant', 'contract_amount', ...periods],
    filename: `receipts_report_${options?.propertyId ? 'filtered_' : ''}${Date.now()}.csv`,
  };
}
