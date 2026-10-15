import {
  checkExpenseDuplicate,
  EXPENSE_CATEGORY,
  extractTokenNumber,
  extractTransactionRef,
  getCategoryDetails,
  normalizeToken,
} from '@/features/expenses/utils/expenseUtils';

describe('expenseUtils Utility', () => {
  describe('EXPENSE_CATEGORY and getCategoryDetails', () => {
    it('has default expense categories', () => {
      expect(EXPENSE_CATEGORY).toHaveLength(3);
      expect(EXPENSE_CATEGORY.map(c => c.key)).toEqual([
        'Utilities',
        'Maintenance',
        'Other',
      ]);
    });

    it('returns category details for a valid key', () => {
      const util = getCategoryDetails('Utilities');
      expect(util.key).toBe('Utilities');
      expect(util.label).toBe('Utilities');
      expect(util.icon).toBe('flash');

      const maint = getCategoryDetails('Maintenance');
      expect(maint.key).toBe('Maintenance');
    });

    it('falls back to the last category (Other) when key is unknown', () => {
      const fallback = getCategoryDetails('NonExistentKey');
      expect(fallback.key).toBe('Other');

      const emptyFallback = getCategoryDetails('');
      expect(emptyFallback.key).toBe('Other');
    });
  });

  describe('normalizeToken', () => {
    it('strips all non-digit characters', () => {
      expect(normalizeToken('1234-5678-9012-3456')).toBe('1234567890123456');
      expect(normalizeToken('1234 5678 9012 3456 7890')).toBe('12345678901234567890');
      expect(normalizeToken('Token # 4567abc89')).toBe('456789');
    });
  });

  describe('extractTokenNumber', () => {
    it('returns null for empty or null text', () => {
      expect(extractTokenNumber(null)).toBeNull();
      expect(extractTokenNumber(undefined)).toBeNull();
      expect(extractTokenNumber('')).toBeNull();
    });

    it('extracts token with explicit prefix (token, tkn)', () => {
      expect(extractTokenNumber('Token: 1234-5678-9012-3456-7890')).toBe(
        '12345678901234567890',
      );
      expect(extractTokenNumber('Tkn# 12345678901')).toBe('12345678901');
      expect(extractTokenNumber('Token - 1234 5678 9012 3456')).toBe('1234567890123456');
    });

    it('ignores explicit prefix if length is outside 11-20 digits', () => {
      // 5 digits is too short for a power token
      expect(extractTokenNumber('Token: 12345')).toBeNull();
      // 25 continuous digits
      expect(extractTokenNumber('Token: 1234567890123456789012345')).toBeNull();
    });

    it('extracts standard 20-digit token numbers without prefix', () => {
      expect(extractTokenNumber('KPLC token 1234 5678 9012 3456 7890')).toBe(
        '12345678901234567890',
      );
      expect(extractTokenNumber('Tokens: 1234-5678-9012-3456-7890 recorded')).toBe(
        '12345678901234567890',
      );
      expect(extractTokenNumber('12345678901234567890')).toBe('12345678901234567890');
    });

    it('extracts standard 16-digit token numbers without prefix', () => {
      expect(extractTokenNumber('Account meter 1234 5678 9012 3456 done')).toBe(
        '1234567890123456',
      );
      expect(extractTokenNumber('1234-5678-9012-3456')).toBe('1234567890123456');
      expect(extractTokenNumber('1234567890123456')).toBe('1234567890123456');
    });

    it('returns null when text contains ordinary numbers', () => {
      expect(extractTokenNumber('Paid Ksh 500 on 2024-01-01')).toBeNull();
    });
  });

  describe('extractTransactionRef', () => {
    it('returns null for empty or null text', () => {
      expect(extractTransactionRef(null)).toBeNull();
      expect(extractTransactionRef(undefined)).toBeNull();
      expect(extractTransactionRef('')).toBeNull();
    });

    it('extracts explicit transaction ref with prefixes (ref, receipt, code, trn, tx)', () => {
      expect(extractTransactionRef('Ref: QA12BC3456')).toBe('QA12BC3456');
      expect(extractTransactionRef('Receipt # QA12BC3456')).toBe('QA12BC3456');
      expect(extractTransactionRef('trn: TX99887766')).toBe('TX99887766');
      expect(extractTransactionRef('tx# QA12BC3456')).toBe('QA12BC3456');
      expect(extractTransactionRef('Code: 12345678')).toBe('12345678');
    });

    it('extracts standard Kenyan M-Pesa 10-char alphanumeric code', () => {
      const msg = 'Confirmed. Ksh 2,500 paid to KPLC. QA12BC3456 on 15/03/24.';
      expect(extractTransactionRef(msg)).toBe('QA12BC3456');
    });

    it('returns null if no matching transaction reference exists', () => {
      expect(extractTransactionRef('Repaired bathroom sink today')).toBeNull();
    });
  });

  describe('checkExpenseDuplicate', () => {
    const existingList = [
      {
        id: 'exp-1',
        amount: 1500,
        category: 'Utilities',
        date: '2024-05-10',
        remarks: 'Token: 1234 5678 9012 3456 7890 for Unit 4',
        deleted: false,
      },
      {
        id: 'exp-2',
        amount: 3000,
        category: 'Maintenance',
        date: '2024-05-12',
        remarks: 'Plumbing repair Ref: QA12BC3456 paid via M-Pesa',
        deleted: false,
      },
      {
        id: 'exp-3',
        amount: 800,
        category: 'Other',
        date: '2024-05-15',
        remarks: 'Cleaning supplies',
        deleted: false,
      },
      {
        id: 'exp-deleted',
        amount: 1500,
        category: 'Utilities',
        date: '2024-05-10',
        remarks: 'Token: 9999 8888 7777 6666 5555',
        deleted: true,
      },
    ];

    it('returns false if existing expenses list is null, empty or not an array', () => {
      expect(checkExpenseDuplicate({ amount: 1000 }, null as any)).toEqual({
        isDuplicate: false,
      });
      expect(checkExpenseDuplicate({ amount: 1000 }, [] as any)).toEqual({
        isDuplicate: false,
      });
    });

    it('ignores deleted expenses and the candidate itself (same id)', () => {
      // Matches deleted expense token
      const resDeleted = checkExpenseDuplicate(
        {
          id: 'new-1',
          amount: 1500,
          remarks: 'Token: 9999 8888 7777 6666 5555',
        },
        existingList,
      );
      expect(resDeleted.isDuplicate).toBe(false);

      // Editing exp-1 should not report duplicate against itself
      const resSelf = checkExpenseDuplicate(
        {
          id: 'exp-1',
          amount: 1500,
          remarks: 'Token: 1234 5678 9012 3456 7890',
        },
        existingList,
      );
      expect(resSelf.isDuplicate).toBe(false);
    });

    it('detects duplicate token with formatted message', () => {
      const result = checkExpenseDuplicate(
        {
          id: 'new-exp',
          amount: 1500,
          category: 'Utilities',
          date: '2024-05-11',
          remarks: 'KPLC token 1234-5678-9012-3456-7890',
        },
        existingList,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.type).toBe('token');
      expect(result.existingExpense).toEqual(existingList[0]);
      expect(result.message).toContain('1234-5678-9012-3456-7890');
      expect(result.message).toContain('already recorded');
    });

    it('detects duplicate transaction reference', () => {
      const result = checkExpenseDuplicate(
        {
          id: 'new-exp',
          amount: 3000,
          category: 'Maintenance',
          date: '2024-05-12',
          remarks: 'M-Pesa payment Ref: QA12BC3456',
        },
        existingList,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.type).toBe('reference');
      expect(result.existingExpense).toEqual(existingList[1]);
      expect(result.message).toContain('QA12BC3456');
    });

    it('detects exact match (same category, date, amount, and remarks)', () => {
      const result = checkExpenseDuplicate(
        {
          id: 'new-exp',
          amount: 800,
          category: 'Other',
          date: '2024-05-15',
          remarks: 'Cleaning supplies',
        },
        existingList,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.type).toBe('exact_match');
      expect(result.existingExpense).toEqual(existingList[2]);
    });

    it('detects exact match when both remarks are empty', () => {
      const listWithEmptyRemarks = [
        {
          id: 'exp-empty',
          amount: 500,
          category: 'Utilities',
          date: '2024-05-20',
          remarks: '',
          deleted: false,
        },
      ];

      const result = checkExpenseDuplicate(
        {
          id: 'new-exp',
          amount: 500,
          category: 'Utilities',
          date: '2024-05-20',
          remarks: '',
        },
        listWithEmptyRemarks,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.type).toBe('exact_match');
    });

    it('does not flag as duplicate if amount or date or category differs', () => {
      // Different amount
      const diffAmount = checkExpenseDuplicate(
        {
          id: 'new-exp',
          amount: 900,
          category: 'Other',
          date: '2024-05-15',
          remarks: 'Cleaning supplies',
        },
        existingList,
      );
      expect(diffAmount.isDuplicate).toBe(false);

      // Different date
      const diffDate = checkExpenseDuplicate(
        {
          id: 'new-exp',
          amount: 800,
          category: 'Other',
          date: '2024-05-16',
          remarks: 'Cleaning supplies',
        },
        existingList,
      );
      expect(diffDate.isDuplicate).toBe(false);

      // Different category
      const diffCategory = checkExpenseDuplicate(
        {
          id: 'new-exp',
          amount: 800,
          category: 'Maintenance',
          date: '2024-05-15',
          remarks: 'Cleaning supplies',
        },
        existingList,
      );
      expect(diffCategory.isDuplicate).toBe(false);

      // Different remarks
      const diffRemarks = checkExpenseDuplicate(
        {
          id: 'new-exp',
          amount: 800,
          category: 'Other',
          date: '2024-05-15',
          remarks: 'Different repair items',
        },
        existingList,
      );
      expect(diffRemarks.isDuplicate).toBe(false);
    });

    it('does not trigger exact match if amount is 0 or negative', () => {
      const list = [
        {
          id: 'exp-zero',
          amount: 0,
          category: 'Other',
          date: '2024-05-15',
          remarks: 'test',
        },
      ];

      const res = checkExpenseDuplicate(
        {
          id: 'new-exp',
          amount: 0,
          category: 'Other',
          date: '2024-05-15',
          remarks: 'test',
        },
        list,
      );
      expect(res.isDuplicate).toBe(false);
    });
  });
});
