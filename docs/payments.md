# 💳 Universal Payments (`local-lite/payments`)

`local-lite/payments` provides a region-agnostic payment registry, built-in adapters (`createStripeCheckoutAdapter`, `createPaystackAdapter`, `createManualPaymentAdapter`), a generic `createPaymentAdapter(options)` factory for any custom or regional provider, and turnkey server handlers (`local-lite/payments/server`).

---

## Built-in & Generic Adapters

```typescript
import {
  createManualPaymentAdapter,
  createPaymentAdapter,
  createPaymentRegistry,
  createPaystackAdapter,
  createStripeCheckoutAdapter,
} from 'local-lite/payments';

const registry = createPaymentRegistry({
  providers: [
    createManualPaymentAdapter(),
    createStripeCheckoutAdapter({
      secretKey: process.env.STRIPE_SECRET_KEY!,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    }),
    createPaystackAdapter({
      secretKey: process.env.PAYSTACK_SECRET_KEY!,
    }),
  ],
});
```

### Offline / Custom Providers with `createPaymentAdapter()`

When `initiate` is omitted, `createPaymentAdapter()` creates an offline-capable adapter (`requiresOnline: false`) that records payments locally. Supply `initiate` (and optional `verifyWebhook`) to integrate any online or regional gateway:

```typescript
const cashAdapter = createPaymentAdapter({
  id: 'cash',
  label: 'Cash Payment',
});
```

---

## Custom Regional Example: Safaricom Daraja (M-Pesa STK Push)

Because `local-lite/payments` stays universal, regional gateways such as Safaricom Daraja can be implemented cleanly in application code with `createPaymentAdapter()` and mounted on `createPaymentServerHandler()`:

```typescript
import {
  createPaymentAdapter,
  createPaymentRegistry,
} from 'local-lite/payments';
import {
  createMemoryPaymentStore,
  createPaymentServerHandler,
} from 'local-lite/payments/server';

function formatKenyanPhone(phone: string | number): string {
  const digits = String(phone ?? '').replace(/[^\d]/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

export function createMyDarajaAdapter(config: {
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackUrl: string;
  env?: 'sandbox' | 'production';
}) {
  const baseUrl =
    config.env === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

  return createPaymentAdapter({
    id: 'daraja',
    label: 'M-Pesa (Safaricom Daraja)',
    description: 'Instant STK Push prompt to an M-Pesa number.',
    supportedCurrencies: ['KES'],
    supportedCountries: ['KE'],
    requiresOnline: true,

    async initiate(input) {
      const phone = formatKenyanPhone(input.phone ?? '');
      if (!/^254\d{9}$/.test(phone)) {
        throw new Error('Valid Kenyan phone number (254XXXXXXXXX) is required.');
      }

      const amount = Math.round(input.amount);
      if (!Number.isInteger(amount) || amount < 1 || amount > 250000) {
        throw new Error('M-Pesa amount must be an integer between 1 and 250000.');
      }

      const callbackUrl = (input.callbackUrl ?? config.callbackUrl).trim();
      if (!callbackUrl.startsWith('https://')) {
        throw new Error('Daraja callbackUrl must use HTTPS.');
      }

      // 1. Fetch OAuth token
      const basicAuth = Buffer.from(
        `${config.consumerKey}:${config.consumerSecret}`,
        'utf8',
      ).toString('base64');

      const oauthRes = await fetch(
        `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        { headers: { Authorization: `Basic ${basicAuth}` } },
      );
      if (!oauthRes.ok) {
        throw new Error(`Daraja OAuth failed (${oauthRes.status})`);
      }
      const { access_token } = (await oauthRes.json()) as { access_token?: string };
      if (!access_token) throw new Error('Missing Daraja access_token.');

      // 2. Initiate STK Push (EAT = UTC+3)
      const timestamp = new Date(Date.now() + 3 * 3_600_000)
        .toISOString()
        .replace(/[-:TZ.]/g, '')
        .slice(0, 14);
      const password = Buffer.from(
        `${config.shortcode}${config.passkey}${timestamp}`,
        'utf8',
      ).toString('base64');

      const accountRef = String(
        input.metadata?.accountReference ?? input.actionId,
      ).slice(0, 12);

      const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          BusinessShortCode: config.shortcode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: 'CustomerPayBillOnline',
          Amount: amount,
          PartyA: phone,
          PartyB: config.shortcode,
          PhoneNumber: phone,
          CallBackURL: callbackUrl,
          AccountReference: accountRef,
          TransactionDesc: input.description || 'Payment',
        }),
      });

      const data = (await stkRes.json()) as {
        ResponseCode?: string;
        CheckoutRequestID?: string;
        CustomerMessage?: string;
        errorMessage?: string;
      };
      if (!stkRes.ok || data.ResponseCode !== '0' || !data.CheckoutRequestID) {
        throw new Error(data.errorMessage || 'Daraja initiation failed.');
      }

      return {
        success: true,
        status: 'pending',
        provider: 'daraja',
        actionId: input.actionId,
        providerRef: data.CheckoutRequestID,
        customerMessage: data.CustomerMessage,
        raw: data,
      };
    },

    async verifyWebhook(request) {
      const payload = (await request.json()) as {
        Body?: {
          stkCallback?: {
            CheckoutRequestID?: string;
            ResultCode?: number;
            ResultDesc?: string;
            CallbackMetadata?: {
              Item?: Array<{ Name?: string; Value?: unknown }>;
            };
          };
        };
      };

      const cb = payload?.Body?.stkCallback;
      if (!cb || !Number.isInteger(cb.ResultCode)) {
        return { verified: false, status: 'failed', error: 'Invalid payload.', rawPayload: payload };
      }

      if (cb.ResultCode !== 0) {
        return {
          verified: true,
          providerRef: cb.CheckoutRequestID,
          status: 'failed',
          error: cb.ResultDesc || 'Payment failed',
          rawPayload: cb,
        };
      }

      const items = cb.CallbackMetadata?.Item ?? [];
      const readItem = (name: string) => items.find((i) => i.Name === name)?.Value;
      const receiptNumber = readItem('MpesaReceiptNumber');
      const amount = Number(readItem('Amount'));

      if (typeof receiptNumber !== 'string' || !Number.isFinite(amount)) {
        return {
          verified: false,
          providerRef: cb.CheckoutRequestID,
          status: 'failed',
          error: 'Incomplete callback metadata.',
          rawPayload: cb,
        };
      }

      return {
        verified: true,
        providerRef: cb.CheckoutRequestID,
        receiptNumber,
        amount,
        currency: 'KES',
        phone: String(readItem('PhoneNumber') ?? ''),
        status: 'completed',
        rawPayload: cb,
      };
    },
  });
}

// Mount with local-lite/payments/server:
const daraja = createMyDarajaAdapter({
  consumerKey: process.env.DARAJA_CONSUMER_KEY!,
  consumerSecret: process.env.DARAJA_CONSUMER_SECRET!,
  shortcode: process.env.DARAJA_SHORTCODE!,
  passkey: process.env.DARAJA_PASSKEY!,
  callbackUrl: 'https://api.example.com/payments/callback',
  env: 'sandbox',
});

export const paymentHandler = createPaymentServerHandler({
  registry: createPaymentRegistry({ providers: [daraja] }),
  store: createMemoryPaymentStore(), // or createSqlPaymentStore(executor)
  callbackBaseUrl: 'https://api.example.com/payments/callback',
  onCompleted: async (reservation, webhook) => {
    console.log('Paid:', reservation.actionId, webhook.receiptNumber, reservation.metadata);
  },
});
```

> Pass any domain-specific fields (such as `accountReference`, `orderId`, or `tenantId`) inside `metadata` when calling `/payments/initiate`; `local-lite` forwards `metadata` to both `initiate()` and `onCompleted()`.
