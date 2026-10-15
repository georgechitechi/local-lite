import { FallbackParser } from './FallbackParser';
import { SafaricomSmsParser } from './SafaricomSmsParser';
import { StandardFormatParser } from './StandardFormatParser';
import type { MessageParser } from './types';

const PARSER_REGISTRY: MessageParser[] = [
  new StandardFormatParser(),
  new SafaricomSmsParser(),
  // Add new specific parsers here (e.g. EquityBankParser)
];

const fallbackParser = new FallbackParser();

export function extractMessageMetadata(text: string) {
  if (!text) return { amount: null, date: null, ref: null, name: null, phone: null };

  for (const parser of PARSER_REGISTRY) {
    if (parser.canParse(text)) {
      const result = parser.extract(text);
      if (result.amount || result.ref || result.name || result.phone) {
        return result;
      }
    }
  }

  return fallbackParser.extract(text);
}

export * from '@/shared/types/types';
export { BaseParser } from './BaseParser';
export { FallbackParser } from './FallbackParser';
export { SafaricomSmsParser } from './SafaricomSmsParser';
export { SingleSmsParser } from './SingleSmsParser';
export { StandardFormatParser } from './StandardFormatParser';
