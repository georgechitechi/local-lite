import { capitalizeEachWord } from '@/shared/utils/helper';
import {
  findCurrencyAmount,
  findMpesaReference,
  findPhoneNumber,
  normalizePhoneNumber,
} from './helpers';
import type { MessageMetadata, MessageParser } from './types';

export class FallbackParser implements MessageParser {
  canParse(): boolean {
    return true; // Always true for the fallback
  }

  extract(text: string): MessageMetadata {
    if (!text) return { amount: null, date: null, ref: null, name: null, phone: null };

    // 1. Reference Extraction
    const ref = findMpesaReference(text);

    // 2. Phone Extraction
    const phone = normalizePhoneNumber(findPhoneNumber(text));

    // 3. Amount Extraction
    const amountStr = findCurrencyAmount(text, true);
    const amount = amountStr ? amountStr.replace(/,/g, '').trim() : null;

    // 4. Date Extraction
    const dateMatch =
      text.match(/(\d{4}-\d{2}-\d{2})/) ||
      text.match(/(\d{1,2}[-/.]\d{1,2}[-/.]\d{2}(?:\d{2})?)/) ||
      text.match(
        /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i,
      );
    let date = null;
    if (dateMatch) {
      date = dateMatch[1];
    }

    // 5. Name Extraction Heuristics
    const toExclude = [
      ref,
      amountStr,
      phone,
      'M-Pesa',
      'Mps',
      'KES',
      'Ksh',
      'Phone',
      'Ref',
      'Confirmed',
    ].filter(Boolean) as string[];

    const nameMatch =
      text.match(/received\s+from\s+([^.\d]+?)(?:\s+Phone|\s+on|\d|\.|$)/i) ||
      text.match(/(?:from|by)\s+([^.\d]+?)(?:\s+Phone|\s+on|\d|\.|$)/i) ||
      text.match(/to\s+([a-zA-Z\s]+?)\s+(?:in|Ref|on|\d|\.)/i);

    let name = nameMatch
      ? nameMatch[1].replace(/\s+Phone\s*(?:No\.?)?$/i, '').trim()
      : null;

    if (name) {
      name = name.replace(/\s+/g, ' ').trim();
      name = capitalizeEachWord(name);
    }

    if (name && toExclude.some(ex => name?.toLowerCase() === ex.toLowerCase())) {
      name = null;
    }

    return { amount, date, ref, name, phone };
  }
}
