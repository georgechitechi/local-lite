import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createManualPaymentAdapter,
  createPaymentAdapter,
  createPaymentRegistry,
  createPaystackAdapter,
  createStripeCheckoutAdapter,
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
        createPaymentAdapter({
          id: 'eu-sepa',
          label: 'SEPA Instant',
          supportedCurrencies: ['EUR'],
          supportedCountries: ['DE', 'FR'],
          initiate: async (input) => ({
            success: true,
            status: 'pending',
            provider: 'eu-sepa',
            actionId: input.actionId,
            providerRef: `sepa_${input.actionId}`,
          }),
        }),
        createStripeCheckoutAdapter({ secretKey: 'sk_test_123' }),
        createPaystackAdapter({ secretKey: 'sk_paystack_123' }),
      ],
    });

    const euOnline = registry
      .getAvailableOptions({ currency: 'EUR', country: 'DE', isOnline: true })
      .map((o) => o.id);
    expect(euOnline).toEqual(['manual', 'eu-sepa', 'stripe']);

    const usOnline = registry
      .getAvailableOptions({ currency: 'USD', country: 'US', isOnline: true })
      .map((o) => o.id);
    expect(usOnline).toEqual(['manual', 'stripe', 'paystack']);

    const offline = registry
      .getAvailableOptions({ currency: 'EUR', isOnline: false })
      .map((o) => o.id);
    expect(offline).toEqual(['manual']);

    registry.configure({ enabledProviders: ['stripe', 'manual'] });
    const configured = registry
      .getAvailableOptions({ currency: 'EUR', country: 'DE', isOnline: true })
      .map((o) => o.id);
    expect(configured).toEqual(['manual', 'stripe']);
  });

  it('supports generic offline and custom online payment adapters', async () => {
    const offline = createPaymentAdapter({
      id: 'cash',
      label: 'Cash',
    });
    expect(offline.requiresOnline).toBe(false);
    const offlineRes = await offline.initiate({
      actionId: 'act_cash',
      provider: 'cash',
      amount: 50,
      currency: 'USD',
    });
    expect(offlineRes.status).toBe('completed');
    expect(offlineRes.providerRef).toBe('act_cash');

    const custom = createPaymentAdapter({
      id: 'custom-gateway',
      label: 'Custom Gateway',
      supportedCurrencies: ['USD', 'EUR'],
      initiate: async (input) => ({
        success: true,
        status: 'pending',
        provider: 'custom-gateway',
        actionId: input.actionId,
        providerRef: 'gw_ref_123',
      }),
      verifyWebhook: async (req) => {
        const body = (await req.json()) as {
          ref: string;
          receipt: string;
          amount: number;
        };
        return {
          verified: true,
          providerRef: body.ref,
          receiptNumber: body.receipt,
          amount: body.amount,
          status: 'completed',
        };
      },
    });
    expect(custom.requiresOnline).toBe(true);

    const init = await custom.initiate({
      actionId: 'act_1',
      provider: 'custom-gateway',
      amount: 1500,
      currency: 'USD',
    });
    expect(init.status).toBe('pending');
    expect(init.providerRef).toBe('gw_ref_123');

    const webhookRes = await custom.verifyWebhook!(
      new Request('https://api.example.com/payments/callback', {
        method: 'POST',
        body: JSON.stringify({
          ref: 'gw_ref_123',
          receipt: 'RCPT_123',
          amount: 1500,
        }),
      }),
    );
    expect(webhookRes.verified).toBe(true);
    expect(webhookRes.status).toBe('completed');
    expect(webhookRes.receiptNumber).toBe('RCPT_123');
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
    let capturedCallbackUrl = '';
    const customProvider = createPaymentAdapter({
      id: 'custom-gateway',
      label: 'Custom Gateway',
      supportedCurrencies: ['USD'],
      initiate: async (input) => {
        capturedCallbackUrl = input.callbackUrl ?? '';
        return {
          success: true,
          status: 'pending',
          provider: 'custom-gateway',
          actionId: input.actionId,
          providerRef: 'gw_CO_999',
          customerMessage: 'Accepted',
        };
      },
      verifyWebhook: async (req) => {
        const body = (await req.json()) as {
          ref: string;
          receipt: string;
          amount: number;
        };
        return {
          verified: true,
          providerRef: body.ref,
          receiptNumber: body.receipt,
          amount: body.amount,
          status: 'completed',
        };
      },
    });

    const registry = createPaymentRegistry({ providers: [customProvider] });
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
          provider: 'custom-gateway',
          amount: 1000,
          currency: 'USD',
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
          provider: 'custom-gateway',
          amount: 1000,
          currency: 'USD',
        }),
      }),
    );
    const dupJson = (await dupRes.json()) as {
      duplicate: boolean;
      providerRef: string;
    };
    expect(dupJson.duplicate).toBe(true);
    expect(dupJson.providerRef).toBe('gw_CO_999');

    // Mismatched amount callback is rejected
    const badCb = await handler(
      new Request(capturedCallbackUrl, {
        method: 'POST',
        body: JSON.stringify({
          ref: 'gw_CO_999',
          receipt: 'BAD123',
          amount: 500,
        }),
      }),
    );
    expect(badCb.status).toBe(400);

    // Valid callback completes once
    const okCb = await handler(
      new Request(capturedCallbackUrl, {
        method: 'POST',
        body: JSON.stringify({
          ref: 'gw_CO_999',
          receipt: 'OK12345',
          amount: 1000,
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
