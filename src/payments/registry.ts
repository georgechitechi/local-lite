import type {
  PaymentContext,
  PaymentInitiateInput,
  PaymentInitiateResult,
  PaymentMethodOption,
  PaymentProviderAdapter,
  PaymentProviderId,
  PaymentRegistryConfig,
} from './types.js';

function normalizeCode(value?: string): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

export interface PaymentRegistry {
  register: (adapter: PaymentProviderAdapter) => void;
  unregister: (id: PaymentProviderId) => boolean;
  configure: (
    config: Pick<PaymentRegistryConfig, 'enabledProviders' | 'defaultCurrency'>,
  ) => void;
  getProvider: (id: PaymentProviderId) => PaymentProviderAdapter | undefined;
  listProviders: () => PaymentProviderAdapter[];
  supports: (id: PaymentProviderId, context?: PaymentContext) => boolean;
  getAvailableOptions: (context?: PaymentContext) => PaymentMethodOption[];
  initiate: (
    input: Omit<PaymentInitiateInput, 'currency'> & { currency?: string },
  ) => Promise<PaymentInitiateResult>;
}

/**
 * Creates a configurable payment provider registry that filters available
 * payment methods by currency, country, online status, and enabled provider list.
 */
export function createPaymentRegistry(
  initialConfig: PaymentRegistryConfig = {},
): PaymentRegistry {
  const providers = new Map<string, PaymentProviderAdapter>();
  let enabledProviders: Set<string> | null = initialConfig.enabledProviders
    ? new Set(initialConfig.enabledProviders)
    : null;
  let defaultCurrency = initialConfig.defaultCurrency
    ? normalizeCode(initialConfig.defaultCurrency)
    : 'USD';

  for (const adapter of initialConfig.providers ?? []) {
    providers.set(adapter.id, adapter);
  }

  function supports(
    id: PaymentProviderId,
    context: PaymentContext = {},
  ): boolean {
    const adapter = providers.get(id);
    if (!adapter) return false;

    const allowedList =
      context.enabledProviders ??
      (enabledProviders ? [...enabledProviders] : null);
    if (allowedList && !allowedList.includes(id)) {
      return false;
    }

    const requiresOnline = adapter.requiresOnline ?? true;
    if (requiresOnline && context.isOnline === false) {
      return false;
    }

    const currency = normalizeCode(context.currency ?? defaultCurrency);
    if (
      currency &&
      adapter.supportedCurrencies !== '*' &&
      !adapter.supportedCurrencies.map(normalizeCode).includes(currency)
    ) {
      return false;
    }

    const country = normalizeCode(context.country);
    if (
      country &&
      adapter.supportedCountries &&
      adapter.supportedCountries !== '*' &&
      !adapter.supportedCountries.map(normalizeCode).includes(country)
    ) {
      return false;
    }

    if (adapter.supports && !adapter.supports(context)) {
      return false;
    }

    return true;
  }

  return {
    register(adapter) {
      providers.set(adapter.id, adapter);
    },
    unregister(id) {
      return providers.delete(id);
    },
    configure(config) {
      if (config.enabledProviders !== undefined) {
        enabledProviders = config.enabledProviders
          ? new Set(config.enabledProviders)
          : null;
      }
      if (config.defaultCurrency !== undefined) {
        defaultCurrency =
          normalizeCode(config.defaultCurrency) || defaultCurrency;
      }
    },
    getProvider(id) {
      return providers.get(id);
    },
    listProviders() {
      return [...providers.values()];
    },
    supports,
    getAvailableOptions(context = {}) {
      return [...providers.values()]
        .filter((adapter) => supports(adapter.id, context))
        .map((adapter) => ({
          id: adapter.id,
          label: adapter.label,
          description: adapter.description,
          supportedCurrencies: adapter.supportedCurrencies,
          supportedCountries: adapter.supportedCountries,
          requiresOnline: adapter.requiresOnline ?? true,
        }));
    },
    async initiate(input) {
      const adapter = providers.get(input.provider);
      if (!adapter) {
        throw new Error(
          `Payment provider "${input.provider}" is not registered.`,
        );
      }
      const currency = normalizeCode(input.currency ?? defaultCurrency);
      if (!currency) {
        throw new Error('Payment currency is required.');
      }
      if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new Error('Payment amount must be greater than zero.');
      }
      if (!input.actionId || typeof input.actionId !== 'string') {
        throw new Error('Payment actionId is required.');
      }
      if (!supports(adapter.id, { currency })) {
        throw new Error(
          `Payment provider "${adapter.id}" does not support currency "${currency}".`,
        );
      }
      return adapter.initiate({
        ...input,
        currency,
      });
    },
  };
}
