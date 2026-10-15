import {
  defaultCurrencies,
  formatWithCurrency,
  getDefaultCurrency,
} from '@/shared/utils/formatters';

const mockFindMany = jest.fn();
jest.mock('@/shared/services/sync/client', () => ({
  getSyncClient: jest.fn(async () => ({ findMany: mockFindMany })),
}));
describe('currencyHelper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
  });
  it('returns default without a business', async () => {
    expect(await getDefaultCurrency()).toEqual(defaultCurrencies[0]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
  it('queries the selected business and parses its currency settings', async () => {
    mockFindMany.mockResolvedValue([
      { setting_value: JSON.stringify([{ code: 'EUR', default: true }]) },
    ]);
    expect(await getDefaultCurrency('biz1')).toEqual({ code: 'EUR', default: true });
    expect(mockFindMany).toHaveBeenCalledWith('settings', {
      where: { business_id: 'biz1', setting_key: 'currency_settings' },
    });
  });
  it('ignores deleted settings', async () => {
    mockFindMany.mockResolvedValue([
      { deleted: 1, setting_value: [{ code: 'USD', default: true }] },
    ]);
    expect(await getDefaultCurrency('biz1')).toEqual(defaultCurrencies[0]);
  });
  it('falls back for malformed currency settings', async () => {
    mockFindMany.mockResolvedValue([{ setting_value: 'bad json' }]);
    expect(await getDefaultCurrency('biz1')).toEqual(defaultCurrencies[0]);
  });
  describe('formatWithCurrency', () => {
    it('formats amount with currency correctly', () => {
      const kshCurrency = defaultCurrencies.find(c => c.code === 'KES') as any;
      const formatted = formatWithCurrency(1000, kshCurrency);
      // Depending on Node version, the non-breaking space might vary, so we can just check it contains 1,000 and KES
      expect(formatted.replace(/\s/g, '')).toMatch(/KSh1,000|1,000KSh/i);
    });

    it('falls back to USD if currency code is missing', () => {
      const formatted = formatWithCurrency(500, {
        code: '',
        symbol: '',
        name: '',
        default: false,
      });
      expect(formatted.replace(/\s/g, '')).toMatch(/USD500|\$500/i);
    });

    it('handles invalid currency codes by falling back to USD', () => {
      const formatted = formatWithCurrency(500, {
        code: 'INVALID',
        symbol: '',
        name: '',
        default: false,
      });
      expect(formatted.replace(/\s/g, '')).toMatch(/USD500|\$500/i);
    });
  });
});
