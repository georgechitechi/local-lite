import {
  calculateReceiptTargetRent,
  formatPaymentMethod,
  formatPaymentType,
  formatReceiptNumber,
  formatReceiptStatusLabel,
  formatRefundText,
  getAmountAffix,
  getPaymentTypeStyle,
  getReceiptStatusColor,
  getReceiptStatusStyle,
  resolveReceiptWaiverAndRent,
} from '@/features/receipts/utils/receiptHelper';

describe('receiptHelper', () => {
  describe('resolveReceiptWaiverAndRent', () => {
    it('returns contract rent when no contract metadata breaks exist', () => {
      const result = resolveReceiptWaiverAndRent({
        receipt: { amount: 10000, payment_period: { month: 1, year: 2026 } },
        contract: { rent_amount: 10000, metadata: {} },
      });

      expect(result.contractRent).toBe(10000);
      expect(result.targetRent).toBe(10000);
      expect(result.hasWaiver).toBe(false);
      expect(result.waiverType).toBeNull();
      expect(result.status).toBe('paid');
    });

    it('identifies partial waiver when break days exist and full rent is NOT paid', () => {
      const result = resolveReceiptWaiverAndRent({
        receipt: { amount: 7000, payment_period: { month: 1, year: 2026 } },
        contract: {
          rent_amount: 10000,
          metadata: {
            breaks: [
              {
                start_date: '2026-01-10',
                end_date: '2026-01-20',
                is_partial: true,
              },
            ],
          },
        },
      });

      expect(result.hasWaiver).toBe(true);
      expect(result.waiverType).toBe('partial');
      expect(result.targetRent).toBeLessThan(10000);
    });

    it('suppresses partial waiver when the full contract rent is paid', () => {
      const result = resolveReceiptWaiverAndRent({
        receipt: { amount: 10000, payment_period: { month: 1, year: 2026 } },
        contract: {
          rent_amount: 10000,
          metadata: {
            breaks: [
              {
                start_date: '2026-01-10',
                end_date: '2026-01-20',
                is_partial: true,
              },
            ],
          },
        },
      });

      expect(result.hasWaiver).toBe(false);
      expect(result.waiverType).toBeNull();
      expect(result.targetRent).toBe(10000);
    });

    it('suppresses partial waiver when cumulative receipts for the period cover full rent', () => {
      const rawReceipts = [
        {
          contract_id: 'c1',
          payment_period: { month: 1, year: 2026 },
          amount: 6000,
        },
        {
          contract_id: 'c1',
          payment_period: { month: 1, year: 2026 },
          amount: 4000,
        },
      ];

      const result = resolveReceiptWaiverAndRent({
        receipt: {
          contract_id: 'c1',
          amount: 4000,
          payment_period: { month: 1, year: 2026 },
        },
        contract: {
          rent_amount: 10000,
          metadata: {
            breaks: [
              {
                start_date: '2026-01-10',
                end_date: '2026-01-20',
                is_partial: true,
              },
            ],
          },
        },
        rawReceipts,
      });

      expect(result.hasWaiver).toBe(false);
      expect(result.waiverType).toBeNull();
      expect(result.targetRent).toBe(10000);
    });
  });

  describe('formatRefundText', () => {
    it('returns null when refunded amount is zero or negative', () => {
      expect(formatRefundText(0)).toBeNull();
      expect(formatRefundText(null)).toBeNull();
      expect(formatRefundText(-50)).toBeNull();
    });

    it('formats refunded amount with currency and date', () => {
      const text = formatRefundText(500, 'KES', '2026-01-15T00:00:00Z');
      expect(text).toContain('500');
      expect(text).toContain('refunded');
      expect(text).toContain('on');
    });

    it('formats refunded amount without date when not provided', () => {
      const text = formatRefundText(500, 'KES');
      expect(text).toContain('500');
      expect(text).toContain('refunded');
      expect(text).not.toContain('on');
    });
  });

  describe('formatReceiptStatusLabel', () => {
    it('formats status codes correctly', () => {
      expect(formatReceiptStatusLabel('paid')).toBe('Paid');
      expect(formatReceiptStatusLabel('partial')).toBe('Partial');
      expect(formatReceiptStatusLabel('partial_refund')).toBe('Partial Refund');
      expect(formatReceiptStatusLabel('refunded')).toBe('Refunded');
      expect(formatReceiptStatusLabel('unpaid')).toBe('Unpaid');
      expect(formatReceiptStatusLabel('')).toBe('Unknown');
    });
  });

  describe('getReceiptStatusColor & getReceiptStatusStyle', () => {
    const mockColors = {
      success: '#00ff00',
      warning: '#ffaa00',
      error: '#ff0000',
      onSurfaceVariant: '#888888',
    };

    it('returns the right color for status', () => {
      expect(getReceiptStatusColor('paid', mockColors)).toBe('#00ff00');
      expect(getReceiptStatusColor('partial', mockColors)).toBe('#ffaa00');
      expect(getReceiptStatusColor('refunded', mockColors)).toBe('#ff0000');
      expect(getReceiptStatusColor('unknown', mockColors)).toBe('#888888');
    });

    it('returns status chip style with icon and color', () => {
      const style = getReceiptStatusStyle('paid', mockColors);
      expect(style.icon).toBe('check-circle');
      expect(style.color).toBe('#00ff00');
    });

    it('returns payment type style with icon and theme colors', () => {
      const style = getPaymentTypeStyle('rent', mockColors);
      expect(style.icon).toBe('home');
      expect(style.color).toBe('#00ff00');
    });
  });

  describe('string formatters', () => {
    it('formats payment type', () => {
      expect(formatPaymentType('bank_transfer')).toBe('BANK TRANSFER');
      expect(formatPaymentType('')).toBe('UNKNOWN');
    });

    it('formats payment method', () => {
      expect(formatPaymentMethod('mpesa_till')).toBe('MPESA TILL');
      expect(formatPaymentMethod('')).toBe('UNKNOWN');
    });

    it('formats receipt number to first 8 uppercase characters', () => {
      expect(formatReceiptNumber('abcdef1234567890')).toBe('ABCDEF12');
      expect(formatReceiptNumber('')).toBe('');
    });
  });

  describe('getAmountAffix', () => {
    const mockCurrency = { symbol: '$', code: 'USD', name: 'US Dollar', default: true };

    it('returns null if expected amount is 0 or negative', () => {
      expect(getAmountAffix(5000, 0, mockCurrency)).toBeNull();
      expect(getAmountAffix(5000, -100, mockCurrency)).toBeNull();
    });

    it('labels underpayment as Remaining: ... and sets error color', () => {
      const result = getAmountAffix(4000, 10000, mockCurrency);
      expect(result).toEqual({
        text: 'Remaining: US$6,000',
        color: 'error',
      });
    });

    it('handles comma formatted input strings correctly', () => {
      const result = getAmountAffix('4,000', 10000, mockCurrency);
      expect(result).toEqual({
        text: 'Remaining: US$6,000',
        color: 'error',
      });
    });

    it('labels exact amount as Paid in full with success color', () => {
      const result = getAmountAffix(10000, 10000, mockCurrency);
      expect(result).toEqual({
        text: 'Paid in full',
        color: 'success',
      });
    });

    it('labels overpayment as Overpaid by: ... with success color', () => {
      const result = getAmountAffix(12000, 10000, mockCurrency);
      expect(result).toEqual({
        text: 'Overpaid by: US$2,000',
        color: 'success',
      });
    });
  });

  describe('calculateReceiptTargetRent', () => {
    it('returns zero rent and false waiver when contract is null', () => {
      const result = calculateReceiptTargetRent(null, 1, 2026);
      expect(result).toEqual({ effectiveRentAmount: 0, isRentWaived: false });
    });

    it('returns deposit amount and false waiver when type is deposit', () => {
      const result = calculateReceiptTargetRent(
        { rent_amount: 10000, deposit_amount: 15000 },
        1,
        2026,
        'deposit',
      );
      expect(result).toEqual({ effectiveRentAmount: 15000, isRentWaived: false });
    });

    it('returns 0 and false waiver when type is others', () => {
      const result = calculateReceiptTargetRent(
        { rent_amount: 10000 },
        1,
        2026,
        'others',
      );
      expect(result).toEqual({ effectiveRentAmount: 0, isRentWaived: false });
    });

    it('returns normal rent and false waiver when contract has no breaks', () => {
      const result = calculateReceiptTargetRent(
        { rent_amount: 10000, metadata: {} },
        1,
        2026,
        'rent',
      );
      expect(result).toEqual({ effectiveRentAmount: 10000, isRentWaived: false });
    });

    it('identifies full waiver when break covers full month and sets isRentWaived to true', () => {
      const result = calculateReceiptTargetRent(
        {
          rent_amount: 10000,
          metadata: {
            breaks: [
              {
                start_date: '2026-01-01',
                end_date: '2026-01-31',
                is_partial: false,
              },
            ],
          },
        },
        1,
        2026,
        'rent',
      );
      expect(result).toEqual({ effectiveRentAmount: 0, isRentWaived: true });
    });

    it('returns prorated rent and false isRentWaived for partial break', () => {
      const result = calculateReceiptTargetRent(
        {
          rent_amount: 10000,
          metadata: {
            breaks: [
              {
                start_date: '2026-01-10',
                end_date: '2026-01-20',
                is_partial: true,
              },
            ],
          },
        },
        1,
        2026,
        'rent',
      );
      expect(result.effectiveRentAmount).toBeLessThan(10000);
      expect(result.effectiveRentAmount).toBeGreaterThan(0);
      expect(result.isRentWaived).toBe(false);
    });

    it('returns false waiver when contract rent is 0 without breaks', () => {
      const result = calculateReceiptTargetRent(
        { rent_amount: 0, metadata: {} },
        1,
        2026,
        'rent',
      );
      expect(result).toEqual({ effectiveRentAmount: 0, isRentWaived: false });
    });
  });
});
