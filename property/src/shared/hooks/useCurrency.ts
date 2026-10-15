import { useMemo } from 'react';
import { type Currency, defaultCurrencies } from '@/shared/utils/formatters';
import { useSettings } from './useStore';

/**
 * Hook to reactively get currency settings from the store
 * Automatically updates when currency settings change
 */
export const useCurrency = (businessId: string | null | undefined) => {
  const settings = useSettings(businessId || undefined);

  const currencies = useMemo(() => {
    if (!businessId || !settings) return null;

    const currencySetting = settings.find(
      (s: any) => s?.setting_key === 'currency_settings',
    );

    let val: any = currencySetting?.setting_value;
    if (typeof val === 'string') {
      try {
        val = JSON.parse(val);
      } catch {}
    }

    if (Array.isArray(val)) {
      return val as unknown as Currency[];
    }

    return null;
  }, [businessId, settings]);

  const defaultCurrency =
    currencies?.find(c => c.default) || currencies?.[0] || defaultCurrencies[0];

  return {
    currencies,
    defaultCurrency,
  };
};
