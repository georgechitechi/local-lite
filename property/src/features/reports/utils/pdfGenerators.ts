import type { Business } from '@/shared/types/types';
import { formatPeriod, formatWithCurrency, MONTHS } from '@/shared/utils/formatters';
import { properCase } from '@/shared/utils/helper';
import type { ReportType } from './types';

export const getPDFPrintOptions = (
  _reportType?: ReportType | null,
  orientation?: 'portrait' | 'landscape',
) => {
  const isLandscape = orientation === 'landscape';
  return isLandscape ? { width: 792, height: 612 } : { width: 612, height: 792 };
};

const getSharedCSS = (generationTime: string, landscape = false) => `
  @page {
    size: A4 ${landscape ? 'landscape' : 'portrait'};
    margin: 1.2cm;
    @bottom-left {
      content: "Generated on ${generationTime}";
      font-size: 10px;
      color: #666;
    }
    @bottom-right {
      content: "Page " counter(page) " of " counter(pages);
      font-size: 10px;
      color: #666;
    }
  }
  body { 
    font-family: Arial, sans-serif;
    padding: 10px;
    padding-bottom: 50px;
    color: #333;
    line-height: 1.2;
    max-width: 100%;
    margin: 0 auto;
    position: relative;
  }
  table { 
    width: 100%; 
    border-collapse: collapse; 
    margin-top: 8px;
    font-size: 11px;
  }
  th, td { 
    border: 1px solid #ddd; 
    padding: 4px 6px; 
    text-align: left; 
  }
  th { 
    background-color: #d1e7dd;
    font-weight: bold;
    text-transform: capitalize;
  }
  .number-column {
    width: 30px;
    text-align: center;
  }
  .amount { text-align: right; }
  .number { text-align: right; }
  .date { white-space: nowrap; }
  .nowrap { white-space: nowrap; }
  tr:nth-child(even) { background-color: #f9f9f9; }
  .business-header {
    text-align: center;
    margin-bottom: 10px;
    border-bottom: 1px solid #eee;
    padding-bottom: 10px;
  }
  .business-name {
    font-size: 22px;
    font-weight: bold;
    margin-bottom: 4px;
    color: #2c3e50;
  }
  .business-details {
    font-size: 12px;
    color: #666;
  }
  .insufficient-payment-cell { background-color: #ffebcc !important; }
  .refunded-payment-cell { background-color: #f8d7da !important; color: #842029; font-weight: bold; text-align: left; }
  .partial-refund-payment-cell { background-color: #fff3cd !important; color: #664d03; font-weight: bold; }
  .waived-payment-cell { background-color: #ede9fe !important; color: #6d28d9; font-weight: bold; text-align: left; }
  .holiday-payment-cell { background-color: #e2e8f0 !important; color: #334155; font-weight: bold; text-align: left; }
  .refunded-amount { text-decoration: line-through; }
  .metrics-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
    gap: 15px;
  }
  .metric-card {
    flex: 1;
    background-color: #fff;
    border: 1px solid #ddd;
    padding: 10px;
    border-radius: 8px;
    text-align: center;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
  .metric-label {
    font-size: 10px;
    color: #666;
    text-transform: uppercase;
    margin-bottom: 4px;
    font-weight: bold;
  }
  .metric-value {
    font-size: 18px;
    font-weight: bold;
    color: #333;
  }
  .section-title {
    font-size: 14px;
    font-weight: bold;
    border-bottom: 2px solid #333;
    padding-bottom: 4px;
    margin-bottom: 10px;
    margin-top: 15px;
    text-transform: uppercase;
    color: #2c3e50;
  }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
    margin-bottom: 8px;
  }
  .stat-card {
    background-color: #f8f9fa;
    border: 1px solid #ddd;
    padding: 8px 6px;
    border-radius: 4px;
    text-align: center;
  }
  .stat-label {
    font-size: 9px;
    color: #666;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .stat-value {
    font-size: 18px;
    font-weight: bold;
    color: #333;
  }
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  .highlight { background-color: #e9ecef; font-weight: bold; }
  .trend-indicator {
    font-size: 10px;
    margin-top: 4px;
    font-weight: 600;
  }
  .trend-up { color: #c0392b; }
  .trend-down { color: #27ae60; }
  .category-item { margin-bottom: 12px; }
  .category-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .category-name { font-weight: bold; font-size: 11px; }
  .category-amount { font-weight: bold; font-size: 11px; }
  .progress-bar-bg { height: 8px; background-color: #eee; border-radius: 4px; overflow: hidden; width: 100%; }
  .progress-bar-fill { height: 100%; border-radius: 4px; }
  .charts-row { display: flex; justify-content: space-between; gap: 15px; margin-top: 15px; }
  .chart-box { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 12px; background-color: #fafafa; display: flex; flex-direction: column; }
  .chart-box .section-title { margin-top: 0; font-size: 13px; border-bottom: 1px solid #ddd; margin-bottom: 12px; padding-bottom: 5px; text-align: left; }
  .chart-box .chart-container { display: flex; justify-content: space-around; align-items: flex-end; height: 110px; padding: 10px 0; border-bottom: none; margin-bottom: 0; }
  .chart-box .chart-column { display: flex; flex-direction: column; align-items: center; width: 45px; }
  .chart-box .bar-wrapper { width: 24px; height: 60px; background-color: #f0f0f0; display: flex; flex-direction: column; justify-content: flex-end; border-radius: 4px 4px 0 0; }
  .chart-box .bar-fill { width: 100%; background-color: #2196F3; border-radius: 4px 4px 0 0; }
  .chart-box .chart-val { font-size: 8px; margin-bottom: 3px; font-weight: bold; }
  .chart-box .chart-label { font-size: 9px; margin-top: 5px; color: #666; }
  .current-month { color: #2196F3; font-weight: bold; }
  .pdf-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 8px;
    border-top: 1px dashed #ccc;
    background-color: #ffffff;
    font-size: 9.5px;
    color: #64748b;
    text-align: center;
  }
`;

