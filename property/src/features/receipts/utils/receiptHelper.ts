import {
  type Currency,
  formatWithCurrency,
  parsePeriod,
} from '@/shared/utils/formatters';
import { calculateEffectiveRent, parseMetadata } from '@/shared/utils/helper';
import type { ThemeColors } from '@/stores/themeStore';

export interface PaymentPeriod {
  month: number;
  year: number;
}

export interface ReceiptWaiverAndRentResult {
  hasWaiver: boolean;
  waiverType: 'full' | 'partial' | null;
  targetRent: number;
  contractRent: number;
  effectiveRent: number;
  status: string;
}

export interface ReceiptBadgeStyle {
  color: string;
  bgColor: string;
  icon: string;
}

export type StatusColor = ReceiptBadgeStyle;

export type ReceiptThemeColors = Partial<
  Pick<
    ThemeColors,
    | 'success'
    | 'successContainer'
    | 'warning'
    | 'warningContainer'
    | 'error'
    | 'errorContainer'
    | 'primary'
    | 'primaryContainer'
    | 'surfaceVariant'
    | 'onSurfaceVariant'
    | 'outline'
    | 'background'
  >
>;

/**
 * Calculates effective rent, waiver status, and target rent for a receipt.
 * Enforces business rule: If full contract rent is paid (either on this receipt
 * or cumulatively for the contract period), partial waivers are suppressed.
 */
export function resolveReceiptWaiverAndRent(options: {
  receipt: {
    amount?: number | string | null;
    status?: string | null;
    type?: string | null;
    contract_id?: string | null;
    payment_period?: PaymentPeriod | null;
  };
  contract?: {
    rent_amount?: number | string | null;
    metadata?: any;
  } | null;
  rawReceipts?: {
    contract_id?: string | null;
    payment_period?: any;
    amount?: number | string | null;
    refunded_amount?: number | string | null;
    deleted?: boolean | null;
    is_refunded?: boolean | null;
  }[];
}): ReceiptWaiverAndRentResult {
  const { receipt, contract, rawReceipts } = options;
  const totalAmount = parseFloat(String(receipt.amount || 0));
  const contractRent = parseFloat(String(contract?.rent_amount || 0));
  let targetRent = contractRent;
  let effectiveRent = contractRent;
  let hasWaiver = false;
  let waiverType: 'full' | 'partial' | null = null;
  let status = receipt.status || 'paid';

  if (contract) {
    const metadata = parseMetadata(contract.metadata);
    const breaks = metadata.breaks || [];
    const period = parsePeriod(receipt.payment_period);

    if (period.month > 0 && period.year > 0) {
      const calculated = calculateEffectiveRent(
        contractRent,
        period.month,
        period.year,
        breaks,
      );

      effectiveRent = calculated.effectiveRent;
      targetRent = calculated.effectiveRent;

      if (calculated.daysOnBreak > 0 || calculated.isOnFullBreak) {
        hasWaiver = true;
        waiverType = calculated.isOnFullBreak ? 'full' : 'partial';
      }

      if (status === 'partial' && totalAmount >= effectiveRent - 0.1) {
        status = 'paid';
      }
    }

    // If full contract amount is paid, do not show Partial Waiver Applied
    if (contractRent > 0 && waiverType === 'partial') {
      const period = parsePeriod(receipt.payment_period);
      let totalPaidForPeriod = totalAmount;

      if (period.month > 0 && period.year > 0 && receipt.contract_id && rawReceipts) {
        totalPaidForPeriod = rawReceipts
          .filter(r => {
            if (r.contract_id !== receipt.contract_id || r.is_refunded) return false;
            const rPeriod = parsePeriod(r.payment_period);
            return rPeriod.month === period.month && rPeriod.year === period.year;
          })
          .reduce(
            (sum, r) =>
              sum +
              (parseFloat(String(r.amount || 0)) -
                parseFloat(String(r.refunded_amount || 0))),
            0,
          );
      }

      if (totalAmount >= contractRent - 0.1 || totalPaidForPeriod >= contractRent - 0.1) {
        hasWaiver = false;
        waiverType = null;
        targetRent = contractRent;
      }
    }
  }

  if (receipt.type === 'others') {
    status = 'paid';
  }

  return {
    hasWaiver,
    waiverType,
    targetRent,
    contractRent,
    effectiveRent,
    status,
  };
}

