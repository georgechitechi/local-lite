import { capitalizeEachWord } from '@/shared/utils/helper';
import { findCurrencyAmount, findMpesaReference, findPhoneNumber } from './helpers';

export interface ExtractedPillars {
  ref: string | null;
  phone: string | null;
  amount: string | null;
  date: string | null;
  currency: string;
}

export abstract class BaseParser<T> {
  protected abstract extractDate(text: string): string | null;

  protected extractPillars(text: string, preferFirstAmount = true): ExtractedPillars {
    return {
      ref: findMpesaReference(text),
      phone: findPhoneNumber(text),
      amount: findCurrencyAmount(text, preferFirstAmount),
      date: this.extractDate(text),
      currency: text.match(/\b(KES|KSH|USD|EUR|GBP)\b/i)?.[1]?.toUpperCase() || 'KES',
    };
  }

  protected extractName(
    text: string,
    pillars: ExtractedPillars,
    extraStopWords: string[] = [],
  ): string {
    let nameCandidate = text;
    const toRemove = [
      pillars.ref,
      pillars.phone,
      pillars.amount,
      pillars.date,
      pillars.currency,
      'Ksh',
      'KES',
      'Ref:',
      'Ref',
      'Mps',
      'Phone:',
      'Phone',
      'No.',
      'Paid',
      'to',
      'from',
      'received',
      'via',
      'sent',
      ...extraStopWords,
    ];

    toRemove.forEach(term => {
      if (!term) return;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Use word boundaries for alphabetic keywords to avoid matching inside names
      const regex = escaped.match(/^[a-z]+$/i)
        ? new RegExp(`\\b${escaped}\\b`, 'gi')
        : new RegExp(`\\b${escaped}\\b|${escaped}`, 'gi');
      nameCandidate = nameCandidate.replace(regex, '');
    });

    // Remove dates like "05 May"
    nameCandidate = nameCandidate.replace(
      /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/gi,
      '',
    );

    // Remove standalone numbers (often noise at the end of names)
    nameCandidate = nameCandidate.replace(/\b\d+\b/g, '');

    // Clean up punctuation and extra spaces
    nameCandidate = nameCandidate
      .replace(/[()[\].:-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return capitalizeEachWord(nameCandidate);
  }

  abstract parse(input: string, ...args: any[]): T[];
}