const getSharedHTMLShell = (
  bodyContent: string,
  generationTime: string,
  business: Business | null,
  reportTitle: string,
  reportSubtitle?: string,
  landscape = false,
) => `
<!DOCTYPE html>
<html>
  <head>
    <style>${getSharedCSS(generationTime, landscape)}</style>
  </head>
  <body>
    ${
      business
        ? `
    <div class="business-header">
      <div class="business-name">${business?.name || 'Business Report'}</div>
      <div class="business-details">
        ${business?.address ? `${business.address}<br>` : ''}
        ${business?.phone ? `Phone: ${business.phone} | ` : ''}
        ${business?.email ? `Email: ${business.email}` : ''}
      </div>
    </div>`
        : ''
    }
    <h2 style="text-align: center; color: #2c3e50; margin-top: 0;">${reportTitle}</h2>
    ${reportSubtitle ? `<p style="text-align: center; font-size: 12px; color: #666; margin-top: -10px;">${reportSubtitle}</p>` : ''}
    
    ${bodyContent}

    <footer class="pdf-footer">
      This is a digitally signed document generated by ${business?.name || 'Property Management System'}.
    </footer>
  </body>
</html>
`;

export const generatePDFContent = (
  data: Record<string, unknown>[],
  type: ReportType | null,
  business: Business | null = null,
  headers: string[] = [],
  options?: any,
): string => {
  const now = new Date();
  const generationTime = now.toLocaleString();
  const defaultCurrency = options?.defaultCurrency;
  let groupCounter = 1;

  const formatCellValue = (val: unknown): string => {
    if (typeof val === 'number') {
      return defaultCurrency
        ? formatWithCurrency(val, defaultCurrency)
        : val.toLocaleString();
    }
    return String(val ?? '');
  };

  if (type === 'business_summary') {
    return generateBusinessSummaryHTML(data, business, generationTime);
  }
  if (type === 'expenses_analysis') {
    return generateExpensesAnalysisHTML(data, business, generationTime, options);
  }

  const groupHeader = data.find(d => (d as any).isGroupHeader) as any;
  const groupedBy = groupHeader?.groupedBy;

  let reportTitle = type ? `${properCase(type.replace(/_/g, ' '))} Report` : 'Report';
  if (options?.isYearToDate) {
    reportTitle += ' - Year to Date';
  } else if (type === 'pending_rent' && data.length > 0) {
    const months = new Set(
      data
        .filter(r => !(r as any).isGroupHeader)
        .map(r => `${(r as any).current_month}-${(r as any).current_year}`),
    );
    if (months.size > 1) {
      reportTitle += options?.isYearToDate ? ' - Year to Date' : ' - All Time';
    } else {
      const firstRow = data.find(d => !(d as any).isGroupHeader) as any;
      if (firstRow?.current_month && firstRow?.current_year) {
        const monthData = MONTHS.find(m => m.value === firstRow.current_month);
        reportTitle += ` ${monthData ? monthData.label : firstRow.current_month} ${firstRow.current_year}`;
      }
    }
  } else if (type === 'tenant_ledger' && data.length > 0) {
    const firstRow = data[0] as { tenant_name?: string };
    if (firstRow.tenant_name) reportTitle += ` - ${firstRow.tenant_name}`;
  } else if (type === 'tenants' && options?.moveOutMonth) {
    const d = options.moveOutMonth as Date;
    reportTitle += ` - Moveout ${formatPeriod({ month: d.getMonth() + 1, year: d.getFullYear() })}`;
  }

  const getFilteredHeaders = (rawHeaders: string[]) =>
    rawHeaders.filter(
      key =>
        !key.endsWith('_status') &&
        !['current_month', 'current_year', groupedBy].includes(key) &&
        (key !== 'tenant_name' || type !== 'tenant_ledger'),
    );

  const getTableHeaderHTML = (filteredHeaders: string[]) => `
    <thead>
      <tr>
        <th class="number-column">#</th>
        ${filteredHeaders
          .map(
            key =>
              `<th class="${['tenant', 'tenant_name', 'name', 'current_tenant'].includes(key.toLowerCase()) ? 'nowrap' : ''}">${key
                .split('_')
                .map(word => properCase(word))
                .join(' ')}</th>`,
          )
          .join('')}
      </tr>
    </thead>
  `;

  let tableContent = '';
  const firstMsg = (data[0] as any)?.message;
  if (data.length === 0 || firstMsg) {
    const emptyMsg = firstMsg || 'No records were found matching the report criteria.';
    tableContent = `
      <div style="text-align: center; padding: 40px 20px; background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; margin: 30px 0;">
        <div style="font-size: 16px; font-weight: bold; color: #334155; margin-bottom: 6px;">No Data Available</div>
        <div style="font-size: 12px; color: #64748b;">${emptyMsg}</div>
      </div>
    `;
  } else {
    const rawHeaders =
      headers.length > 0
        ? headers
        : Object.keys(data.find(d => !(d as any).isGroupHeader) || {});
    const filteredHeaders = getFilteredHeaders(rawHeaders);

    tableContent += `<table>`;
    if (!(data[0] as any).isGroupHeader) {
      tableContent += getTableHeaderHTML(filteredHeaders);
    }
    tableContent += `<tbody>`;

    tableContent += data
      .map(row => {
        if ((row as any).isGroupHeader) {
          groupCounter = 1;
          const fh = getFilteredHeaders(
            headers.length > 0
              ? headers
              : Object.keys(data.find(d => !(d as any).isGroupHeader) || {}),
          );
          return `
          <tr class="group-header">
            <td colspan="${fh.length + 1}" style="background-color: #d1e7dd; font-weight: bold; padding: 12px 8px 4px 8px; text-align: center; border: 1px solid #ccc; font-size: 14px;">
              ${(row as any).property}
            </td>
          </tr>
          <tr>
            <th class="number-column">#</th>
            ${fh
              .map(
                key =>
                  `<th class="${['tenant', 'tenant_name', 'name', 'current_tenant'].includes(key.toLowerCase()) ? 'nowrap' : ''}">${key
                    .split('_')
                    .map(word => properCase(word))
                    .join(' ')}</th>`,
              )
              .join('')}
          </tr>
        `;
        }

        const insufficientCells = new Set<number>();
        if (type === 'receipts' && row.contract_amount) {
          const contractAmount = parseFloat(
            String(row.contract_amount).replace(/,/g, ''),
          );
          Object.keys(row)
            .filter(
              key =>
                !['property', 'house_number', 'tenant', 'contract_amount'].includes(
                  key,
                ) && !key.endsWith('_status'),
            )
            .forEach(key => {
              const paidAmount = row[key];
              const periodStatuses = (row[`${key}_status`] as string[]) || [];
              const isCellWaivedOrHoliday =
                paidAmount === 'Waived' ||
                paidAmount === 'Holiday' ||
                paidAmount === 'Refunded' ||
                periodStatuses.includes('waived') ||
                periodStatuses.includes('holiday') ||
                periodStatuses.includes('refunded');
              if (paidAmount && paidAmount !== '-' && !isCellWaivedOrHoliday) {
                const paid = parseFloat(String(paidAmount).replace(/,/g, ''));
                if (paid < contractAmount && !periodStatuses.includes('paid')) {
                  const fullRowKeys = Object.keys(row).filter(
                    k => !k.endsWith('_status'),
                  );
                  insufficientCells.add(fullRowKeys.indexOf(key) + 1);
                }
              }
            });
        } else if (type === 'pending_rent' && row.payment_status === 'partial') {
          const keys = Object.keys(row).filter(key => !key.endsWith('_status'));
          insufficientCells.add(keys.indexOf('amount_pending') + 1);
        }

        return `
        <tr>
          <td class="number-column">${groupCounter++}</td>
          ${Object.keys(row)
            .filter(
              key =>
                !key.endsWith('_status') &&
                !['current_month', 'current_year', groupedBy].includes(key) &&
                (key !== 'tenant_name' || type !== 'tenant_ledger'),
            )
            .map((key, cellIndex) => {
              const isNameColumn = [
                'tenant',
                'tenant_name',
                'name',
                'current_tenant',
              ].includes(key.toLowerCase());
              const periodStatuses =
                type === 'receipts' ? (row[`${key}_status`] as string[]) || [] : [];
              const isRefunded =
                periodStatuses.includes('refunded') || row[key] === 'Refunded';
              const isPartialRefund = periodStatuses.includes('partial_refund');
              const isHoliday =
                type === 'receipts' &&
                (periodStatuses.includes('holiday') || row[key] === 'Holiday');
              const isWaived =
                type === 'receipts' &&
                (periodStatuses.includes('waived') || row[key] === 'Waived');
              const statusClass = isRefunded
                ? 'refunded-payment-cell'
                : isPartialRefund
                  ? 'partial-refund-payment-cell'
                  : isHoliday
                    ? 'holiday-payment-cell'
                    : isWaived
                      ? 'waived-payment-cell'
                      : '';
              const formattedValue = formatCellValue(row[key]);
              const amountValue = isRefunded
                ? 'Refunded'
                : isPartialRefund
                  ? `<span class="refunded-amount">${formattedValue}</span>`
                  : formattedValue;
              return `<td class="${insufficientCells.has(cellIndex + 1) ? 'insufficient-payment-cell' : ''} ${statusClass} ${isNameColumn ? 'nowrap' : ''}">${amountValue}</td>`;
            })
            .join('')}
        </tr>
      `;
      })
      .join('');

    tableContent += `</tbody></table>`;
  }

  const isLandscape = options?.orientation === 'landscape';

  return getSharedHTMLShell(
    tableContent,
    generationTime,
    business,
    reportTitle,
    undefined,
    isLandscape,
  );
};