/**
 * Formats a human-readable refund string, e.g. "(KES 500 refunded on 1/15/2026)" or "(KES 500 refunded)"
 */
export function formatRefundText(
  refundedAmount: number | string | null | undefined,
  currency?: Currency | string | null,
  refundedAt?: string | null,
): string | null {
  const num = parseFloat(String(refundedAmount || 0));
  if (num <= 0) return null;
  let formattedAmount = num.toString();
  if (currency) {
    if (typeof currency === 'string') {
      formattedAmount = formatWithCurrency(num, {
        code: currency,
        symbol: currency,
        name: currency,
        default: false,
      });
    } else {
      formattedAmount = formatWithCurrency(num, currency);
    }
  }
  const dateSuffix = refundedAt ? ` on ${new Date(refundedAt).toLocaleDateString()}` : '';
  return `(${formattedAmount} refunded${dateSuffix})`;
}

/**
 * Maps receipt status code to user-friendly label
 */
export function formatReceiptStatusLabel(status: string = ''): string {
  switch (status.toLowerCase()) {
    case 'paid':
      return 'Paid';
    case 'partial':
      return 'Partial';
    case 'partial_refund':
      return 'Partial Refund';
    case 'refunded':
      return 'Refunded';
    case 'unpaid':
      return 'Unpaid';
    default:
      return status
        ? status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        : 'Unknown';
  }
}

/**
 * Gets the theme display color for a receipt status code (no hardcoded fallback hexes)
 */
export function getReceiptStatusColor(
  status: string = '',
  colors: ReceiptThemeColors,
): string {
  switch (status.toLowerCase()) {
    case 'paid':
      return colors.success ?? colors.primary ?? '';
    case 'partial':
    case 'partial_refund':
      return colors.warning ?? colors.primary ?? '';
    case 'refunded':
    case 'unpaid':
      return colors.error ?? colors.primary ?? '';
    default:
      return colors.onSurfaceVariant ?? colors.outline ?? '';
  }
}

/**
 * Gets full chip/badge style info (color, bgColor, icon) from theme tokens
 */
export function getReceiptStatusStyle(
  status: string = '',
  colors: ReceiptThemeColors,
): ReceiptBadgeStyle {
  switch (status.toLowerCase()) {
    case 'paid':
      return {
        color: colors.success ?? colors.primary ?? '',
        bgColor: colors.successContainer ?? colors.surfaceVariant ?? '',
        icon: 'check-circle',
      };
    case 'partial':
      return {
        color: colors.warning ?? colors.primary ?? '',
        bgColor: colors.warningContainer ?? colors.surfaceVariant ?? '',
        icon: 'clock-outline',
      };
    case 'partial_refund':
      return {
        color: colors.warning ?? colors.primary ?? '',
        bgColor: colors.warningContainer ?? colors.surfaceVariant ?? '',
        icon: 'cash-refund',
      };
    case 'refunded':
      return {
        color: colors.error ?? colors.primary ?? '',
        bgColor: colors.errorContainer ?? colors.surfaceVariant ?? '',
        icon: 'cash-refund',
      };
    case 'unpaid':
      return {
        color: colors.error ?? colors.primary ?? '',
        bgColor: colors.errorContainer ?? colors.surfaceVariant ?? '',
        icon: 'close-circle',
      };
    default:
      return {
        color: colors.onSurfaceVariant ?? colors.outline ?? '',
        bgColor: colors.surfaceVariant ?? colors.background ?? '',
        icon: 'help-circle',
      };
  }
}

