import { formatDateForDB } from '@/shared/utils/formatters';
import { formatStandardMessage } from '@/shared/utils/messageFormatter';
import { BaseParser } from '@/shared/utils/parsers/BaseParser';
import { findMpesaReference, findPhoneNumber } from '@/shared/utils/parsers/helpers';

interface BulkMessageResult {
  content: string;
  date: string | null;
  raw: string;
}

class BulkSmsParser extends BaseParser<BulkMessageResult> {
  private fallbackDate: string | null = null;
  private currentDetectedDate: string | null = null;

  constructor(fallbackDate?: string | null) {
    super();
    this.fallbackDate = fallbackDate || null;
  }

  /**
   * Parses a date string like "05 May" into an ISO date string (YYYY-MM-DD).
   */
  protected extractDate(text: string): string | null {
    const match = text.match(
      /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i,
    );
    if (match) {
      const day = parseInt(match[1], 10);
      const monthStr = match[2].toLowerCase().slice(0, 3);
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
      const monthIndex = months.indexOf(monthStr);

      if (monthIndex !== -1) {
        const now = new Date();
        const date = new Date(now.getFullYear(), monthIndex, day);
        if (date > now) {
          date.setFullYear(now.getFullYear() - 1);
        }

        return formatDateForDB(date);
      }
    }
    return null;
  }

  /**
   * Detects if a message contains enough components to be transformed.
   */
  private isRawFormat(text: string): boolean {
    if (!text) return false;
    if (text.toLowerCase().startsWith('confirmed.')) return false;

    const hasAmount = /[\d,]+\.\d{2}/.test(text);
    const hasPhone = !!findPhoneNumber(text);
    const hasRef = !!findMpesaReference(text, 10);

    return hasAmount && (hasPhone || hasRef);
  }

  parse(text: string): BulkMessageResult[] {
    const amountRegex = /[\d,]+\.\d{2}/g;
    const matches = Array.from(text.matchAll(amountRegex));

    const results: BulkMessageResult[] = [];
    let lastIndex = 0;

    for (let i = 0; i < matches.length; i++) {
      const endIndex = matches[i].index + matches[i][0].length;
      const nextText = text.slice(endIndex, endIndex + 15);
      const currencyMatch = nextText.match(
        /^\s*(KES|KSH|USD|EUR|GBP|Amount|Total|Value)/i,
      );
      const finalEndIndex = currencyMatch ? endIndex + currencyMatch[0].length : endIndex;

      const block = text.slice(lastIndex, finalEndIndex).trim();

      // Check for a date in this block
      const dateInBlock = this.extractDate(block);
      if (dateInBlock) {
        this.currentDetectedDate = dateInBlock;
      }

      const activeDate = this.currentDetectedDate || this.fallbackDate || null;

      if (this.isRawFormat(block)) {
        // Use the BaseParser logic to extract pillars and name
        const pillars = this.extractPillars(block, true);

        let dateStr = activeDate || '';
        if (dateStr.includes('-')) {
          const parts = dateStr.split('-');
          if (parts[0].length === 4) dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        if (!dateStr) {
          const now = new Date();
          dateStr = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
        }

        const name = this.extractName(block, pillars);

        const timeMatch = block.match(/\b([01]?\d|2[0-3]):[0-5]\d(\s?[AP]M)?\b/i);
        const timePart = timeMatch ? ` at ${timeMatch[0]}` : '';

        const formattedContent =
          formatStandardMessage({
            amount: pillars.amount || '0.00',
            name: name || 'Unknown',
            phone: pillars.phone || 'Unknown',
            ref: pillars.ref || 'Unknown',
            date: dateStr,
            currency: pillars.currency,
          }) + (timePart ? ` ${timePart}. Thank you.` : '');

        results.push({
          content: formattedContent,
          date: activeDate,
          raw: block,
        });
      }
      lastIndex = finalEndIndex;
    }

    return results;
  }
}

export function isRawFormat(text: string): boolean {
  return (new BulkSmsParser() as any).isRawFormat(text);
}
