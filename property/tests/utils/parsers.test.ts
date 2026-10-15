import {
  extractMessageMetadata,
  FallbackParser,
  SafaricomSmsParser,
  SingleSmsParser,
  StandardFormatParser,
} from '@/shared/utils/parsers';
import {
  findCurrencyAmount,
  findMpesaReference,
  findPhoneNumber,
  parseAmount,
} from '@/shared/utils/parsers/helpers';

describe('Message Parsers', () => {
  describe('helpers', () => {
    it('finds currency amounts with preference for first or last match', () => {
      const text =
        'Paid Ksh 1,500.50 with transaction fee of 15.00 and balance of 4,000.00';
      expect(findCurrencyAmount(text, true)).toBe('1,500.50');
      expect(findCurrencyAmount(text, false)).toBe('4,000.00');
      expect(findCurrencyAmount('No amount here')).toBeNull();
    });

    it('extracts various phone number formats', () => {
      expect(findPhoneNumber('Sent from 0712345678 on 2026-01-01')).toBe('0712345678');
      expect(findPhoneNumber('Payment to 254722000000')).toBe('254722000000');
      expect(findPhoneNumber('Masked number 2547******41')).toBe('2547******41');
      expect(findPhoneNumber('No phone here')).toBeNull();
    });

    it('identifies M-Pesa references', () => {
      expect(findMpesaReference('Transaction ID: UGIA7BIP5V')).toBe('UGIA7BIP5V');
      expect(findMpesaReference('Ref QA12BC3456 confirmed')).toBe('QA12BC3456');
      expect(findMpesaReference('Only letters no numbers')).toBeNull();
      expect(findMpesaReference('12345678')).toBeNull();
    });

    it('parses formatted amount strings to numbers', () => {
      expect(parseAmount('1,500.50')).toBe(1500.5);
      expect(parseAmount('2500')).toBe(2500);
      expect(parseAmount('invalid')).toBe(0);
    });
  });

  describe('SafaricomSmsParser', () => {
    const parser = new SafaricomSmsParser();
    const sms =
      'UGIA7BIP5V Confirmed. Ksh2,500.00 received from John Doe 254712345678 on 18/07/26 at 11:32 AM';

    it('detects Safaricom M-Pesa format', () => {
      expect(parser.canParse(sms)).toBe(true);
      expect(parser.canParse('Confirmed. KES 2,500')).toBe(false);
      expect(parser.canParse('Random text')).toBe(false);
    });

    it('extracts all metadata fields from Safaricom SMS', () => {
      const metadata = parser.extract(sms);
      expect(metadata).toEqual({
        ref: 'UGIA7BIP5V',
        amount: '2500.00',
        name: 'John Doe',
        phone: '254712345678',
        date: '18/07/26',
      });
    });

    it('returns null fields on malformed input', () => {
      expect(parser.extract('Invalid text')).toEqual({
        amount: null,
        date: null,
        ref: null,
        name: null,
        phone: null,
      });
    });
  });

  describe('StandardFormatParser', () => {
    const parser = new StandardFormatParser();
    const standardSms =
      'Confirmed. KES. 4,000.00 from Jane Doe Phone No. 254722334455 received via M-Pesa Ref. UGFHNBMS7L on 15-07-2026. Thank you.';

    it('matches messages starting with Confirmed.', () => {
      expect(parser.canParse(standardSms)).toBe(true);
      expect(parser.canParse('Not confirmed')).toBe(false);
    });

    it('extracts metadata from standard message', () => {
      const metadata = parser.extract(standardSms);
      expect(metadata).toEqual({
        amount: '4000.00',
        name: 'Jane Doe',
        phone: '254722334455',
        ref: 'UGFHNBMS7L',
        date: '15-07-2026',
      });
    });

    it('returns nulls on unparseable format', () => {
      expect(parser.extract('Confirmed. Missing rest')).toEqual({
        amount: null,
        date: null,
        ref: null,
        name: null,
        phone: null,
      });
    });
  });

  describe('FallbackParser', () => {
    const parser = new FallbackParser();

    it('always returns canParse = true', () => {
      expect(parser.canParse()).toBe(true);
    });

    it('extracts metadata using regex heuristics', () => {
      const raw =
        'You have received Ksh 3,200.00 from Bob Smith 0712345678 on 2026-08-10. Ref: QW12ER34TY.';
      const res = parser.extract(raw);

      expect(res.ref).toBe('QW12ER34TY');
      expect(res.amount).toBe('3200.00');
      expect(res.name).toBe('Bob Smith');
      expect(res.date).toBe('2026-08-10');
    });

    it('returns nulls on empty text', () => {
      expect(parser.extract('')).toEqual({
        amount: null,
        date: null,
        ref: null,
        name: null,
        phone: null,
      });
    });
  });

  describe('SingleSmsParser', () => {
    const parser = new SingleSmsParser();

    it('returns input directly if already in standard confirmed format', () => {
      const text = 'Confirmed. KES 1000 from Test';
      expect(parser.parse(text)).toEqual([text]);
    });

    it('parses raw SMS into standard format with overrideDate', () => {
      const raw =
        'UGIA7BIP5V Confirmed. Ksh1,500.00 received from Alex King 0712345678 on 18/07/26 at 10:30 AM';
      const parsed = parser.parse(raw, '2026-09-15');
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toContain('Confirmed.');
      expect(parsed[0]).toContain('1,500.00');
      expect(parsed[0]).toContain('UGIA7BIP5V');
      expect(parsed[0]).toContain('15-09-2026');
    });

    it('returns original input if no amount can be extracted', () => {
      const raw = 'Just a casual text message with no money';
      expect(parser.parse(raw)).toEqual([raw]);
    });
  });

  describe('extractMessageMetadata', () => {
    it('returns all nulls on empty input', () => {
      expect(extractMessageMetadata('')).toEqual({
        amount: null,
        date: null,
        ref: null,
        name: null,
        phone: null,
      });
    });

    it('routes to SafaricomSmsParser when matched', () => {
      const sms =
        'UGIA7BIP5V Confirmed. Ksh2,500.00 received from John Doe 254712345678 on 18/07/26 at 11:32 AM';
      const meta = extractMessageMetadata(sms);
      expect(meta.ref).toBe('UGIA7BIP5V');
      expect(meta.amount).toBe('2500.00');
      expect(meta.name).toBe('John Doe');
    });

    it('routes to StandardFormatParser when matched', () => {
      const sms =
        'Confirmed. KES. 4,000.00 from Jane Doe Phone No. 254722334455 received via M-Pesa Ref. UGFHNBMS7L on 15-07-2026. Thank you.';
      const meta = extractMessageMetadata(sms);
      expect(meta.ref).toBe('UGFHNBMS7L');
      expect(meta.amount).toBe('4000.00');
      expect(meta.name).toBe('Jane Doe');
    });

    it('routes to FallbackParser when no specific parser matches', () => {
      const sms =
        'Transfer of 500.00 received from Alice Walker 0700000000 Ref: XYZ1234567 on 2026-05-01';
      const meta = extractMessageMetadata(sms);
      expect(meta.ref).toBe('XYZ1234567');
      expect(meta.amount).toBe('500.00');
    });
  });
});
