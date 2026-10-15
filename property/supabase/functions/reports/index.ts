// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { jsPDF } from 'npm:jspdf@2.5.1';
import {
  errorResponse,
  getClientContext,
  getInternalHeaders,
  getServiceRoleClient,
  handleCors,
  successResponse,
} from '../_shared/index.ts';

// Helper utilities aligned with src/utils/
const properCase = (str: string) => {
  if (!str) return '';
  return str.replace(
    /\w\S*/g,
    txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase(),
  );
};

const isActiveContractStatus = (status?: string | null): boolean => {
  const s = status?.toLowerCase();
  return s === 'active' || s === 'expiring_soon' || s === 'renewed';
};

const isActiveTenantStatus = (status?: string | null): boolean => {
  const s = status?.toLowerCase();
  return s === 'active' || s === 'expiring_soon';
};

const getPropertyName = (property: any): string => {
  if (!property) return 'Not assigned';
  if (Array.isArray(property)) {
    return property.length > 0 ? property[0].name || 'Unknown' : 'Not assigned';
  }
  return property.name || 'Not assigned';
};

const formatPeriod = (period: any) => {
  if (!period) return 'No period set';
  let p = period;
  if (typeof period === 'string') {
    try {
      p = JSON.parse(period);
    } catch {
      return 'No period set';
    }
  }
  if (!p?.month || !p.year) return 'No period set';

  const months = [
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

  return `${months[p.month - 1]} ${p.year}`;
};

function groupDataByProperty(data: Record<string, unknown>[]): Record<string, unknown>[] {
  const grouped: Record<string, unknown>[] = [];
  let currentProperty = '';

  data.forEach(item => {
    const property = (item.property as string) || 'Not assigned';
    if (property !== currentProperty) {
      currentProperty = property;
      grouped.push({
        isGroupHeader: true,
        property: currentProperty,
        groupedBy: 'property',
      });
    }
    grouped.push(item);
  });

  return grouped;
}

function calculateNextSchedule(schedule: any) {
  const now = new Date();
  const nextDate = new Date(now);

  switch (schedule.frequency) {
    case 'daily':
      nextDate.setDate(now.getDate() + 1);
      break;
    case 'weekly': {
      const daysUntilNext = (schedule.day - now.getDay() + 7) % 7;
      nextDate.setDate(now.getDate() + daysUntilNext);
      break;
    }
    case 'monthly':
      nextDate.setDate(schedule.day);
      if (nextDate <= now) {
        nextDate.setMonth(nextDate.getMonth() + 1);
      }
      break;
  }

  const timeStr = schedule.time;
  const timeMatch = timeStr ? String(timeStr).match(/^(\d{2}):(\d{2}):(\d{2})/) : null;
  if (timeMatch) {
    const [, hours, minutes] = timeMatch;
    nextDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
  } else {
    nextDate.setHours(2, 0, 0, 0);
  }

  return nextDate.toISOString();
}

function generateCSV(headers: any[], rows: any[]) {
  const csvHeaders = headers.map(h => (typeof h === 'string' ? h : h.text || h.key));
  const csvRows = rows
    .filter(row => !row.isGroupHeader)
    .map(row =>
      headers
        .map(header => {
          const key =
            typeof header === 'string'
              ? header
              : header.key || header.text.toLowerCase().replace(/\s+/g, '_');
          const value = row[key] !== undefined && row[key] !== null ? row[key] : '';
          const stringValue = String(value);
          if (
            stringValue.includes(',') ||
            stringValue.includes('"') ||
            stringValue.includes('\n')
          ) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        })
        .join(','),
    );

  return [csvHeaders.join(','), ...csvRows].join('\n');
}

function getExportQuery(exportType: string) {
  const queries: Record<string, any> = {
    properties: {
      table: 'properties',
      select: '*, houses(*)',
      filename: 'properties',
    },
    houses: {
      table: 'houses',
      select: '*, property:properties(name), contracts(*, tenant:tenants(name))',
      filename: 'houses',
    },
    tenants: {
      table: 'tenants',
      select: '*, contracts(*, house:houses(house_number, property:properties(name)))',
      filename: 'tenants',
    },
    contracts: {
      table: 'contracts',
      select:
        '*, tenant:tenants(name), house:houses(house_number, property:properties(name))',
      filename: 'contracts',
    },
    receipts: {
      table: 'receipts',
      select:
        '*, contract:contracts(rent_amount, status, house:houses(house_number, property:properties(name)), tenant:tenants(name))',
      filename: 'receipts',
    },
    expenses: {
      table: 'expenses',
      select: '*',
      filename: 'expenses',
    },
    vacant_rooms: {
      table: 'houses',
      select: '*, property:properties(name), contracts(*, tenant:tenants(name))',
      filename: 'vacant_rooms',
    },
  };

  return queries[exportType] || null;
}

// Process data aligned with src/utils/reports/dataProcessors.ts
function processReportData(type: string, reportData: any[], options?: any) {
  let data: any[] = [];
  let headers: string[] = [];
  let filename = `${type}_report.csv`;

  // Handle null or empty data
  if (!reportData || reportData.length === 0) {
    return {
      data: [{ message: 'No data found for this report' }],
      headers: ['message'],
      filename: `${type}_report.csv`,
    };
  }

  switch (type) {
    case 'properties':
      data = reportData.map(p => ({
        name: p.name || '',
        total_houses: p.houses ? p.houses.length.toLocaleString() : '0',
        occupied_houses: p.houses
          ? p.houses.filter((h: any) => h.status === 'occupied').length.toLocaleString()
          : '0',
        available_houses: p.houses
          ? p.houses.filter((h: any) => h.status === 'available').length.toLocaleString()
          : '0',
      }));
      headers = ['name', 'total_houses', 'occupied_houses', 'available_houses'];
      filename = 'properties_report.csv';
      break;

    case 'houses':
      data = reportData
        .map(h => {
          const activeContract = h.contracts?.find((c: any) =>
            isActiveContractStatus(c.status),
          );
          return {
            property: getPropertyName(h.property),
            house_number: h.house_number || '',
            type: h.type || '',
            status: h.status || '',
            monthly_rent: h.monthly_rent ? Number(h.monthly_rent).toLocaleString() : '0',
            current_tenant: activeContract?.tenant?.name || '-',
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
      ];
      filename = 'houses_report.csv';
      break;

    case 'vacant_rooms': {
      const vacantHouses = reportData.filter(h => {
        const activeContract = h.contracts?.find((c: any) =>
          isActiveContractStatus(c.status),
        );
        return !activeContract;
      });

      data = vacantHouses
        .map(h => {
          const lastDate =
            h.contracts && h.contracts.length > 0
              ? new Date(
                  Math.max(
                    ...h.contracts.map((c: any) =>
                      new Date(c.end_date || c.updated_at || c.created_at).getTime(),
                    ),
                  ),
                ).toLocaleDateString()
              : 'Never occupied';

          return {
            property: getPropertyName(h.property),
            house_number: h.house_number || '',
            type: h.type || '',
            status: h.status || '',
            monthly_rent: h.monthly_rent ? Number(h.monthly_rent).toLocaleString() : '0',
            vacant_since: lastDate,
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

      headers = [
        'property',
        'house_number',
        'type',
        'status',
        'monthly_rent',
        'vacant_since',
      ];
      filename = 'vacant_rooms_report.csv';
      break;
    }

    case 'tenants': {
      const activeTenants = reportData.filter(t => isActiveTenantStatus(t.status));

      if (activeTenants.length === 0) {
        return {
          data: [{ message: 'No active tenants found for this report' }],
          headers: ['message'],
          filename: 'tenants_report.csv',
        };
      }

      data = activeTenants
        .map(t => {
          const activeContract = t.contracts?.find((c: any) =>
            isActiveContractStatus(c.status),
          );
          return {
            name: t.name || '',
            phone: t.phone || '',
            property: activeContract?.house?.property?.name || 'Not assigned',
            house_number: activeContract?.house?.house_number || 'Not assigned',
            status: t.status || '',
          };
        })
        .sort((a, b) => {
          if (a.property !== b.property) {
            return a.property.localeCompare(b.property);
          }
          return String(a.house_number).localeCompare(String(b.house_number), undefined, {
            numeric: true,
          });
        });
      headers = ['name', 'phone', 'property', 'house_number', 'status'];
      filename = 'tenants_report.csv';
      break;
    }

    case 'contracts': {
      const activeContracts = reportData.filter(c => isActiveContractStatus(c.status));

      if (activeContracts.length === 0) {
        return {
          data: [{ message: 'No active contracts found for this report' }],
          headers: ['message'],
          filename: 'contracts_report.csv',
        };
      }

      data = activeContracts
        .map(c => ({
          tenant_name: c.tenant?.name || 'Not assigned',
          property: getPropertyName(c.house?.property),
          house_number: c.house?.house_number || 'Not assigned',
          start_date: c.start_date || 'Not assigned',
          end_date: c.end_date || 'Not assigned',
          rent_amount: c.rent_amount
            ? Number(c.rent_amount).toLocaleString()
            : 'Not assigned',
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
      headers = [
        'tenant_name',
        'property',
        'house_number',
        'start_date',
        'end_date',
        'rent_amount',
        'status',
      ];
      filename = 'contracts_report.csv';
      break;
    }

    case 'receipts': {
      const filteredReceipts = reportData.filter(r => {
        const contractStatus = r.contract?.status;
        return (
          contractStatus &&
          contractStatus !== 'expired' &&
          contractStatus !== 'terminated'
        );
      });

      const receiptData = filteredReceipts.map(r => ({
        period: formatPeriod(r.payment_period),
        month: r.payment_period?.month || 0,
        year: r.payment_period?.year || 0,
        property: getPropertyName(r.contract?.house?.property),
        house_number: r.contract?.house?.house_number || 'Unknown',
        tenant: r.contract?.tenant?.name || 'Unknown',
        contract_amount: r.contract?.rent_amount || 0,
        amount: r.amount || 0,
        payment_date: new Date(r.payment_date).toLocaleDateString(),
        status: r.status || 'Unknown',
      }));

      const allPeriods: string[] = [
        ...new Set(receiptData.map((r: any) => r.period)),
      ] as string[];
      allPeriods.sort((a: string, b: string) => {
        const periodA = receiptData.find((r: any) => r.period === a);
        const periodB = receiptData.find((r: any) => r.period === b);
        if (!periodA || !periodB) return 0;

        if (periodA.year !== periodB.year) {
          return periodA.year - periodB.year;
        }
        return periodA.month - periodB.month;
      });

      const periods = allPeriods.slice(-3);

      const groupedByLocation = receiptData.reduce((acc: any, receipt: any) => {
        const key = `${receipt.property}-${receipt.house_number}`;
        if (!acc[key]) {
          acc[key] = {
            property: receipt.property,
            house_number: receipt.house_number,
            tenant: receipt.tenant,
            contract_amount: receipt.contract_amount,
            periods: {},
          };
        }

        if (!acc[key].periods[receipt.period]) {
          acc[key].periods[receipt.period] = {
            total_amount: 0,
            payments: [],
            statuses: [],
          };
        }

        acc[key].periods[receipt.period].total_amount += receipt.amount;
        acc[key].periods[receipt.period].payments.push(receipt.payment_date);
        acc[key].periods[receipt.period].statuses.push(receipt.status);

        return acc;
      }, {});

      data = Object.values(groupedByLocation).map((location: any) => {
        const row: any = {
          property: location.property,
          house_number: location.house_number,
          tenant: location.tenant,
          contract_amount: location.contract_amount
            ? Number(location.contract_amount).toLocaleString()
            : '0',
        };

        periods.forEach((period: string) => {
          const periodData = location.periods[period];
          if (periodData) {
            row[period] = Number(periodData.total_amount || 0).toLocaleString();
            row[`${period}_status`] = periodData.statuses || [];
          } else {
            row[period] = '-';
            row[`${period}_status`] = [];
          }
        });

        return row;
      });

      data.sort((a, b) => {
        const propertyCompare = a.property.localeCompare(b.property);
        if (propertyCompare !== 0) return propertyCompare;
        return String(a.house_number).localeCompare(String(b.house_number), undefined, {
          numeric: true,
        });
      });

      headers = ['property', 'house_number', 'tenant', 'contract_amount', ...periods];
      filename = 'receipts_report.csv';
      break;
    }

    case 'expenses': {
      const sortedExpenses = [...reportData].sort(
        (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );

      data = sortedExpenses.map(expense => ({
        category: expense.category || '',
        amount: expense.amount ? Number(expense.amount).toLocaleString() : '0',
        date: new Date(expense.date).toLocaleDateString(),
      }));

      const categoryTotals = reportData.reduce((acc: any, expense: any) => {
        const category = expense.category || 'Other';
        if (!acc[category]) {
          acc[category] = 0;
        }
        acc[category] += parseFloat(expense.amount || 0);
        return acc;
      }, {});

      const totalAmount = Object.values(categoryTotals).reduce(
        (sum: number, amount: any) => sum + (amount || 0),
        0,
      );
      data.push({
        category: 'TOTAL',
        amount: Number(totalAmount).toLocaleString(),
        date: '',
      });

      headers = ['category', 'amount', 'date'];
      filename = 'expenses_report.csv';
      break;
    }

    case 'pending_rent':
      data = reportData
        .map(item => ({
          property: item.property_name || 'Unknown',
          house_number: item.house_number || 'Unknown',
          tenant: item.tenant_name || 'Unknown',
          phone: item.tenant_phone || 'N/A',
          contract_amount: item.contract_amount
            ? Number(item.contract_amount).toLocaleString()
            : '0',
          amount_paid: item.amount_paid ? Number(item.amount_paid).toLocaleString() : '0',
          amount_pending: item.amount_pending
            ? Number(item.amount_pending).toLocaleString()
            : '0',
          payment_status: item.payment_status || 'unpaid',
          current_month: item.current_month,
          current_year: item.current_year,
        }))
        .sort((a, b) => {
          const propertyCompare = a.property.localeCompare(b.property);
          if (propertyCompare !== 0) return propertyCompare;
          return String(a.house_number).localeCompare(String(b.house_number), undefined, {
            numeric: true,
          });
        });

      headers = [
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

    default:
      data = reportData.map((item, index) => ({ no: index + 1, ...item }));
      headers = ['no', ...Object.keys(reportData[0] || {})];
      filename = `${type}_report.csv`;
  }

  return { data, headers, filename };
}

serve(async req => {
  console.log('Report export started:', new Date().toISOString());

  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    if (req.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    const ctx = await getClientContext(req);
    if (ctx.error) return errorResponse(ctx.error, 401);

    let supabase = ctx.supabase;
    if (ctx.isInternal) {
      supabase = getServiceRoleClient();
    }

    const { scheduleId = null } = await req.json();

    if (scheduleId) {
      const { data: scheduleData, error: scheduleError } = await supabase
        .from('schedules')
        .select('*')
        .eq('id', scheduleId)
        .single();

      if (scheduleError) {
        console.error('Error fetching schedule:', scheduleError.message);
        throw new Error(`Failed to fetch schedule: ${scheduleError.message}`);
      }

      if (!scheduleData) {
        return errorResponse(
          {
            message: 'Schedule not found',
            scheduleId: scheduleId,
          },
          404,
        );
      }

      const result = await processScheduleExport(supabase, scheduleData);

      return successResponse(result);
    }

    const now = new Date();

    const { data: schedules, error: schedulesError } = await supabase
      .from('schedules')
      .select('*')
      .neq('schedule_type', 'system_backup')
      .eq('status', 'active')
      .lte('next_run', now.toISOString());

    if (schedulesError) {
      console.error('Error fetching schedules:', schedulesError.message);
      throw new Error(`Failed to fetch schedules: ${schedulesError.message}`);
    }

    if (!schedules || schedules.length === 0) {
      return successResponse({
        message: 'No active schedules due for processing',
        checked_at: now.toISOString(),
      });
    }

    console.log(`Processing ${schedules.length} schedules`);

    const schedulePromises = schedules.map(async schedule => {
      try {
        const result = await processScheduleExport(supabase, schedule);
        return {
          schedule_id: schedule.id,
          schedule_type: schedule.schedule_type,
          status: 'success',
          result: result,
        };
      } catch (error) {
        console.error(`Error processing schedule ${schedule.id}:`, error.message);
        return {
          schedule_id: schedule.id,
          schedule_type: schedule.schedule_type,
          status: 'error',
          error: error.message,
        };
      }
    });

    const results = await Promise.all(schedulePromises);

    return successResponse({
      message: `Processed ${results.length} schedules`,
      results: results,
      processed_at: now.toISOString(),
    });
  } catch (error) {
    console.error('Report export failed:', error.message);
    return errorResponse(
      {
        error: error.message,
        stack: error.stack,
      },
      500,
    );
  }
});

async function processScheduleExport(supabase: any, schedule: any) {
  let exportConfig: any = null;
  let targetEmail: any = null;
  let targetFormat = schedule.format || 'pdf';
  let targetBusinessId = schedule.business_id;
  const targetFilters: any = {};

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('id, name, address, phone, email')
    .eq('id', schedule.business_id)
    .single();

  if (businessError) {
    console.error('Error fetching business:', businessError.message);
    throw new Error(`Failed to fetch business: ${businessError.message}`);
  }

  exportConfig = getExportQuery(schedule.schedule_type);
  targetFormat = schedule.format || 'pdf';
  targetBusinessId = schedule.business_id;

  if (schedule.emails) {
    let emailRecipients: string[] = [];
    if (Array.isArray(schedule.emails)) {
      emailRecipients = schedule.emails;
    } else if (typeof schedule.emails === 'string') {
      try {
        const parsedEmails = JSON.parse(schedule.emails);
        emailRecipients = Array.isArray(parsedEmails) ? parsedEmails : [parsedEmails];
      } catch {
        emailRecipients = [schedule.emails];
      }
    }

    if (emailRecipients.length > 0) {
      targetEmail = {
        to: emailRecipients,
        subject: `${properCase(
          schedule.schedule_type.replace(/_/g, ' '),
        )} Report - ${new Date().toLocaleDateString()}`,
        html: [
          `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
          `  <p>Dear ${business.name},</p>`,
          `  <p>Please find attached your ${properCase(schedule.schedule_type.replace(/_/g, ' '))} Report.</p>`,
          `  <p>This report was generated automatically at ${new Date().toLocaleTimeString()}.</p>`,
          `  <p>Best regards,<br><strong>${business.name}</strong></p>`,
          `</div>`,
        ].join(''),
      };
    }
  }

  const supportedFormats = ['pdf', 'csv'];
  if (!supportedFormats.includes(targetFormat.toLowerCase())) {
    throw new Error(
      `Unsupported format: ${targetFormat}. Supported formats: ${supportedFormats.join(
        ', ',
      )}`,
    );
  }

  if (!exportConfig && schedule.schedule_type !== 'pending_rent') {
    throw new Error(`Unsupported export type: ${schedule.schedule_type}`);
  }

  let data;
  let error;

  if (schedule.schedule_type === 'pending_rent') {
    const targetDate = new Date().toISOString();
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'get_pending_rent_for_date',
      {
        target_date: targetDate,
        target_business_id: targetBusinessId,
      },
    );
    data = rpcData;
    error = rpcError;
  } else {
    let query = supabase
      .from(exportConfig.table)
      .select(exportConfig.select)
      .eq('business_id', targetBusinessId);

    if (targetFilters.dateFrom) {
      query = query.gte('created_at', targetFilters.dateFrom);
    }

    const result = await query;
    data = result.data;
    error = result.error;
  }

  if (error) {
    throw new Error(`Failed to fetch report data: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error(`No data found for ${schedule.schedule_type} export`);
  }

  const {
    data: processedRows,
    headers: processedHeaders,
    filename: reportFilename,
  } = processReportData(schedule.schedule_type, data);

  const processedData = {
    rows: processedRows.map((row, index) => ({
      no: (index + 1).toString(),
      ...row,
    })),
    headers: [
      { text: '#', key: 'no', align: 'center', width: 0.5 },
      ...processedHeaders
        .filter(h => h !== 'no')
        .map(key => ({
          text: key
            .split('_')
            .map(word => properCase(word))
            .join(' '),
          key: key,
          align: key.includes('amount') || key.includes('rent') ? 'center' : 'left',
          width:
            key === 'description'
              ? 3
              : key === 'property' || key === 'tenant' || key === 'name'
                ? 2
                : 1,
        })),
    ],
  };

  let content;
  let contentType;
  let filename;

  switch (targetFormat.toLowerCase()) {
    case 'pdf': {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let yPosition = 15;

      // Business Header (#2c3e50, bold, centered)
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(44, 62, 80);
      const businessName = business?.name || 'Business Report';
      const businessNameWidth = doc.getTextWidth(businessName);
      doc.text(businessName, (pageWidth - businessNameWidth) / 2, yPosition);
      yPosition += 7;

      // Contact details
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(102, 102, 102);

      const businessAddress = business?.address || '';
      const businessPhone = business?.phone || '';
      const businessEmail = business?.email || '';

      if (businessAddress) {
        const addressWidth = doc.getTextWidth(businessAddress);
        doc.text(businessAddress, (pageWidth - addressWidth) / 2, yPosition);
        yPosition += 5;
      }

      const contactInfo: string[] = [];
      if (businessPhone) contactInfo.push(`Phone: ${businessPhone}`);
      if (businessEmail) contactInfo.push(`Email: ${businessEmail}`);

      if (contactInfo.length > 0) {
        const contactText = contactInfo.join(' | ');
        const contactWidth = doc.getTextWidth(contactText);
        doc.text(contactText, (pageWidth - contactWidth) / 2, yPosition);
        yPosition += 7;
      } else {
        yPosition += 3;
      }

      // Divider line (#eeeeee)
      doc.setDrawColor(238, 238, 238);
      doc.line(10, yPosition, pageWidth - 10, yPosition);
      yPosition += 7;

      // Report Title (#2c3e50, bold, centered)
      doc.setFontSize(15);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(44, 62, 80);
      const title = `${properCase(schedule.schedule_type.replace(/_/g, ' '))} Report`;
      const titleWidth = doc.getTextWidth(title);
      doc.text(title, (pageWidth - titleWidth) / 2, yPosition);
      yPosition += 8;

      doc.setTextColor(0, 0, 0);

      // Draw table helper
      drawTableHelper(doc, processedData.rows, schedule.schedule_type, business, {
        startY: yPosition,
        pageWidth: pageWidth,
        pageHeight: pageHeight,
        businessName: businessName,
        businessAddress: businessAddress,
        businessPhone: businessPhone,
        businessEmail: businessEmail,
        title: title,
      });

      // Add page footers
      const pageCount = doc.internal.getNumberOfPages();
      const exportDateTime = new Date().toLocaleString();

      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(102, 102, 102);

        // Left side
        doc.text(`Generated on ${exportDateTime}`, 10, pageHeight - 8);

        // Center
        const signedText = `This is a digitally signed document generated by ${businessName}.`;
        const signedWidth = doc.getTextWidth(signedText);
        doc.text(signedText, (pageWidth - signedWidth) / 2, pageHeight - 8);

        // Right side
        const pageText = `Page ${i} of ${pageCount}`;
        const pageTextWidth = doc.getTextWidth(pageText);
        doc.text(pageText, pageWidth - pageTextWidth - 10, pageHeight - 8);
      }

      content = doc.output('datauristring').split(',')[1];
      contentType = 'application/pdf';
      filename = reportFilename.replace('.csv', '.pdf');
      break;
    }

    case 'csv':
      content = generateCSV(processedData.headers, processedData.rows);
      contentType = 'text/csv';
      filename = reportFilename;
      break;
  }

  if (targetEmail?.to) {
    const emailData = {
      channel: 'email',
      to: targetEmail.to,
      subject: targetEmail.subject,
      html: targetEmail.html,
      attachments: [
        {
          filename: filename,
          content: content,
          contentType: contentType,
          encoding: 'base64',
        },
      ],
    };

    const internalHeaders = getInternalHeaders();

    const { error: emailError } = await supabase.functions.invoke('send-message', {
      body: emailData,
      headers: internalHeaders,
    });

    if (emailError) {
      console.error('Error sending email:', emailError.message);
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    console.log(`Email sent to ${targetEmail.to}`);
  }

  const now = new Date();
  let nextScheduled;

  if (schedule.schedule?.frequency) {
    let cleanTime = '02:00:00';
    if (schedule.schedule.time) {
      const timeMatch = String(schedule.schedule.time).match(/^(\d{2}):(\d{2}):(\d{2})/);
      if (timeMatch) {
        cleanTime = timeMatch[0];
      }
    }

    const scheduleData = {
      frequency: schedule.schedule.frequency,
      time: cleanTime,
    };

    const { data: nextScheduledResult, error: nextScheduledError } = await supabase.rpc(
      'calculate_next_run_time',
      {
        p_schedule: scheduleData,
        p_last_run: new Date().toISOString(),
      },
    );

    if (nextScheduledError) {
      console.error('Error calculating next scheduled time:', nextScheduledError.message);
      try {
        nextScheduled = calculateNextSchedule(schedule.schedule);
      } catch {
        const fallbackDate = new Date();
        fallbackDate.setDate(fallbackDate.getDate() + 1);
        fallbackDate.setHours(2, 0, 0, 0);
        nextScheduled = fallbackDate.toISOString();
      }
    } else {
      nextScheduled = nextScheduledResult;
    }
  } else {
    nextScheduled = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }

  try {
    const { error: updateError } = await supabase
      .from('schedules')
      .update({
        next_run: nextScheduled,
        last_run: now.toISOString(),
        status: 'active',
      })
      .eq('id', schedule.id);

    if (updateError) {
      console.error('Error saving report schedule:', updateError.message);
    }
  } catch (updateException: any) {
    console.error('Error saving report schedule:', updateException.message);
  }

  return {
    success: true,
    message: 'Export processed successfully',
    filename: filename,
    records: processedData.rows.length,
    format: targetFormat,
    next_run: nextScheduled,
  };
}

// Function to draw table aligned with src/utils/reports/pdfGenerators.ts
function drawTableHelper(
  doc: any,
  rows: any[],
  type: string,
  _business: any,
  options: any,
) {
  const {
    startY,
    pageWidth,
    pageHeight,
    businessName,
    businessAddress,
    businessPhone,
    businessEmail,
    title,
  } = options;

  let currentY = startY;

  // Handle empty or error messages
  if (!rows || rows.length === 0 || rows[0]?.message) {
    const emptyMsg = rows[0]?.message || 'No data found for this report';
    doc.setFillColor(248, 250, 252); // #f8fafc
    doc.setDrawColor(203, 213, 225); // #cbd5e1
    doc.rect(10, currentY + 5, pageWidth - 20, 25, 'FD');

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(51, 65, 85); // #334155
    const msgTitle = 'No Data Available';
    doc.text(msgTitle, (pageWidth - doc.getTextWidth(msgTitle)) / 2, currentY + 15);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139); // #64748b
    doc.text(emptyMsg, (pageWidth - doc.getTextWidth(emptyMsg)) / 2, currentY + 22);

    return currentY + 35;
  }

  // Column keys filtering
  const columnKeys = Object.keys(rows.find(r => !r.isGroupHeader) || {}).filter(
    key =>
      !key.endsWith('_status') &&
      key !== 'current_month' &&
      key !== 'current_year' &&
      key !== 'no' &&
      key !== 'isGroupHeader' &&
      key !== 'groupedBy',
  );

  const numberColumnWidth = 10;
  const remainingTableWidth = pageWidth - 20 - numberColumnWidth;

  // Weight calculation for column widths
  const getWeight = (key: string) => {
    const k = key.toLowerCase();
    if (k.includes('description') || k.includes('remarks')) return 3.0;
    if (k.includes('property') || k.includes('tenant') || k.includes('name')) return 2.2;
    if (k.includes('phone') || k.includes('email') || k.includes('date')) return 1.5;
    if (k.includes('amount') || k.includes('rent')) return 1.4;
    if (k.includes('status') || k.includes('type') || k.includes('house')) return 1.2;
    return 1.0;
  };

  const totalWeight = columnKeys.reduce((sum, key) => sum + getWeight(key), 0);
  const columnWidths = columnKeys.map(
    key => (getWeight(key) / totalWeight) * remainingTableWidth,
  );

  // Draw header block
  const drawTableHeader = (yPos: number) => {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(209, 231, 221); // #d1e7dd (Sage green)
    doc.setTextColor(44, 62, 80); // #2c3e50

    doc.rect(10, yPos, pageWidth - 20, 8, 'F');
    doc.setDrawColor(221, 221, 221);

    let curX = 10;

    // Number column
    doc.rect(curX, yPos, numberColumnWidth, 8);
    doc.text('#', curX + 3.5, yPos + 5.5);
    curX += numberColumnWidth;

    // Data columns
    columnKeys.forEach((key, index) => {
      const colW = columnWidths[index];
      const headerText = key
        .split('_')
        .map(word => properCase(word))
        .join(' ');

      doc.rect(curX, yPos, colW, 8);

      const isRightAligned = key.includes('amount') || key.includes('rent');
      if (isRightAligned) {
        const textW = doc.getTextWidth(headerText);
        doc.text(headerText, curX + colW - textW - 2, yPos + 5.5);
      } else {
        doc.text(headerText, curX + 2, yPos + 5.5);
      }

      curX += colW;
    });

    return yPos + 8;
  };

  currentY = drawTableHeader(currentY);

  let groupCounter = 1;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 51, 51);

  rows.forEach((row, rowIndex) => {
    // Check page overflow
    if (currentY + 7 > pageHeight - 20) {
      doc.addPage();

      let newPageY = 15;
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(44, 62, 80);
      const bWidth = doc.getTextWidth(businessName);
      doc.text(businessName, (pageWidth - bWidth) / 2, newPageY);
      newPageY += 6;

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(102, 102, 102);

      if (businessAddress) {
        const addrW = doc.getTextWidth(businessAddress);
        doc.text(businessAddress, (pageWidth - addrW) / 2, newPageY);
        newPageY += 5;
      }

      if (businessPhone || businessEmail) {
        const contactParts: string[] = [];
        if (businessPhone) contactParts.push(`Phone: ${businessPhone}`);
        if (businessEmail) contactParts.push(`Email: ${businessEmail}`);
        const cText = contactParts.join(' | ');
        const cWidth = doc.getTextWidth(cText);
        doc.text(cText, (pageWidth - cWidth) / 2, newPageY);
        newPageY += 6;
      }

      doc.setDrawColor(238, 238, 238);
      doc.line(10, newPageY, pageWidth - 10, newPageY);
      newPageY += 6;

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(44, 62, 80);
      const tWidth = doc.getTextWidth(title);
      doc.text(title, (pageWidth - tWidth) / 2, newPageY);
      newPageY += 7;

      doc.setTextColor(0, 0, 0);
      currentY = drawTableHeader(newPageY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(51, 51, 51);
    }

    // Render Group Header if present
    if (row.isGroupHeader) {
      groupCounter = 1;
      doc.setFillColor(209, 231, 221); // #d1e7dd
      doc.rect(10, currentY, pageWidth - 20, 7, 'F');
      doc.setDrawColor(221, 221, 221);
      doc.rect(10, currentY, pageWidth - 20, 7);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(44, 62, 80);
      doc.text(String(row.property || ''), 14, currentY + 5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(51, 51, 51);
      currentY += 7;
      return;
    }

    // Row alternating background (#f9f9f9)
    if (rowIndex % 2 === 1) {
      doc.setFillColor(249, 249, 249);
      doc.rect(10, currentY, pageWidth - 20, 6, 'F');
    }

    // Highlight insufficient payment cells
    const insufficientCells = new Set<number>();
    if (type === 'receipts' && row.contract_amount) {
      const contractAmount = parseFloat(String(row.contract_amount).replace(/,/g, ''));
      columnKeys.forEach((key, colIndex) => {
        if (
          !['property', 'house_number', 'tenant', 'contract_amount'].includes(key) &&
          !key.endsWith('_status')
        ) {
          const paidAmount = row[key];
          const periodStatuses = row[`${key}_status`] || [];
          if (paidAmount && paidAmount !== '-') {
            const paid = parseFloat(String(paidAmount).replace(/,/g, ''));
            if (paid < contractAmount && !periodStatuses.includes('paid')) {
              insufficientCells.add(colIndex);
            }
          }
        }
      });
    } else if (type === 'pending_rent' && row.payment_status === 'partial') {
      const pendingColIndex = columnKeys.indexOf('amount_pending');
      if (pendingColIndex !== -1) {
        insufficientCells.add(pendingColIndex);
      }
    }

    let curX = 10;
    doc.setDrawColor(221, 221, 221);

    // Number Column
    doc.rect(curX, currentY, numberColumnWidth, 6);
    doc.text(row.no || String(groupCounter++), curX + 3.5, currentY + 4.5);
    curX += numberColumnWidth;

    // Data Columns
    columnKeys.forEach((key, colIndex) => {
      const colW = columnWidths[colIndex];
      const cellValue =
        row[key] !== undefined && row[key] !== null ? String(row[key]) : '';

      if (insufficientCells.has(colIndex)) {
        doc.setFillColor(255, 235, 204); // #ffebcc (Light orange)
        doc.rect(curX, currentY, colW, 6, 'F');
      }

      doc.rect(curX, currentY, colW, 6);

      const isRightAligned = key.includes('amount') || key.includes('rent');
      if (isRightAligned) {
        const textW = doc.getTextWidth(cellValue);
        doc.text(cellValue, curX + colW - textW - 2, currentY + 4.5);
      } else {
        const maxChar = Math.floor(colW / 2);
        const displayValue =
          cellValue.length > maxChar && colW < 30
            ? `${cellValue.substring(0, maxChar - 2)}..`
            : cellValue;
        doc.text(displayValue, curX + 2, currentY + 4.5);
      }

      curX += colW;
    });

    currentY += 6;
  });

  return currentY;
}
