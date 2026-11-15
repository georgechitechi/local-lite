import type {
  PaymentInitiateInput,
  PaymentInitiateResult,
  PaymentProviderAdapter,
  PaymentWebhookResult,
} from './types.js';

function toBase64(value: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64');
  }
  if (typeof btoa === 'function') {
    return btoa(value);
  }
  throw new Error('No base64 encoder available in this runtime.');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacHex(
  algorithm: 'SHA-256' | 'SHA-512',
  secret: string,
  payload: string,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto subtle API is required for webhook verification.');
  }
  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const sig = await subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function formatKenyanPhone(phone: string | number): string {
  if (!phone) return '';
  const cleaned = String(phone).replace(/[^\d]/g, '');
  if (cleaned.startsWith('254')) return cleaned;
  if (cleaned.startsWith('0')) return `254${cleaned.slice(1)}`;
  if (cleaned.length === 9) return `254${cleaned}`;
  return cleaned;
}

export interface ManualPaymentAdapterOptions {
  id?: string;
  label?: string;
  description?: string;
  supportedCurrencies?: string[] | '*';
}

/**
 * Offline-capable manual payment adapter (cash, bank transfer, cheque, etc.).
 */
export function createManualPaymentAdapter(
  options: ManualPaymentAdapterOptions = {},
): PaymentProviderAdapter {
  const id = options.id ?? 'manual';
  return {
    id,
    label: options.label ?? 'Manual / Offline Payment',
    description:
      options.description ??
      'Record cash, bank transfer, or external payment offline.',
    supportedCurrencies: options.supportedCurrencies ?? '*',
    supportedCountries: '*',
    requiresOnline: false,
    async initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
      return {
        success: true,
        status: 'completed',
        provider: id,
        actionId: input.actionId,
        providerRef: input.actionId,
        customerMessage: 'Recorded locally.',
      };
    },
  };
}

export interface DarajaAdapterOptions {
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackUrl: string;
  env?: 'sandbox' | 'live' | 'production';
  apiUrl?: string;
  partyB?: string;
  transactionType?: string;
  fetch?: typeof fetch;
}

/**
 * Safaricom M-Pesa Daraja STK Push adapter (Kenya / KES).
 */
