import type { MessageMetadata, MessageParser } from './types';

export class StandardFormatParser implements MessageParser {
  canParse(text: string): boolean {
    return text.trim().toLowerCase().startsWith('confirmed.');
  }

  extract(text: string): MessageMetadata {
    // Expected format:
    // Confirmed. KES. 4,000.00 from Some One Phone No. 2547******07 received via M-Pesa Ref. UGFHNBMS7L on 15-07-2026. Thank you.
    const regex =
      /Confirmed\.\s+(?<currency>[a-zA-Z]+)\.?\s+(?<amount>[\d,.]+)\s+from\s+(?<name>.*?)\s+Phone\s+No\.\s+(?<phone>.*?)\s+received\s+via\s+M-Pesa\s+Ref\.\s+(?<ref>[A-Z0-9]+)\s+on\s+(?<date>[\d-]+)/i;
    const match = text.match(regex);

    if (match?.groups) {
      return {
        amount: match.groups.amount.replace(/,/g, '').trim(),
        name: match.groups.name.trim(),
        phone: match.groups.phone.trim(),
        ref: match.groups.ref.trim(),
        date: match.groups.date.trim(),
      };
    }

    return { amount: null, date: null, ref: null, name: null, phone: null };
  }
}
