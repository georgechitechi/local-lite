import * as helper from '@/shared/utils/helper';

describe('helper.normalizePhoneNumber', () => {
  describe('Falsy values', () => {
    it('returns empty string for null, undefined, or empty string', () => {
      expect(helper.normalizePhoneNumber(null)).toBe('');
      expect(helper.normalizePhoneNumber(undefined)).toBe('');
      expect(helper.normalizePhoneNumber('')).toBe('');
      expect(helper.normalizePhoneNumber('   ')).toBe('');
    });
  });

  describe('Kenyan Numbers (Default Country: KE)', () => {
    it('formats local Kenyan numbers starting with 0', () => {
      expect(helper.normalizePhoneNumber('0712345678')).toBe('+254712345678');
      expect(helper.normalizePhoneNumber('0112345678')).toBe('+254112345678');
    });

    it('formats local Kenyan numbers with spaces or dashes', () => {
      expect(helper.normalizePhoneNumber('0712 345 678')).toBe('+254712345678');
      expect(helper.normalizePhoneNumber('0712-345-678')).toBe('+254712345678');
      expect(helper.normalizePhoneNumber('(0712) 345-678')).toBe('+254712345678');
    });

    it('formats Kenyan numbers starting with 254 (missing +)', () => {
      expect(helper.normalizePhoneNumber('254712345678')).toBe('+254712345678');
    });

    it('returns as is if already correctly formatted in E.164', () => {
      expect(helper.normalizePhoneNumber('+254712345678')).toBe('+254712345678');
      expect(helper.normalizePhoneNumber('+254 712 345 678')).toBe('+254712345678');
    });
  });

  describe('International Numbers', () => {
    it('formats US numbers starting with +1', () => {
      expect(helper.normalizePhoneNumber('+1 555-010-1234')).toBe('+15550101234');
      expect(helper.normalizePhoneNumber('+1 (555) 010-1234')).toBe('+15550101234');
    });

    it('formats UK numbers starting with +44', () => {
      expect(helper.normalizePhoneNumber('+44 7911 123456')).toBe('+447911123456');
    });

    it('formats Australian numbers starting with +61', () => {
      expect(helper.normalizePhoneNumber('+61 400 123 456')).toBe('+61400123456');
    });
  });

  describe('Invalid or Edge Case Numbers (Fallback Logic Removed)', () => {
    it('prepends + to unparseable numbers', () => {
      // libphonenumber-js rejects these.
      // The default behavior now just prepends a plus.
      expect(helper.normalizePhoneNumber('0000')).toBe('+0000');
      expect(helper.normalizePhoneNumber('712345678')).toBe('+254712345678');
      expect(helper.normalizePhoneNumber('254000000000')).toBe('+254000000000');
    });

    it('returns raw cleaned string if nothing matches', () => {
      expect(helper.normalizePhoneNumber('999')).toBe('+999');
      expect(helper.normalizePhoneNumber('abc999def')).toBe('+999');
    });
  });
});

describe('String Formatting Helpers', () => {
  it('properCase', () => {
    expect(helper.properCase('HELLO')).toBe('Hello');
    expect(helper.properCase(null)).toBe('');
  });

  it('toAllCaps', () => {
    expect(helper.toAllCaps('hello')).toBe('HELLO');
    expect(helper.toAllCaps(null)).toBe('');
  });

  it('capitalizeEachWord', () => {
    expect(helper.capitalizeEachWord('hello world')).toBe('Hello World');
    expect(helper.capitalizeEachWord(null)).toBe('');
  });

  it('toLowerCase', () => {
    expect(helper.toLowerCase('HELLO')).toBe('hello');
    expect(helper.toLowerCase(null)).toBe('');
  });

  it('camelCase', () => {
    expect(helper.camelCase('hello-world')).toBe('helloWorld');
    expect(helper.camelCase('hello_world')).toBe('helloWorld');
    expect(helper.camelCase(null)).toBe('');
  });

  it('kebabCase', () => {
    expect(helper.kebabCase('helloWorld')).toBe('hello-world');
    expect(helper.kebabCase('hello World')).toBe('hello-world');
    expect(helper.kebabCase(null)).toBe('');
  });

  it('getInitial', () => {
    expect(helper.getInitial('hello')).toBe('H');
    expect(helper.getInitial(null)).toBe('');
  });

  it('snakeCaseToTitleCase', () => {
    expect(helper.snakeCaseToTitleCase('rent_year')).toBe('Rent Year');
    expect(helper.snakeCaseToTitleCase(null)).toBe('');
  });
});

