/**
 * Unified Financial & Analytics Math Calculations
 * Single source of truth for revenue, net amounts, profit, growth rates, and date-range analytics.
 */

export interface ReceiptLike {
  amount?: number | string | null;
  refunded_amount?: number | string | null;
  status?: string | null;
  payment_method?: string | null;
  type?: string | null;
}

export interface ExpenseLike {
  amount?: number | string | null;
  category?: string | null;
  date?: string | null;
}

/**
 * Computes net receipt amount after subtracting refunds.
 * Always clamps to 0 to prevent negative revenue.
 */
export function computeNetReceipt(receipt: ReceiptLike | null | undefined): number {
  if (!receipt) return 0;
  const amount = parseFloat(String(receipt.amount || 0));
  const refunded = parseFloat(String(receipt.refunded_amount || 0));
  return Math.max(0, amount - refunded);
}

/**
 * Checks if a given date falls inclusively within start and end boundaries (from start 00:00:00 to end 23:59:59.999).
 * If allTime is true, returns true immediately.
 */
export function isDateInRange(
  dateStrOrObj: string | Date | null | undefined,
  startDate: string | Date,
  endDate: string | Date,
  allTime?: boolean,
): boolean {
  if (allTime) return true;
  if (!dateStrOrObj) return false;

  const target = new Date(dateStrOrObj);
  if (Number.isNaN(target.getTime())) return false;
  target.setHours(0, 0, 0, 0);

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  return target >= start && target <= end;
}

/**
 * Formats a date string or Date into a Year-Month key: 'YYYY-MM'
 */
export function formatMonthKey(date: string | Date): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Formats a 'YYYY-MM' key into a localized human label: e.g. 'October 2026'
 */
export function formatMonthLabel(key: string): string {
  const [y, m] = key.split('-');
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Generates an array of 'YYYY-MM' strings spanning from start to end date inclusive.
 */
export function generateMonthRangeKeys(startDate: Date, endDate: Date): string[] {
  const months: string[] = [];
  const cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (cur <= last) {
    months.push(formatMonthKey(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

/**
 * Computes percentage growth between two values.
 */
export function calculateGrowthPercentage(current: number, previous: number): number {
  if (!previous || previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Computes occupancy rate percentage given occupied rooms and total rentable rooms.
 */
export function calculateOccupancyRate(occupied: number, rentableTotal: number): number {
  if (!rentableTotal || rentableTotal <= 0) return 0;
  return (occupied / rentableTotal) * 100;
}

/**
 * Computes rent collection rate percentage given collected revenue and projected rent.
 */
export function calculateCollectionRate(collected: number, projected: number): number {
  if (!projected || projected <= 0) return 0;
  return (collected / projected) * 100;
}

/**
 * Computes net profit from revenue and expenses.
 */
export function calculateNetProfit(revenue: number, expenses: number): number {
  return revenue - expenses;
}
