/**
 * Intelligent date parser that handles various common formats found in bank statements.
 * Supports: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, and DD Month YYYY.
 */
export function smartParseDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  // 1. Try DD/MM/YYYY or DD-MM-YYYY
  const commonMatch = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (commonMatch) {
    const [, d, m, y] = commonMatch;
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  }

  // 2. Try YYYY-MM-DD (ISO)
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  }

  // 3. Try DD Month YYYY (e.g., 05 May 2024 or 5 May 24)
  const months = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ];
  const monthMatch = dateStr.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{2,4})$/i);
  if (monthMatch) {
    const [, d, m, y] = monthMatch;
    const monthIndex = months.indexOf(m.toLowerCase().slice(0, 3));
    if (monthIndex !== -1) {
      let year = parseInt(y, 10);
      if (year < 100) year += 2000;
      return new Date(year, monthIndex, parseInt(d, 10));
    }
  }

  // 4. Fallback to standard Date constructor
  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Generates a standard note block for imported messages.
 */
export function formatImportedNote(notes: string, messageContent: string): string {
  const divider = '\n\n------\n';
  return notes ? `${notes}${divider}${messageContent}` : messageContent;
}

/**
 * Generates a standardized M-Pesa style message from structured data.
 * This ensures consistency across the app for both raw message transformation
 * and structured imports (like PDF statements).
 */
export function formatStandardMessage(data: {
  amount: number | string;
  name: string;
  phone: string;
  ref: string;
  date: string; // Expects YYYY-MM-DD or DD-MM-YYYY
  currency?: string;
}): string {
  const { amount, name, phone, ref, date, currency = 'KES' } = data;

  // Normalize date to DD-MM-YYYY for the message display
  let displayDate = date;
  if (date.includes('-')) {
    const parts = date.split('-');
    if (parts[0].length === 4) {
      // YYYY-MM-DD -> DD-MM-YYYY
      displayDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }

  const displayAmount = typeof amount === 'number' ? amount.toFixed(2) : amount;

  return `Confirmed. ${currency}. ${displayAmount} from ${name} Phone No. ${phone} received via M-Pesa Ref. ${ref} on ${displayDate}. Thank you.`;
}

/**
 * Utility to transform raw payment messages from various formats into a standardized M-Pesa format.
 */
export function transformBankMessage(
  input: string,
  overrideDate?: string | null,
): string {
  const { SingleSmsParser } = require('./parsers/SingleSmsParser');
  return new SingleSmsParser().parse(input, overrideDate)[0];
}
