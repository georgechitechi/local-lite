import {
  formatImportedNote,
  formatStandardMessage,
  smartParseDate,
  transformBankMessage,
} from '@/shared/utils/messageFormatter';

describe('messageFormatter Utility', () => {
  describe('smartParseDate', () => {
    it('returns null for empty or null strings', () => {
      expect(smartParseDate('')).toBeNull();
      expect(smartParseDate(null as any)).toBeNull();
      expect(smartParseDate(undefined as any)).toBeNull();
    });

    it('parses DD/MM/YYYY and DD-MM-YYYY formats', () => {
      const d1 = smartParseDate('15/05/2024');
      expect(d1).not.toBeNull();
      expect(d1?.getFullYear()).toBe(2024);
      expect(d1?.getMonth()).toBe(4); // May = 4
      expect(d1?.getDate()).toBe(15);

      const d2 = smartParseDate('01-12-2023');
      expect(d2).not.toBeNull();
      expect(d2?.getFullYear()).toBe(2023);
      expect(d2?.getMonth()).toBe(11); // Dec = 11
      expect(d2?.getDate()).toBe(1);
    });

    it('parses YYYY-MM-DD ISO format', () => {
      const d = smartParseDate('2024-03-25');
      expect(d).not.toBeNull();
      expect(d?.getFullYear()).toBe(2024);
      expect(d?.getMonth()).toBe(2); // Mar = 2
      expect(d?.getDate()).toBe(25);
    });

    it('parses DD Month YYYY format with 4-digit and 2-digit years', () => {
      const d1 = smartParseDate('18 Oct 2024');
      expect(d1).not.toBeNull();
      expect(d1?.getFullYear()).toBe(2024);
      expect(d1?.getMonth()).toBe(9); // Oct = 9
      expect(d1?.getDate()).toBe(18);

      const d2 = smartParseDate('5 Jan 25');
      expect(d2).not.toBeNull();
      expect(d2?.getFullYear()).toBe(2025);
      expect(d2?.getMonth()).toBe(0); // Jan = 0
      expect(d2?.getDate()).toBe(5);
    });

    it('falls back to standard Date constructor or returns null if invalid', () => {
      const d = smartParseDate('2024-05-10T12:00:00Z');
      expect(d).not.toBeNull();
      expect(d?.getTime()).not.toBeNaN();

      const invalid = smartParseDate('Not a date string at all');
      expect(invalid).toBeNull();
    });
  });

  describe('formatImportedNote', () => {
    it('returns messageContent if notes is empty', () => {
      expect(formatImportedNote('', 'Original SMS content')).toBe('Original SMS content');
    });

    it('appends messageContent with divider if notes is present', () => {
      const result = formatImportedNote(
        'Tenant requested receipt',
        'Original SMS content',
      );
      expect(result).toBe('Tenant requested receipt\n\n------\nOriginal SMS content');
    });
  });

  describe('formatStandardMessage', () => {
    it('formats message with number amount and YYYY-MM-DD date', () => {
      const msg = formatStandardMessage({
        amount: 5000,
        name: 'Jane Doe',
        phone: '0712345678',
        ref: 'QA12BC3456',
        date: '2024-05-15',
      });

      expect(msg).toBe(
        'Confirmed. KES. 5000.00 from Jane Doe Phone No. 0712345678 received via M-Pesa Ref. QA12BC3456 on 15-05-2024. Thank you.',
      );
    });

    it('formats message with string amount, custom currency, and preserves DD-MM-YYYY date', () => {
      const msg = formatStandardMessage({
        amount: '12,500',
        name: 'John Smith',
        phone: '254700000000',
        ref: 'RB99XX1122',
        date: '20-04-2024',
        currency: 'USD',
      });

      expect(msg).toBe(
        'Confirmed. USD. 12,500 from John Smith Phone No. 254700000000 received via M-Pesa Ref. RB99XX1122 on 20-04-2024. Thank you.',
      );
    });
  });

  describe('transformBankMessage', () => {
    it('delegates to SingleSmsParser and transforms bank SMS into standard format', () => {
      const rawBankSms =
        'Dear Customer, your Ac/XXXX1234 has been credited with KES 15,000.00 on 12-05-2024 by Jane Kamau 0711223344 Ref: BK12345678.';
      const transformed = transformBankMessage(rawBankSms);
      expect(transformed).toContain('Confirmed.');
      expect(transformed).toContain('15,000');
      expect(transformed).toContain('0711223344');
    });
  });
});