/**
 * Gets full chip/badge style info (color, bgColor, icon) for a payment type from theme tokens
 */
export function getPaymentTypeStyle(
  type: string = '',
  colors: ReceiptThemeColors,
): ReceiptBadgeStyle {
  switch (type.toLowerCase()) {
    case 'rent':
      return {
        color: colors.success ?? colors.primary ?? '',
        bgColor: colors.successContainer ?? colors.surfaceVariant ?? '',
        icon: 'home',
      };
    case 'deposit':
      return {
        color: colors.primary ?? '',
        bgColor: colors.primaryContainer ?? colors.surfaceVariant ?? '',
        icon: 'shield-check',
      };
    case 'utilities':
      return {
        color: colors.warning ?? colors.primary ?? '',
        bgColor: colors.warningContainer ?? colors.surfaceVariant ?? '',
        icon: 'lightning-bolt',
      };
    case 'maintenance':
      return {
        color: colors.error ?? colors.primary ?? '',
        bgColor: colors.errorContainer ?? colors.surfaceVariant ?? '',
        icon: 'wrench',
      };
    default:
      return {
        color: colors.onSurfaceVariant ?? colors.outline ?? '',
        bgColor: colors.surfaceVariant ?? colors.background ?? '',
        icon: 'cash',
      };
  }
}

/**
 * Formats a payment type into clean uppercase text
 */
export function formatPaymentType(type: string = ''): string {
  return type.replace(/_/g, ' ').toUpperCase() || 'UNKNOWN';
}

/**
 * Formats a payment method into clean uppercase text
 */
export function formatPaymentMethod(method: string = ''): string {
  return method.replace(/_/g, ' ').toUpperCase() || 'UNKNOWN';
}

/**
 * Formats a receipt ID into short 8-char uppercase code (e.g. "A1B2C3D4")
 */
export function formatReceiptNumber(id: string = ''): string {
  return id ? id.slice(0, 8).toUpperCase() : '';
}

/**
 * Returns difference label and color for receipt amount inputs ('Overpaid by...', 'Remaining...', 'Paid in full')
 */
export function getAmountAffix(
  amount: number | string,
  expected: number,
  currency: any,
): { text: string; color: 'success' | 'error' } | null {
  if (!expected || expected <= 0) return null;
  const clean =
    typeof amount === 'number'
      ? amount
      : parseFloat(String(amount).replace(/,/g, '')) || 0;
  const diff = clean - expected;

  if (diff > 0.01) {
    return {
      text: `Overpaid by: ${formatWithCurrency(diff, currency)}`,
      color: 'success',
    };
  }
  if (diff < -0.01) {
    return { text: `Remaining: ${formatWithCurrency(-diff, currency)}`, color: 'error' };
  }
  return { text: 'Paid in full', color: 'success' };
}

/**
 * Calculates target rent/deposit and detects whether rent is fully waived for a given contract and period.
 */
export function calculateReceiptTargetRent(
  contract: any,
  month: number,
  year: number,
  type?: string,
): { effectiveRentAmount: number; isRentWaived: boolean } {
  if (!contract) return { effectiveRentAmount: 0, isRentWaived: false };

  if (type === 'deposit') {
    return {
      effectiveRentAmount: Number(contract.deposit_amount || 0),
      isRentWaived: false,
    };
  }

  if (type === 'others') {
    return { effectiveRentAmount: 0, isRentWaived: false };
  }

  const contractRent = Number(contract.rent_amount || 0);
  const metadata = parseMetadata(contract.metadata);
  const breaks = metadata?.breaks || [];

  const { effectiveRent, isOnFullBreak } = calculateEffectiveRent(
    contractRent,
    month,
    year,
    breaks,
  );

  const isRentWaived = contractRent > 0 && (isOnFullBreak || effectiveRent === 0);

  return { effectiveRentAmount: effectiveRent, isRentWaived };
}
