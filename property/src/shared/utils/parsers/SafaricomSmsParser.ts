import type { MessageMetadata, MessageParser } from './types';

export class SafaricomSmsParser implements MessageParser {
  canParse(text: string): boolean {
    // Looks for typical Safaricom M-Pesa format: REF Confirmed. Ksh...
    return /^[A-Z0-9]{10}\s+Confirmed\.\s+(?:Ksh|KES)/i.test(text.trim());
  }

  extract(text: string): MessageMetadata {
    // e.g. UGIA7BIP5V Confirmed. Ksh200.00 received from Some One 2547******41 on 18/07/26 at 11:32 AM
    // e.g. UGIA7BIP5V Confirmed. Ksh200.00 sent to Some One 2547******41 on 18/07/26 at 11:32 AM
    const regex =
      /^(?<ref>[A-Z0-9]{10})\s+Confirmed\.\s+(?:Ksh|KES)\s*(?<amount>[\d,.]+)\s+(?:received\s+from|sent\s+to|paid\s+to)\s+(?<name>.*?)\s+(?<phone>\+?\d[\d*\s-]{7,})\s+on\s+(?<date>[\d/.-]+)/i;
    const match = text.trim().match(regex);

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
