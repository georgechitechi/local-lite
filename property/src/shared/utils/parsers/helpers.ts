/**
 * Internal helper to find a currency amount in text.
 * M-Pesa SMS and Bank Statements uniformly list the transaction amount FIRST,
 * followed by transaction fees and/or the remaining balance.
 */
export function findCurrencyAmount(text: string, preferFirst = true): string | null {
  const amountRegex = /([\d,]+\.\d{2})/g;
  const matches = text.match(amountRegex);
  if (!matches) return null;
  return preferFirst ? matches[0] : matches[matches.length - 1];
}

/**
 * Internal helper to find a phone number in text.
 */
export function findPhoneNumber(text: string): string | null {
  const match = text.match(/\b(\+?\d{1,3}[-.\s]?)?(\d{10,12}|0[17]\d{8}|[\d*]{7,12})\b/);
  return match ? match[0] : null;
}

/**
 * Internal helper to find an M-Pesa reference in text.
 * Requires both letters and numbers to avoid matching generic English words like "transaction".
 */
export function findMpesaReference(text: string, minLength = 6): string | null {
  const regex = new RegExp(
    `\\b(?=[A-Z\\d]{${minLength},12}\\b)(?=[A-Z\\d]*[A-Z])(?=[A-Z\\d]*\\d)[A-Z\\d]+\\b`,
    'i',
  );
  const match = text.match(regex);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Internal helper to parse amount string to number.
 */
export function parseAmount(amountStr: string): number {
  return parseFloat(amountStr.replace(/,/g, '')) || 0;
}

export { normalizePhoneNumber } from '@/shared/utils/helper';
