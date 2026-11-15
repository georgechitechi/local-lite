export type PaymentProviderId =
  | 'daraja'
  | 'stripe'
  | 'paystack'
  | 'flutterwave'
  | 'manual'
  | (string & {});

export type PaymentStatus =
  | 'initializing'
  | 'pending'
  | 'completed'
  | 'failed'
  | 'unknown';

export interface PaymentContext {
  currency?: string;
  country?: string;
  isOnline?: boolean;
  enabledProviders?: string[];
}

export interface PaymentMethodOption {
  id: PaymentProviderId;
  label: string;
  description?: string;
  supportedCurrencies: string[] | '*';
  supportedCountries?: string[] | '*';
  requiresOnline: boolean;
}

export interface PaymentInitiateInput {
  actionId: string;
  provider: PaymentProviderId;
  amount: number;
  currency: string;
  businessId?: string;
  tenantId?: string;
  contractId?: string;
  userId?: string;
  phone?: string;
  email?: string;
  callbackUrl?: string;
  returnUrl?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentInitiateResult {
  success: boolean;
  status: PaymentStatus;
  provider: PaymentProviderId;
  actionId: string;
  duplicate?: boolean;
  providerRef?: string;
  merchantRequestId?: string;
  checkoutUrl?: string;
  customerMessage?: string;
  raw?: unknown;
}

export interface PaymentWebhookResult {
  verified: boolean;
  actionId?: string;
  providerRef?: string;
  merchantRequestId?: string;
  receiptNumber?: string;
  amount?: number;
  currency?: string;
  phone?: string;
  status: 'completed' | 'failed' | 'pending';
  error?: string;
  rawPayload?: unknown;
}

export interface PaymentProviderAdapter {
  id: PaymentProviderId;
  label: string;
  description?: string;
  supportedCurrencies: string[] | '*';
  supportedCountries?: string[] | '*';
  requiresOnline?: boolean;
  supports?: (context: PaymentContext) => boolean;
  initiate: (input: PaymentInitiateInput) => Promise<PaymentInitiateResult>;
  verifyWebhook?: (
    request: Request,
    context?: { rawBody?: string },
  ) => Promise<PaymentWebhookResult>;
}

export interface PaymentRegistryConfig {
  providers?: PaymentProviderAdapter[];
  enabledProviders?: string[];
  defaultCurrency?: string;
}

export interface PaymentReservationRecord {
  actionId: string;
  provider: PaymentProviderId;
  currency: string;
  amount: number;
  businessId?: string;
  userId?: string;
  tenantId?: string;
  contractId?: string;
  phone?: string;
  email?: string;
  callbackHash?: string;
  providerRef?: string;
  merchantRequestId?: string;
  customerMessage?: string;
  status: PaymentStatus;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PaymentReservationStore {
  findByActionId: (
    actionId: string,
  ) => Promise<PaymentReservationRecord | null>;
  findByCallbackHash?: (
    callbackHash: string,
  ) => Promise<PaymentReservationRecord | null>;
  findByProviderRef?: (
    providerRef: string,
  ) => Promise<PaymentReservationRecord | null>;
  reserve: (record: PaymentReservationRecord) => Promise<void>;
  markPending: (
    actionId: string,
    update: {
      providerRef?: string;
      merchantRequestId?: string;
      customerMessage?: string;
    },
  ) => Promise<void>;
  markFinal: (
    actionId: string,
    status: Extract<PaymentStatus, 'completed' | 'failed' | 'unknown'>,
    error?: string | null,
  ) => Promise<void>;
}
