import { properCase } from '@/shared/utils/helper';
import type { ReportType } from './types';
export const generateCSV = (
  data: Record<string, unknown>[],
  headers: string[],
  type: ReportType | null = null,
): string => {
  // Filter headers for CSV
  const groupHeader = data.find(d => (d as any).isGroupHeader) as any;
  const groupedBy = groupHeader?.groupedBy;

  const filteredHeaders = headers.filter(header => {
    if (header.endsWith('_status')) return false;
    if (
      type === 'pending_rent' &&
      (header === 'current_month' || header === 'current_year')
    )
      return false;
    if (type === 'tenant_ledger' && header === 'tenant_name') return false;
    if (header === groupedBy) return false;
    return true;
  });

  const headerRow =
    filteredHeaders.map(h => `"${h.split('_').map(properCase).join(' ')}"`).join(',') +
    '\n';
  const rows = data
    .map(row =>
      filteredHeaders.map(header => JSON.stringify(row[header] || '')).join(','),
    )
    .join('\n');
  return headerRow + rows;
};