export function createDarajaAdapter(
  options: DarajaAdapterOptions,
): PaymentProviderAdapter {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = (
    options.apiUrl?.trim() ||
    (options.env === 'live' || options.env === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke')
  ).replace(/\/+$/, '');

  return {
    id: 'daraja',
    label: 'M-Pesa (Safaricom Daraja)',
    description: 'Instant STK Push prompt to a Kenyan M-Pesa number.',
    supportedCurrencies: ['KES'],
    supportedCountries: ['KE'],
    requiresOnline: true,
    async initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
      const phone = formatKenyanPhone(input.phone ?? '');
      if (!/^254\d{9}$/.test(phone)) {
        throw new Error('Valid Kenyan phone number (254XXXXXXXXX) is required.');
      }
      const amount = Math.round(input.amount);
      if (!Number.isInteger(amount) || amount < 1 || amount > 250000) {
        throw new Error('M-Pesa amount must be an integer between 1 and 250000.');
      }
      const callbackUrl = (input.callbackUrl ?? options.callbackUrl).trim();
      if (!callbackUrl.startsWith('https://')) {
        throw new Error('Daraja callbackUrl must use HTTPS.');
      }

      const authHeader = `Basic ${toBase64(
        `${options.consumerKey}:${options.consumerSecret}`,
      )}`;
      const oauthRes = await fetchImpl(
        `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        {
          method: 'GET',
          headers: { Authorization: authHeader },
        },
      );
      if (!oauthRes.ok) {
        const text = await oauthRes.text();
        throw new Error(`Daraja OAuth failed (${oauthRes.status}): ${text}`);
      }
      const oauthJson: any = await oauthRes.json();
      const accessToken = oauthJson?.access_token;
      if (!accessToken) {
        throw new Error('Daraja OAuth did not return an access_token.');
      }

      const timestamp = new Date(Date.now() + 3 * 3600000)
        .toISOString()
        .replace(/[-:TZ.]/g, '')
        .slice(0, 14);
      const password = toBase64(
        `${options.shortcode}${options.passkey}${timestamp}`,
      );

      const stkRes = await fetchImpl(
        `${baseUrl}/mpesa/stkpush/v1/processrequest`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            BusinessShortCode: options.shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType:
              options.transactionType?.trim() || 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: phone,
            PartyB: options.partyB?.trim() || options.shortcode,
            PhoneNumber: phone,
            CallBackURL: callbackUrl,
            AccountReference: (input.contractId || input.actionId).slice(0, 12),
            TransactionDesc: input.description || 'Payment',
          }),
        },
      );

      const data: any = await stkRes.json();
      if (
        !stkRes.ok ||
        data?.ResponseCode !== '0' ||
        !data?.CheckoutRequestID ||
        !data?.MerchantRequestID
      ) {
        throw new Error(
          data?.errorMessage ||
            data?.ResponseDescription ||
            'Daraja did not confirm payment initiation.',
        );
      }

      return {
        success: true,
        status: 'pending',
        provider: 'daraja',
        actionId: input.actionId,
        providerRef: data.CheckoutRequestID,
        merchantRequestId: data.MerchantRequestID,
        customerMessage: data.CustomerMessage || '',
        raw: data,
      };
    },
    async verifyWebhook(request: Request): Promise<PaymentWebhookResult> {
      const payload: any = await request.json();
      const callback = payload?.Body?.stkCallback;
      if (!callback || !Number.isInteger(callback.ResultCode)) {
        return {
          verified: false,
          status: 'failed',
          error: 'Invalid Daraja callback payload.',
          rawPayload: payload,
        };
      }

      if (callback.ResultCode !== 0) {
        return {
          verified: true,
          providerRef: callback.CheckoutRequestID,
          merchantRequestId: callback.MerchantRequestID,
          status: 'failed',
          error: String(callback.ResultDesc || 'Payment failed'),
          rawPayload: callback,
        };
      }

      const items = callback.CallbackMetadata?.Item;
      if (!Array.isArray(items)) {
        return {
          verified: false,
          providerRef: callback.CheckoutRequestID,
          merchantRequestId: callback.MerchantRequestID,
          status: 'failed',
          error: 'Missing Daraja callback metadata.',
          rawPayload: callback,
        };
      }

      const readItem = (name: string) =>
        items.find((entry: any) => entry?.Name === name)?.Value;
      const receipt = readItem('MpesaReceiptNumber');
      const amount = Number(readItem('Amount'));
      const phone = String(readItem('PhoneNumber') ?? '');

      if (typeof receipt !== 'string' || !receipt || !Number.isFinite(amount)) {
        return {
          verified: false,
          providerRef: callback.CheckoutRequestID,
          merchantRequestId: callback.MerchantRequestID,
          status: 'failed',
          error: 'Incomplete Daraja callback metadata.',
          rawPayload: callback,
        };
      }

      return {
        verified: true,
        providerRef: callback.CheckoutRequestID,
        merchantRequestId: callback.MerchantRequestID,
        receiptNumber: receipt,
        amount,
        currency: 'KES',
        phone,
        status: 'completed',
        rawPayload: callback,
      };
    },
  };
}

export interface PaystackAdapterOptions {
  secretKey: string;
  supportedCurrencies?: string[];
  supportedCountries?: string[] | '*';
  fetch?: typeof fetch;
}

/**
 * Paystack Checkout adapter (NGN, GHS, ZAR, KES, USD, etc.).
 */
export function createPaystackAdapter(
  options: PaystackAdapterOptions,
): PaymentProviderAdapter {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    id: 'paystack',
    label: 'Paystack (Card / Bank / Mobile Money)',
    description: 'Hosted checkout for cards, bank transfers, and mobile money.',
    supportedCurrencies: options.supportedCurrencies ?? [
      'NGN',
      'GHS',
      'ZAR',
      'KES',
      'USD',
    ],
    supportedCountries: options.supportedCountries ?? '*',
    requiresOnline: true,
    async initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
      if (!input.email) {
        throw new Error('Customer email is required for Paystack payments.');
      }
      const res = await fetchImpl(
        'https://api.paystack.co/transaction/initialize',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.secretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: input.email,
            amount: Math.round(input.amount * 100),
            currency: input.currency,
            reference: input.actionId,
            callback_url: input.returnUrl || input.callbackUrl,
            metadata: input.metadata,
          }),
        },
      );
      const data: any = await res.json();
      if (!res.ok || !data?.status || !data?.data?.authorization_url) {
        throw new Error(
          data?.message || 'Paystack did not confirm payment initialization.',
        );
      }
      return {
        success: true,
        status: 'pending',
        provider: 'paystack',
        actionId: input.actionId,
        providerRef: data.data.reference || input.actionId,
        checkoutUrl: data.data.authorization_url,
        raw: data,
      };
    },
    async verifyWebhook(request: Request, context?: { rawBody?: string }): Promise<PaymentWebhookResult> {
      const signature = request.headers.get('x-paystack-signature') || '';
      const rawBody = context?.rawBody ?? (await request.text());
      if (!signature || !rawBody) {
        return {
          verified: false,
          status: 'failed',
          error: 'Missing Paystack signature or payload.',
        };
      }
      const expected = await hmacHex('SHA-512', options.secretKey, rawBody);
      if (!timingSafeEqualHex(signature, expected)) {
        return {
          verified: false,
          status: 'failed',
          error: 'Invalid Paystack webhook signature.',
        };
      }
      const event: any = JSON.parse(rawBody);
      const data = event?.data || {};
      const eventName = String(event?.event || '');
      if (eventName === 'charge.success') {
        return {
          verified: true,
          actionId: data.reference,
          providerRef: data.reference,
          receiptNumber: String(data.id || data.reference || ''),
          amount:
            typeof data.amount === 'number' ? data.amount / 100 : undefined,
          currency: data.currency ? String(data.currency).toUpperCase() : undefined,
          status: 'completed',
          rawPayload: event,
        };
      }
      if (eventName === 'charge.failed') {
        return {
          verified: true,
          actionId: data.reference,
          providerRef: data.reference,
          status: 'failed',
          error: String(data.gateway_response || 'Paystack charge failed.'),
          rawPayload: event,
        };
      }
      return {
        verified: true,
        actionId: data.reference,
        providerRef: data.reference,
        status: 'pending',
        rawPayload: event,
      };
    },
  };
}

export interface StripeCheckoutAdapterOptions {
  secretKey: string;
  webhookSecret?: string;
  supportedCurrencies?: string[] | '*';
  supportedCountries?: string[] | '*';
  fetch?: typeof fetch;
}

/**
 * Stripe Checkout Session adapter for global card/wallet/bank payments.
 */
export function createStripeCheckoutAdapter(
  options: StripeCheckoutAdapterOptions,
): PaymentProviderAdapter {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    id: 'stripe',
    label: 'Stripe (Card / Apple Pay / Google Pay)',
    description: 'Global card and digital wallet checkout via Stripe.',
    supportedCurrencies: options.supportedCurrencies ?? '*',
    supportedCountries: options.supportedCountries ?? '*',
    requiresOnline: true,
    async initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
      if (!input.returnUrl) {
        throw new Error('returnUrl is required for Stripe Checkout sessions.');
      }
      const params = new URLSearchParams({
        mode: 'payment',
        success_url: input.returnUrl,
        cancel_url: input.returnUrl,
        client_reference_id: input.actionId,
        'line_items[0][price_data][currency]': input.currency.toLowerCase(),
        'line_items[0][price_data][product_data][name]':
          input.description || 'Payment',
        'line_items[0][price_data][unit_amount]': String(
          Math.round(input.amount * 100),
        ),
        'line_items[0][quantity]': '1',
      });
      if (input.email) {
        params.set('customer_email', input.email);
      }

      const res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const data: any = await res.json();
      if (!res.ok || !data?.id || !data?.url) {
        throw new Error(
          data?.error?.message || 'Stripe did not create a checkout session.',
        );
      }
      return {
        success: true,
        status: 'pending',
        provider: 'stripe',
        actionId: input.actionId,
        providerRef: data.id,
        checkoutUrl: data.url,
        raw: data,
      };
    },
    async verifyWebhook(request: Request, context?: { rawBody?: string }): Promise<PaymentWebhookResult> {
      if (!options.webhookSecret) {
        return {
          verified: false,
          status: 'failed',
          error: 'Stripe webhookSecret is not configured.',
        };
      }
      const header = request.headers.get('stripe-signature') || '';
      const rawBody = context?.rawBody ?? (await request.text());
      const parts = Object.fromEntries(
        header.split(',').map((part) => {
          const [k, v] = part.split('=');
          return [k?.trim(), v?.trim()];
        }),
      );
      const timestamp = parts.t;
      const v1 = parts.v1;
      if (!timestamp || !v1 || !rawBody) {
        return {
          verified: false,
          status: 'failed',
          error: 'Missing Stripe signature or payload.',
        };
      }
      const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
      if (!Number.isFinite(ageSeconds) || ageSeconds > 300) {
        return {
          verified: false,
          status: 'failed',
          error: 'Stripe webhook timestamp is outside tolerance.',
        };
      }
      const expected = await hmacHex(
        'SHA-256',
        options.webhookSecret,
        `${timestamp}.${rawBody}`,
      );
      if (!timingSafeEqualHex(v1, expected)) {
        return {
          verified: false,
          status: 'failed',
          error: 'Invalid Stripe webhook signature.',
        };
      }

      const event: any = JSON.parse(rawBody);
      const session = event?.data?.object || {};
      const eventType = String(event?.type || '');
      if (
        eventType === 'checkout.session.completed' ||
        eventType === 'checkout.session.async_payment_succeeded'
      ) {
        return {
          verified: true,
          actionId: session.client_reference_id,
          providerRef: session.id,
          receiptNumber: String(session.payment_intent || session.id || ''),
          amount:
            typeof session.amount_total === 'number'
              ? session.amount_total / 100
              : undefined,
          currency: session.currency
            ? String(session.currency).toUpperCase()
            : undefined,
          status: 'completed',
          rawPayload: event,
        };
      }
      if (
        eventType === 'checkout.session.expired' ||
        eventType === 'checkout.session.async_payment_failed'
      ) {
        return {
          verified: true,
          actionId: session.client_reference_id,
          providerRef: session.id,
          status: 'failed',
          error: 'Stripe checkout failed or expired.',
          rawPayload: event,
        };
      }
      return {
        verified: true,
        actionId: session.client_reference_id,
        providerRef: session.id,
        status: 'pending',
        rawPayload: event,
      };
    },
  };
}
