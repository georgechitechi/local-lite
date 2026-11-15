import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createDarajaAdapter,
  createManualPaymentAdapter,
  createPaymentRegistry,
  createPaystackAdapter,
  createStripeCheckoutAdapter,
  formatKenyanPhone,
} from '../src/payments/index.js';
import {
  createMemoryPaymentStore,
  createPaymentServerHandler,
} from '../src/payments/server.js';

describe('local-lite/payments', () => {
  it('filters available payment options by currency, country, online state, and enabledProviders', () => {
    const registry = createPaymentRegistry({
      providers: [
        createManualPaymentAdapter(),
        createDarajaAdapter({
          consumerKey: 'ck',
          consumerSecret: 'cs',
          shortcode: '123456',
          passkey: 'pk',
          callbackUrl: 'https://api.example.com/payments/callback',
        }),
        createStripeCheckoutAdapter({ secretKey: 'sk_test_123' }),
        createPaystackAdapter({ secretKey: 'sk_paystack_123' }),
      ],
    });

    const kenyaOnline = registry
      .getAvailableOptions({ currency: 'KES', country: 'KE', isOnline: true })
      .map((o) => o.id);
    expect(kenyaOnline).toEqual(['manual', 'daraja', 'stripe', 'paystack']);

    const usOnline = registry
      .getAvailableOptions({ currency: 'USD', country: 'US', isOnline: true })
      .map((o) => o.id);
    expect(usOnline).toEqual(['manual', 'stripe', 'paystack']);

    const offline = registry
      .getAvailableOptions({ currency: 'KES', isOnline: false })
      .map((o) => o.id);
    expect(offline).toEqual(['manual']);

    registry.configure({ enabledProviders: ['stripe', 'manual'] });
    const configured = registry
      .getAvailableOptions({ currency: 'KES', country: 'KE', isOnline: true })
      .map((o) => o.id);
    expect(configured).toEqual(['manual', 'stripe']);
  });

  it('formats Kenyan phone numbers and handles Daraja initiation + webhook verification', async () => {
    expect(formatKenyanPhone('0712345678')).toBe('254712345678');
    expect(formatKenyanPhone('712345678')).toBe('254712345678');

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ access_token: 'daraja_tok_123' }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ResponseCode: '0',
          CheckoutRequestID: 'ws_CO_123',
          MerchantRequestID: 'mr_123',
          CustomerMessage: 'Success. Request accepted',
        }),
      );

    const daraja = createDarajaAdapter({
      consumerKey: 'ck',
      consumerSecret: 'cs',
      shortcode: '123456',
      passkey: 'pk',
      callbackUrl: 'https://api.example.com/payments/callback',
      fetch: mockFetch as unknown as typeof fetch,
    });

    const init = await daraja.initiate({
      actionId: 'act_1',
      provider: 'daraja',
      amount: 1500,
      currency: 'KES',
      phone: '0712345678',
      contractId: 'contract_1',
    });

    expect(init.status).toBe('pending');
    expect(init.providerRef).toBe('ws_CO_123');
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const webhookRes = await daraja.verifyWebhook!(
      new Request('https://api.example.com/payments/callback', {
        method: 'POST',
        body: JSON.stringify({
          Body: {
            stkCallback: {
              MerchantRequestID: 'mr_123',
              CheckoutRequestID: 'ws_CO_123',
              ResultCode: 0,
              CallbackMetadata: {
                Item: [
                  { Name: 'Amount', Value: 1500 },
                  { Name: 'MpesaReceiptNumber', Value: 'QWE123RTY' },
                  { Name: 'PhoneNumber', Value: 254712345678 },
                ],
              },
            },
          },
        }),
      }),
    );

    expect(webhookRes.verified).toBe(true);
    expect(webhookRes.status).toBe('completed');
    expect(webhookRes.receiptNumber).toBe('QWE123RTY');
    expect(webhookRes.amount).toBe(1500);
  });

  it('supports Stripe & Paystack checkout initiation', async () => {
    const stripeFetch = vi.fn().mockResolvedValueOnce(
      Response.json({
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/pay/cs_test_1',
      }),
    );
    const stripe = createStripeCheckoutAdapter({
      secretKey: 'sk_test',
      fetch: stripeFetch as unknown as typeof fetch,
    });

    const stripeRes = await stripe.initiate({
      actionId: 'act_stripe',
      provider: 'stripe',
      amount: 49.5,
      currency: 'USD',
      returnUrl: 'https://app.example.com/return',
    });
    expect(stripeRes.checkoutUrl).toBe(
      'https://checkout.stripe.com/pay/cs_test_1',
    );

    const paystackFetch = vi.fn().mockResolvedValueOnce(
      Response.json({
        status: true,
        data: {
          reference: 'act_ps',
          authorization_url: 'https://checkout.paystack.com/xyz',
        },
      }),
    );
    const paystack = createPaystackAdapter({
      secretKey: 'sk_ps',
      fetch: paystackFetch as unknown as typeof fetch,
    });
    const psRes = await paystack.initiate({
      actionId: 'act_ps',
      provider: 'paystack',
      amount: 2500,
      currency: 'NGN',
      email: 'tenant@example.com',
    });
    expect(psRes.checkoutUrl).toBe('https://checkout.paystack.com/xyz');
  });

  it('handles idempotent server reservation and callback completion', async () => {
    const completed: string[] = [];
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'tok' }))
      .mockResolvedValueOnce(
        Response.json({
          ResponseCode: '0',
          CheckoutRequestID: 'ws_CO_999',
          MerchantRequestID: 'mr_999',
          CustomerMessage: 'Accepted',
        }),
      );

    let capturedCallbackUrl = '';
    const daraja = createDarajaAdapter({
      consumerKey: 'ck',
      consumerSecret: 'cs',
      shortcode: '123456',
      passkey: 'pk',
      callbackUrl: 'https://api.example.com/payments/callback',
      fetch: (async (url: any, init: any) => {
        if (String(url).includes('processrequest')) {
          capturedCallbackUrl = JSON.parse(init.body).CallBackURL;
        }
        return mockFetch(url, init);
      }) as typeof fetch,
    });

    const registry = createPaymentRegistry({ providers: [daraja] });
    const store = createMemoryPaymentStore();
    const handler = createPaymentServerHandler({
      registry,
      store,
      callbackBaseUrl: 'https://api.example.com/payments/callback',
      onCompleted: async (reservation, webhook) => {
        completed.push(`${reservation.actionId}:${webhook.receiptNumber}`);
      },
    });

    const initRes = await handler(
      new Request('https://api.example.com/payments/initiate', {
        method: 'POST',
        body: JSON.stringify({
          actionId: 'act_999',
          provider: 'daraja',
          amount: 1000,
          currency: 'KES',
          phone: '254712345678',
        }),
      }),
    );
    expect(initRes.status).toBe(200);

    // Duplicate retry returns cached pending response
    const dupRes = await handler(
      new Request('https://api.example.com/payments/initiate', {
        method: 'POST',
        body: JSON.stringify({
          actionId: 'act_999',
          provider: 'daraja',
          amount: 1000,
          currency: 'KES',
          phone: '254712345678',
        }),
      }),
    );
    const dupJson: any = await dupRes.json();
    expect(dupJson.duplicate).toBe(true);
    expect(dupJson.providerRef).toBe('ws_CO_999');

    // Mismatched amount callback is rejected
    const badCb = await handler(
      new Request(capturedCallbackUrl, {
        method: 'POST',
        body: JSON.stringify({
          Body: {
            stkCallback: {
              MerchantRequestID: 'mr_999',
              CheckoutRequestID: 'ws_CO_999',
              ResultCode: 0,
              CallbackMetadata: {
                Item: [
                  { Name: 'Amount', Value: 500 },
                  { Name: 'MpesaReceiptNumber', Value: 'BAD123' },
                  { Name: 'PhoneNumber', Value: 254712345678 },
                ],
              },
            },
          },
        }),
      }),
    );
    expect(badCb.status).toBe(400);

    // Valid callback completes once
    const okCb = await handler(
      new Request(capturedCallbackUrl, {
        method: 'POST',
        body: JSON.stringify({
          Body: {
            stkCallback: {
              MerchantRequestID: 'mr_999',
              CheckoutRequestID: 'ws_CO_999',
              ResultCode: 0,
              CallbackMetadata: {
                Item: [
                  { Name: 'Amount', Value: 1000 },
                  { Name: 'MpesaReceiptNumber', Value: 'OK12345' },
                  { Name: 'PhoneNumber', Value: 254712345678 },
                ],
              },
            },
          },
        }),
      }),
    );
    expect(okCb.status).toBe(200);
    expect(completed).toEqual(['act_999:OK12345']);
  });

  it('verifies Stripe and Paystack signed webhooks', async () => {
    const stripeSecret = 'whsec_test_123';
    const stripe = createStripeCheckoutAdapter({
      secretKey: 'sk_test',
      webhookSecret: stripeSecret,
    });

    const stripePayload = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_webhook',
          client_reference_id: 'act_stripe_wh',
          payment_intent: 'pi_12345',
          amount_total: 4950,
          currency: 'usd',
        },
      },
    });
    const ts = Math.floor(Date.now() / 1000);
    const stripeSig = crypto
      .createHmac('sha256', stripeSecret)
      .update(`${ts}.${stripePayload}`)
      .digest('hex');

    const stripeWh = await stripe.verifyWebhook!(
      new Request('https://api.example.com/payments/callback?provider=stripe', {
        method: 'POST',
        headers: { 'stripe-signature': `t=${ts},v1=${stripeSig}` },
        body: stripePayload,
      }),
    );
    expect(stripeWh.verified).toBe(true);
    expect(stripeWh.status).toBe('completed');
    expect(stripeWh.amount).toBe(49.5);
    expect(stripeWh.currency).toBe('USD');
    expect(stripeWh.actionId).toBe('act_stripe_wh');

    const badStripeWh = await stripe.verifyWebhook!(
      new Request('https://api.example.com/payments/callback?provider=stripe', {
        method: 'POST',
        headers: { 'stripe-signature': `t=${ts},v1=deadbeef` },
        body: stripePayload,
      }),
    );
    expect(badStripeWh.verified).toBe(false);

    const paystackKey = 'sk_test_paystack';
    const paystack = createPaystackAdapter({ secretKey: paystackKey });
    const paystackPayload = JSON.stringify({
      event: 'charge.success',
      data: {
        id: 987654,
        reference: 'act_ps_wh',
        amount: 250000,
        currency: 'NGN',
      },
    });
    const psSig = crypto
      .createHmac('sha512', paystackKey)
      .update(paystackPayload)
      .digest('hex');

    const psWh = await paystack.verifyWebhook!(
      new Request('https://api.example.com/payments/callback?provider=paystack', {
        method: 'POST',
        headers: { 'x-paystack-signature': psSig },
        body: paystackPayload,
      }),
    );
    expect(psWh.verified).toBe(true);
    expect(psWh.status).toBe('completed');
    expect(psWh.amount).toBe(2500);
    expect(psWh.currency).toBe('NGN');
    expect(psWh.actionId).toBe('act_ps_wh');
  });
});