describe('Other Utility Helpers', () => {
  it('generateUUID', () => {
    expect(helper.generateUUID()).toBeDefined();
    expect(typeof helper.generateUUID()).toBe('string');
  });

  it('getPrimaryNextOfKin', () => {
    expect(helper.getPrimaryNextOfKin(null)).toBeNull();
    expect(helper.getPrimaryNextOfKin([])).toBeNull();
    expect(helper.getPrimaryNextOfKin([{ name: 'John' }])).toEqual({ name: 'John' });
    expect(
      helper.getPrimaryNextOfKin([{ name: 'Jane' }, { name: 'John', is_primary: true }]),
    ).toEqual({ name: 'John', is_primary: true });
  });

  it('extractAmount', () => {
    expect(helper.extractAmount('Ksh 1,200.50')).toBe(1200.5);
    expect(helper.extractAmount('Received 5000 KES')).toBe(5000);
    expect(helper.extractAmount('Amount: 200.00')).toBe(200);
    expect(helper.extractAmount(null)).toBeUndefined();
  });

  it('addOpacity', () => {
    expect(helper.addOpacity('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(helper.addOpacity('rgba(255,0,0,1)', 0.5)).toBe('rgba(255,0,0,0.5)');
    expect(helper.addOpacity('', 0.5)).toBe('rgba(0,0,0,0)');
  });

  it('maskPhoneNumber', () => {
    expect(helper.maskPhoneNumber('254700012340')).toBe('2547000***40');
    expect(helper.maskPhoneNumber('0700123450')).toBe('07001***50');
    expect(helper.maskPhoneNumber(null)).toBe('');
  });

  it('findDuplicateGroups', () => {
    const items = [
      { id: 1, type: 'A' },
      { id: 2, type: 'B' },
      { id: 3, type: 'A' },
    ];
    expect(helper.findDuplicateGroups(items, i => i.type)).toEqual([
      [
        { id: 1, type: 'A' },
        { id: 3, type: 'A' },
      ],
    ]);
  });

  it('calculateEffectiveRent', () => {
    const breaks = [
      { start_date: '2023-01-10', end_date: '2023-01-20', is_partial: true },
    ];
    // Base rent 3100 for Jan (31 days). Daily = 100. Break = 11 days. Active = 20 days.
    const result = helper.calculateEffectiveRent(3100, 1, 2023, breaks);
    expect(result.daysOnBreak).toBe(11);
    expect(result.isOnFullBreak).toBe(false);
  });

  it('calculateEffectiveRent with full break', () => {
    const breaks = [
      { start_date: '2023-01-01', end_date: '2023-01-31', is_partial: false },
    ];
    const result = helper.calculateEffectiveRent(3100, 1, 2023, breaks);
    expect(result.effectiveRent).toBe(0);
    expect(result.isOnFullBreak).toBe(true);
    expect(result.daysOnBreak).toBe(31);
  });

  it('calculateEffectiveRent with overlapping partial breaks', () => {
    const breaks = [
      { start_date: '2023-01-10', end_date: '2023-01-15', is_partial: true },
      { start_date: '2023-01-12', end_date: '2023-01-20', is_partial: true },
    ];
    const result = helper.calculateEffectiveRent(3100, 1, 2023, breaks);
    expect(result.daysOnBreak).toBe(11); // 10th to 20th inclusive
  });
});

describe('Array and Entity Helpers', () => {
  it('filterArrayRef', () => {
    const arr = [1, 2, 3];
    // Keeps all
    const result1 = helper.filterArrayRef(arr, x => x > 0);
    expect(result1).toBe(arr); // Reference equality

    // Filters some
    const result2 = helper.filterArrayRef(arr, x => x > 1);
    expect(result2).not.toBe(arr);
    expect(result2).toEqual([2, 3]);

    expect(helper.filterArrayRef(undefined, (x: number) => x > 0)).toBeUndefined();
  });
});

describe('Amount Formatting Helpers', () => {
  describe('formatAmountsInText', () => {
    it('returns empty string for null, undefined, or empty text', () => {
      expect(helper.formatAmountsInText(null)).toBe('');
      expect(helper.formatAmountsInText(undefined)).toBe('');
      expect(helper.formatAmountsInText('')).toBe('');
    });

    it('formats unformatted 4-digit decimal amount with commas', () => {
      const input = 'You have received 3000.00 KES from TITUS OKEN';
      expect(helper.formatAmountsInText(input)).toBe(
        'You have received 3,000.00 KES from TITUS OKEN',
      );
    });

    it('formats 6-digit and 7-digit unformatted amounts', () => {
      expect(helper.formatAmountsInText('Paid 150000.50 USD')).toBe(
        'Paid 150,000.50 USD',
      );
      expect(helper.formatAmountsInText('Transfer of 1000000.00 KES')).toBe(
        'Transfer of 1,000,000.00 KES',
      );
    });

    it('leaves already formatted numbers with commas unchanged', () => {
      const input = 'You have received 3,000.00 KES from TITUS';
      expect(helper.formatAmountsInText(input)).toBe(input);
    });

    it('does not format amounts below 1000', () => {
      const input = 'Sent 500.00 KES';
      expect(helper.formatAmountsInText(input)).toBe(input);
    });
  });

  describe('hasUnformattedAmount', () => {
    it('returns false for null, undefined, or empty text', () => {
      expect(helper.hasUnformattedAmount(null)).toBe(false);
      expect(helper.hasUnformattedAmount(undefined)).toBe(false);
      expect(helper.hasUnformattedAmount('')).toBe(false);
    });

    it('returns true when text contains unformatted 4+ digit amount with 2 decimals', () => {
      expect(
        helper.hasUnformattedAmount('You have received 3000.00 KES from TITUS'),
      ).toBe(true);
      expect(helper.hasUnformattedAmount('Amount: 125000.00')).toBe(true);
    });

    it('returns false when amounts are already formatted with commas', () => {
      expect(
        helper.hasUnformattedAmount('You have received 3,000.00 KES from TITUS'),
      ).toBe(false);
    });

    it('returns false for amounts under 1000', () => {
      expect(helper.hasUnformattedAmount('Amount: 500.00')).toBe(false);
    });
  });
});
