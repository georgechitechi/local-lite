import { formatDateForDB, parseLocalDate } from '@/shared/utils/formatters';
import { properCase } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
export const getPropertyName = (property: any): string => {
  if (!property) return 'Not assigned';
  if (Array.isArray(property)) {
    return property.length > 0 ? property[0].name || 'Unknown' : 'Not assigned';
  }
  return property.name || 'Not assigned';
};

export const groupDataByProperty = (
  data: Record<string, unknown>[],
): Record<string, unknown>[] => {
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
};

/**
 * Returns true when the user has selected "All Time" in the report modal.
 */
export const isReportAllTime = (options?: Record<string, any>): boolean =>
  !!options?.allTime;

/**
 * Finds the earliest value for a given date field across a flat array of objects.
 * Returns null if none are found.
 */
export const findEarliestDate = (items: any[], dateField: string): Date | null => {
  let earliest: Date | null = null;
  items.forEach(item => {
    const raw = item[dateField];
    if (raw) {
      const d = new Date(raw);
      if (!earliest || d < earliest) earliest = d;
    }
  });
  return earliest;
};

/**
 * Gets the effective date for a house, falling back to its property's
 * effective date, and finally to its created_at timestamp.
 */
export const getEffectiveDate = (house: any): Date | null => {
  if (!house) return null;
  const houseEffective = (house.metadata as any)?.effective_date;
  if (houseEffective) return parseLocalDate(houseEffective);
  const propEffective = (house.property?.metadata as any)?.effective_date;
  if (propEffective) return parseLocalDate(propEffective);
  if (house.created_at) return parseLocalDate(house.created_at);
  return null;
};

/** YYYY-MM-DD in local calendar time (avoids UTC shift from toISOString). */
export const toLocalDateKey = (d: Date): string => formatDateForDB(d);

/**
 * True when the house is in inventory as of `asOf` (inclusive).
 * Missing effective dates are treated as already commissioned.
 */
export const isCommissionedAsOf = (house: any, asOf: Date): boolean => {
  const effectiveDate = getEffectiveDate(house);
  if (!effectiveDate) return true;
  return toLocalDateKey(effectiveDate) <= toLocalDateKey(asOf);
};

/**
 * Finds the earliest contract start_date by scanning a nested `contracts` array
 * on each item (typically houses). Considers the house/property effective date as a baseline.
 */
export const findEarliestContractDate = (houses: any[]): Date | null => {
  let earliest: Date | null = null;
  houses.forEach(h => {
    const effectiveDate = getEffectiveDate(h);
    if (effectiveDate && (!earliest || effectiveDate < earliest)) {
      earliest = effectiveDate;
    }
    (h.contracts || []).forEach((c: any) => {
      if (c.start_date && isActiveContractStatus(c.status)) {
        const d = new Date(c.start_date);
        if (!earliest || d < earliest) earliest = d;
      }
    });
  });
  return earliest;
};

/**
 * Converts an earliest date to the first day of that month, ready to use as
 * the start of an all-time date range. Falls back to Jan 1, 2000 when no
 * data exists so the report still renders rather than crashing.
 */
export const getAllTimeStartDate = (earliest: Date | null): Date =>
  earliest
    ? new Date(earliest.getFullYear(), earliest.getMonth(), 1)
    : new Date(2000, 0, 1);

export const groupDataByStatus = (
  data: Record<string, unknown>[],
): Record<string, unknown>[] => {
  // Sort by status first to ensure items with same status are grouped together
  const sortedData = [...data].sort((a, b) => {
    const statusA = (a.status as string) || 'paid';
    const statusB = (b.status as string) || 'paid';
    return statusA.localeCompare(statusB);
  });

  const grouped: Record<string, unknown>[] = [];
  let currentStatus = '';

  sortedData.forEach(item => {
    const status = (item.status as string) || 'paid';
    if (status !== currentStatus) {
      currentStatus = status;
      grouped.push({
        isGroupHeader: true,
        property: properCase(currentStatus.replace(/_/g, ' ')),
        groupedBy: 'status',
      });
    }
    grouped.push(item);
  });

  return grouped;
};

export const groupDataByPeriod = (
  data: Record<string, unknown>[],
): Record<string, unknown>[] => {
  const grouped: Record<string, unknown>[] = [];
  let currentPeriod = '';

  data.forEach(item => {
    const period = (item.period as string) || 'Unknown';
    if (period !== currentPeriod) {
      currentPeriod = period;
      grouped.push({ isGroupHeader: true, property: currentPeriod, groupedBy: 'period' });
    }
    grouped.push(item);
  });

  return grouped;
};