const generateExpensesAnalysisHTML = (
  data: any[],
  business: Business | null,
  generationTime: string,
  options?: any,
) => {
  const item = data[0];
  if (!item || item.message) {
    const emptyMsg = item?.message || 'No expense analysis data available.';
    return getSharedHTMLShell(
      `
      <div style="text-align: center; padding: 40px 20px; background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; margin: 30px 0;">
        <div style="font-size: 16px; font-weight: bold; color: #334155; margin-bottom: 6px;">No Data Available</div>
        <div style="font-size: 12px; color: #64748b;">${emptyMsg}</div>
      </div>
      `,
      generationTime,
      business,
      'Expense Analysis',
    );
  }

  const {
    selectedMonthDate,
    totalSpent,
    categoryBreakdown,
    trendData,
    isAllTime,
    isYTD,
    totalVariance,
    comparisonLabel,
  } = item;
  const rawDate = selectedMonthDate || new Date();
  const dateObj = rawDate instanceof Date ? rawDate : new Date(rawDate);
  const defaultCurrency = options?.defaultCurrency;
  const showDetails = options?.showDetails !== false;

  const formatValue = (val: any) => {
    if (val === undefined || val === null) return '0';
    const num = typeof val === 'number' ? val : parseFloat(String(val)) || 0;
    return defaultCurrency
      ? formatWithCurrency(num, defaultCurrency)
      : num.toLocaleString();
  };

  const renderVariance = (variance: number) => {
    if (isAllTime) return '';
    if (variance === 0 || Number.isNaN(variance))
      return '<div class="trend-indicator" style="color: #666;">No change</div>';
    const isUp = variance > 0;
    return `<div class="trend-indicator ${isUp ? 'trend-up' : 'trend-down'}">${Math.abs(variance).toFixed(1)}% ${isUp ? '▲' : '▼'} ${comparisonLabel}</div>`;
  };

  const periodLabel = isAllTime
    ? 'All Time'
    : isYTD
      ? `Year to Date (${dateObj.getFullYear()})`
      : `${dateObj.toLocaleString('default', { month: 'long' })} ${dateObj.getFullYear()}`;
  const trendTitleSuffix = isYTD
    ? `Year to Date (${trendData.length} Months)`
    : `Last ${trendData.length} Months`;

  const utilitiesCategory = categoryBreakdown.find((c: any) => c.key === 'Utilities');
  const maintenanceCategory = categoryBreakdown.find((c: any) => c.key === 'Maintenance');
  const otherCategory = categoryBreakdown.find((c: any) => c.key === 'Other');
  const maxTrendVal = Math.max(...trendData.map((t: any) => t.utilities), 100);

  let bodyContent = `
    <div class="metrics-row">
      <div class="metric-card">
        <div class="metric-label">Total Expenses</div>
        <div class="metric-value">${formatValue(totalSpent)}</div>
        ${renderVariance(totalVariance)}
      </div>
      <div class="metric-card">
        <div class="metric-label">Utilities Total</div>
        <div class="metric-value" style="color: #2196F3;">${formatValue(utilitiesCategory?.amount || 0)}</div>
        ${renderVariance(utilitiesCategory?.variance || 0)}
      </div>
    </div>
    <div class="metrics-row">
      <div class="metric-card">
        <div class="metric-label">Maintenance Total</div>
        <div class="metric-value" style="color: #FF9800;">${formatValue(maintenanceCategory?.amount || 0)}</div>
        ${renderVariance(maintenanceCategory?.variance || 0)}
      </div>
      <div class="metric-card">
        <div class="metric-label">Other Expenses</div>
        <div class="metric-value" style="color: #757575;">${formatValue(otherCategory?.amount || 0)}</div>
        ${renderVariance(otherCategory?.variance || 0)}
      </div>
    </div>

    <div class="charts-row">
      <div class="chart-box">
        <div class="section-title">Categories Breakdown</div>
        ${categoryBreakdown
          .map(
            (cat: any) => `
          <div class="category-item">
            <div class="category-header">
              <span class="category-name">${cat.label}</span>
              <span class="category-amount">${formatValue(cat.amount)} (${cat.percentage.toFixed(1)}%)</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${cat.percentage}%; background-color: ${cat.key === 'Utilities' ? '#2196F3' : cat.key === 'Maintenance' ? '#FF9800' : '#757575'};"></div>
            </div>
          </div>
        `,
          )
          .join('')}
      </div>
      <div class="chart-box">
        <div class="section-title">Utilities Trend - ${trendTitleSuffix}</div>
        <div class="chart-container">
          ${trendData
            .map(
              (t: any) => `
            <div class="chart-column">
              <div class="chart-val">${t.utilities > 0 ? Math.round(t.utilities).toLocaleString() : '-'}</div>
              <div class="bar-wrapper"><div class="bar-fill" style="height: ${(t.utilities / maxTrendVal) * 100}%; ${t.isCurrent ? '' : 'opacity: 0.6;'}"></div></div>
              <div class="chart-label ${t.isCurrent ? 'current-month' : ''}">${t.label}</div>
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    </div>

    <div class="charts-row">
      <div class="chart-box">
        <div class="section-title">Maintenance Trend - ${trendTitleSuffix}</div>
        <div class="chart-container">
          ${(() => {
            const maxMaintVal = Math.max(
              ...trendData.map((t: any) => t.maintenance),
              100,
            );
            return trendData
              .map(
                (t: any) => `
              <div class="chart-column">
                <div class="chart-val">${t.maintenance > 0 ? Math.round(t.maintenance).toLocaleString() : '-'}</div>
                <div class="bar-wrapper"><div class="bar-fill" style="height: ${(t.maintenance / maxMaintVal) * 100}%; background-color: #FF9800; ${t.isCurrent ? '' : 'opacity: 0.6;'}"></div></div>
                <div class="chart-label ${t.isCurrent ? 'current-month' : ''}">${t.label}</div>
              </div>
            `,
              )
              .join('');
          })()}
        </div>
      </div>
      <div class="chart-box">
        <div class="section-title">Other Trend - ${trendTitleSuffix}</div>
        <div class="chart-container">
          ${(() => {
            const maxOtherVal = Math.max(...trendData.map((t: any) => t.other), 100);
            return trendData
              .map(
                (t: any) => `
              <div class="chart-column">
                <div class="chart-val">${t.other > 0 ? Math.round(t.other).toLocaleString() : '-'}</div>
                <div class="bar-wrapper"><div class="bar-fill" style="height: ${(t.other / maxOtherVal) * 100}%; background-color: #757575; ${t.isCurrent ? '' : 'opacity: 0.6;'}"></div></div>
                <div class="chart-label ${t.isCurrent ? 'current-month' : ''}">${t.label}</div>
              </div>
            `,
              )
              .join('');
          })()}
        </div>
      </div>
    </div>
  `;

  if (showDetails) {
    bodyContent += `
      <div class="section" style="page-break-before: always;">
        <div class="section-title">Transaction Details</div>
        ${categoryBreakdown
          .filter((cat: any) => cat.records.length > 0)
          .map(
            (cat: any) => `
          <div class="category-item" style="margin-bottom: 25px;">
            <h3 style="margin-bottom: 10px; color: #2c3e50; font-size: 14px; border-bottom: 1px solid #eee; padding-bottom: 5px;">
              ${cat.label} Transactions <span style="float: right; font-weight: normal; font-size: 12px; color: #666;">Total: ${formatValue(cat.amount)}</span>
            </h3>
            <table class="records-table" style="margin-left: 0; width: 100%;">
              <thead><tr><th style="width: 80px;">Date</th><th>Remarks</th><th style="width: 100px; text-align: right;">Amount</th></tr></thead>
              <tbody>${cat.records.map((rec: any) => `<tr><td>${new Date(rec.date).toLocaleDateString()}</td><td>${rec.remarks || '-'}</td><td class="amount">${formatValue(rec.amount)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        `,
          )
          .join('')}
      </div>
    `;
  }

  const isLandscape = options?.orientation === 'landscape';
  return getSharedHTMLShell(
    bodyContent,
    generationTime,
    business,
    'EXPENSES & UTILITIES ANALYSIS',
    `Reporting Period: ${periodLabel}`,
    isLandscape,
  );
};

const generateBusinessSummaryHTML = (
  data: any[],
  business: Business | null,
  generationTime: string,
  options?: any,
) => {
  const item = data[0];

  const bodyContent = `
    <div class="section">
      <div class="section-title">Key Performance Indicators</div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">Total Units</div><div class="stat-value">${item.summary.total_houses}</div></div>
        <div class="stat-card"><div class="stat-label">Occupancy Rate</div><div class="stat-value">${item.summary.occupancy_rate.toFixed(1)}%</div></div>
        <div class="stat-card"><div class="stat-label">Gross Revenue</div><div class="stat-value" style="color: #2980b9;">${item.summary.total_gross_revenue.toLocaleString()}</div></div>
        <div class="stat-card"><div class="stat-label">Total Expenses</div><div class="stat-value" style="color: #c0392b;">${item.summary.total_expenses.toLocaleString()}</div></div>
        <div class="stat-card"><div class="stat-label">Net Operating Income</div><div class="stat-value" style="color: #27ae60;">${item.summary.net_profit.toLocaleString()}</div></div>
      </div>
    </div>
    <div class="grid-2">
      <div class="section">
        <div class="section-title">Tenant Portfolio</div>
        <table>
          <tr><td class="highlight">Active Tenants</td><td class="number">${item.tenants.active}</td></tr>
          <tr><td>Pending Check-ins</td><td class="number">${item.tenants.pending}</td></tr>
          <tr><td>Former Tenants</td><td class="number">${item.tenants.former}</td></tr>
          <tr class="highlight"><td>Total Lifetime Tenants</td><td class="number">${item.tenants.active + item.tenants.former}</td></tr>
        </table>
      </div>
      <div class="section">
        <div class="section-title">Maintenance Summary</div>
        <table>
          <tr><td style="color: #c0392b; font-weight: bold;">Open Requests</td><td class="number">${item.maintenance.open}</td></tr>
          <tr><td style="color: #e67e22;">In Progress</td><td class="number">${item.maintenance.in_progress}</td></tr>
          <tr><td style="color: #27ae60;">Completed</td><td class="number">${item.maintenance.completed}</td></tr>
          <tr class="highlight"><td>Total Tickets</td><td class="number">${item.maintenance.open + item.maintenance.in_progress + item.maintenance.completed}</td></tr>
        </table>
      </div>
    </div>
    <div class="grid-2">
      <div class="section">
        <div class="section-title">Unit Inventory Mix</div>
        <table>
          <thead><tr><th>House Type</th><th class="number">Count</th></tr></thead>
          <tbody>${item.houseTypes.map((t: any) => `<tr><td>${t.type}</td><td class="number">${t.count}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="section">
        <div class="section-title">Financial Distribution</div>
        <table>
          <thead><tr><th>Payment Method</th><th class="amount">Amount</th></tr></thead>
          <tbody>
            ${item.paymentStats.map((s: any) => `<tr><td>${properCase(s.method)}</td><td class="amount">${s.amount.toLocaleString()}</td></tr>`).join('')}
            ${item.paymentStats.length === 0 ? '<tr><td colspan="2" style="text-align:center;">No revenue recorded</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Expense Analysis (Top 5)</div>
      <table>
        <thead><tr><th>Category</th><th class="amount">Total Spent</th><th class="number">% of Total</th></tr></thead>
        <tbody>
          ${item.topExpenses.map((e: any) => `<tr><td>${properCase(e.category)}</td><td class="amount">${e.amount.toLocaleString()}</td><td class="number">${item.summary.total_expenses > 0 ? ((e.amount / item.summary.total_expenses) * 100).toFixed(1) : 0}%</td></tr>`).join('')}
          <tr class="highlight"><td>Total Expenses</td><td class="amount">${item.summary.total_expenses.toLocaleString()}</td><td class="number">100%</td></tr>
        </tbody>
      </table>
    </div>
    <div class="section">
      <div class="section-title">Property Performance Matrix</div>
      <table>
        <thead><tr><th>Property Name</th><th class="number">Total</th><th class="number">Occupied</th><th class="number">Available</th><th class="number">Occupancy %</th><th class="amount">Revenue</th></tr></thead>
        <tbody>
          ${item.properties.map((p: any) => `<tr><td style="font-weight: bold;">${p.name}</td><td class="number">${p.total_houses}</td><td class="number">${p.occupied_houses}</td><td class="number">${p.available_houses}</td><td class="number">${p.occupancy_rate.toFixed(1)}%</td><td class="amount">${p.revenue.toLocaleString()}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  const isLandscape = options?.orientation === 'landscape';
  return getSharedHTMLShell(
    bodyContent,
    generationTime,
    business,
    'BUSINESS PERFORMANCE REPORT',
    `Reporting Period: ${item.period}`,
    isLandscape,
  );
};
