import { formatStandardMessage } from '@/shared/utils/messageFormatter';
import { BaseParser } from './BaseParser';

export class SingleSmsParser extends BaseParser<string> {
  protected extractDate(_text: string): string | null {
    return null; // The single parser relies on overrideDate or current date
  }

  parse(input: string, overrideDate?: string | null): string[] {
    const cleanInput = input.trim();

    if (cleanInput.toLowerCase().startsWith('confirmed.')) {
      return [input];
    }

    const pillars = this.extractPillars(cleanInput, true);
    if (!pillars.amount) return [input];

    const name = this.extractName(cleanInput, pillars);

    let dateStr = '';
    if (overrideDate) {
      const parts = overrideDate.split('-');
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
        } else {
          dateStr = overrideDate;
        }
      }
    }

    if (!dateStr) {
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      dateStr = `${day}-${month}-${year}`;
    }

    const timeMatch = cleanInput.match(/\b([01]?\d|2[0-3]):[0-5]\d(\s?[AP]M)?\b/i);
    const timePart = timeMatch ? ` at ${timeMatch[0]}` : '';

    const formatted =
      formatStandardMessage({
        amount: pillars.amount || '0.00',
        name: name || 'Unknown',
        phone: pillars.phone || 'Unknown',
        ref: pillars.ref || 'Unknown',
        date: dateStr,
        currency: pillars.currency,
      }) + (timePart ? ` ${timePart}. Thank you.` : '');

    return [formatted];
  }
}
