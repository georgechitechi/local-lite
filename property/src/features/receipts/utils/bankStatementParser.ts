import type { BankTransaction } from '@/shared/types/types';
import { BaseParser } from '@/shared/utils/parsers/BaseParser';
import { parseAmount } from '@/shared/utils/parsers/helpers';

export class MpesaStatementParser extends BaseParser<BankTransaction> {
  /**
   * Specifically looks for DD/MM/YYYY in the context bubble.
   */
  protected extractDate(text: string): string | null {
    const match = text.match(/(\d{2}\/\d{2}\/\d{4})/);
    return match ? match[1] : null;
  }

  parse(text: string): BankTransaction[] {
    const transactionMap = new Map<string, BankTransaction>();

    // 1. Find all potential 10-character M-Pesa codes
    const codeRegex = /\b(?=[A-Z\d]{10}\b)(?=[A-Z\d]*[A-Z])(?=[A-Z\d]*\d)[A-Z\d]+\b/g;
    const matches = Array.from(text.matchAll(codeRegex));

    for (const codeMatch of matches) {
      const code = codeMatch[0].toUpperCase();
      if (transactionMap.has(code)) continue;

      // 2. Get the "Line-Aware context bubble" around this code
      let start = codeMatch.index;
      let linesBack = 0;
      while (start > 0 && linesBack < 1) {
        if (text[start] === '\n') linesBack++;
        if (linesBack < 1) start--;
      }

      let end = codeMatch.index;
      let linesForward = 0;
      while (end < text.length && linesForward < 2) {
        if (text[end] === '\n') linesForward++;
        end++;
      }

      let context = text.slice(start, end).trim();

      // Collision Guard: Ensure we don't include the NEXT transaction code
      const otherCodeRegex =
        /\b(?=[A-Z\d]{10}\b)(?=[A-Z\d]*[A-Z])(?=[A-Z\d]*\d)[A-Z\d]+\b/g;
      otherCodeRegex.lastIndex = codeMatch.index + 10;
      const nextCodeMatch = otherCodeRegex.exec(text);
      if (nextCodeMatch && nextCodeMatch.index < end) {
        context = text.slice(start, nextCodeMatch.index).trim();
      }

      // 3. Extract pillars using BaseParser
      const pillars = this.extractPillars(context, true); // true = prefer first match for PDF

      if (pillars.date && pillars.amount) {
        // 4. Extract name using BaseParser
        const cleanName = this.extractName(context, pillars, [code]);

        transactionMap.set(code, {
          date: pillars.date,
          description: cleanName || 'Unknown',
          amount: parseAmount(pillars.amount),
          type: 'credit',
          mpesaCode: code,
          phone: pillars.phone || '',
          raw: context.trim(),
        });
      }
    }

    return Array.from(transactionMap.values());
  }
}
