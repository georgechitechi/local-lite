import crypto from 'node:crypto';
import type { PaymentRegistry } from './registry.js';
import type {
  PaymentInitiateInput,
  PaymentReservationRecord,
  PaymentReservationStore,
  PaymentWebhookResult,
} from './types.js';

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function createCallbackToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * In-memory PaymentReservationStore useful for testing and prototypes.
 */
export function createMemoryPaymentStore(): PaymentReservationStore {
  const byActionId = new Map<string, PaymentReservationRecord>();

  return {
    async findByActionId(actionId) {
      return byActionId.get(actionId) ?? null;
    },
    async findByCallbackHash(callbackHash) {
      for (const record of byActionId.values()) {
        if (record.callbackHash === callbackHash) return record;
      }
      return null;
    },
    async findByProviderRef(providerRef) {
      for (const record of byActionId.values()) {
        if (record.providerRef === providerRef) return record;
      }
      return null;
    },
    async reserve(record) {
      if (byActionId.has(record.actionId)) {
        throw new Error(`Action ID "${record.actionId}" is already reserved.`);
      }
      byActionId.set(record.actionId, { ...record });
    },
    async markPending(actionId, update) {
      const existing = byActionId.get(actionId);
      if (!existing) return;
      byActionId.set(actionId, {
        ...existing,
        status: 'pending',
        providerRef: update.providerRef ?? existing.providerRef,
        merchantRequestId:
          update.merchantRequestId ?? existing.merchantRequestId,
        customerMessage: update.customerMessage ?? existing.customerMessage,
      });
    },
    async markFinal(actionId, status, error = null) {
      const existing = byActionId.get(actionId);
      if (!existing) return;
      byActionId.set(actionId, {
        ...existing,
        status,
        error,
      });
    },
  };
}

export interface PaymentServerHandlerOptions {
  registry: PaymentRegistry;
  store: PaymentReservationStore;
  callbackBaseUrl?: string;
  onCompleted?: (
    reservation: PaymentReservationRecord,
    webhook: PaymentWebhookResult,
  ) => Promise<void>;
}

/**
 * Creates a framework-agnostic Fetch Request handler for idempotent payment
 * initiation and webhook/callback verification across registered providers.
 */
export function createPaymentServerHandler(
  options: PaymentServerHandlerOptions,
): (request: Request) => Promise<Response> {
  const { registry, store, callbackBaseUrl, onCompleted } = options;

  async function handleInitiate(request: Request): Promise<Response> {
    const body: any = await request.json();
    const actionId = body?.actionId;
    const provider = body?.provider || 'daraja';
    const amount = Number(body?.amount);
    const currency = String(body?.currency || '').trim().toUpperCase();

    if (
      typeof actionId !== 'string' ||
      !actionId ||
      actionId.length > 128 ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !currency
    ) {
      return Response.json(
        { error: 'Valid actionId, provider, currency, and amount are required.' },
        { status: 400 },
      );
    }

    if (!registry.supports(provider, { currency, isOnline: true })) {
      return Response.json(
        { error: `Provider "${provider}" is not enabled for ${currency}.` },
        { status: 400 },
      );
    }

    const existing = await store.findByActionId(actionId);
    if (existing) {
      if (
        existing.provider !== provider ||
        existing.currency !== currency ||
        Number(existing.amount) !== amount
      ) {
        return Response.json(
          { error: 'Action ID is already in use.' },
          { status: 409 },
        );
      }
      if (!existing.providerRef && existing.status !== 'completed') {
        return Response.json(
          { error: 'Payment is already reserved. Reconcile before retrying.' },
          { status: 409 },
        );
      }
      return Response.json({
        success: true,
        duplicate: true,
        status: existing.status,
        provider: existing.provider,
        providerRef: existing.providerRef,
        merchantRequestId: existing.merchantRequestId,
        customerMessage: existing.customerMessage,
      });
    }

    const callbackToken = createCallbackToken();
    const callbackUrl = callbackBaseUrl
      ? (() => {
          const url = new URL(callbackBaseUrl);
          url.searchParams.set('callback_token', callbackToken);
          url.searchParams.set('provider', provider);
          return url.toString();
        })()
      : body?.callbackUrl;

    await store.reserve({
      actionId,
      provider,
      currency,
      amount,
      businessId: body?.businessId,
      userId: body?.userId,
      tenantId: body?.tenantId,
      contractId: body?.contractId,
      phone: body?.phone,
      email: body?.email,
      callbackHash: sha256Hex(callbackToken),
      status: 'initializing',
      metadata: body?.metadata,
    });

    try {
      const input: PaymentInitiateInput = {
        actionId,
        provider,
        amount,
        currency,
        businessId: body?.businessId,
        tenantId: body?.tenantId,
        contractId: body?.contractId,
        userId: body?.userId,
        phone: body?.phone,
        email: body?.email,
        callbackUrl,
        returnUrl: body?.returnUrl,
        description: body?.description,
        metadata: body?.metadata,
      };
      const result = await registry.initiate(input);
      if (result.status === 'completed') {
        await store.markFinal(actionId, 'completed', null);
      } else {
        await store.markPending(actionId, {
          providerRef: result.providerRef,
          merchantRequestId: result.merchantRequestId,
          customerMessage: result.customerMessage,
        });
      }
      return Response.json(result);
    } catch (error) {
      await store
        .markFinal(
          actionId,
          'failed',
          error instanceof Error ? error.message : 'Initiation failed',
        )
        .catch(() => {});
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Payment initiation failed.',
        },
        { status: 502 },
      );
    }
  }

  async function handleCallback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = url.searchParams.get('callback_token');
    let reservation: PaymentReservationRecord | null = null;

    if (token && /^[a-f0-9]{64}$/.test(token) && store.findByCallbackHash) {
      reservation = await store.findByCallbackHash(sha256Hex(token));
    }

    const providerId =
      url.searchParams.get('provider') || reservation?.provider || 'daraja';
    const adapter = registry.getProvider(providerId);
    if (!adapter?.verifyWebhook) {
      return Response.json(
        { error: 'Unsupported payment callback provider.' },
        { status: 400 },
      );
    }

    const webhook = await adapter.verifyWebhook(request);
    if (!webhook.verified) {
      return Response.json(
        { error: webhook.error || 'Callback could not be verified.' },
        { status: 400 },
      );
    }

    if (!reservation && webhook.actionId) {
      reservation = await store.findByActionId(webhook.actionId);
    }
    if (!reservation && webhook.providerRef && store.findByProviderRef) {
      reservation = await store.findByProviderRef(webhook.providerRef);
    }
    if (!reservation) {
      return Response.json(
        { error: 'Payment reservation not found.' },
        { status: 404 },
      );
    }

    if (['completed', 'failed'].includes(reservation.status)) {
      return Response.json({ ResultCode: 0, ResultDesc: 'Already processed' });
    }

    if (webhook.status === 'completed') {
      if (
        typeof webhook.amount === 'number' &&
        Math.round(webhook.amount * 100) !== Math.round(reservation.amount * 100)
      ) {
        return Response.json(
          { error: 'Callback amount mismatch.' },
          { status: 400 },
        );
      }
      if (
        webhook.currency &&
        webhook.currency.toUpperCase() !== reservation.currency.toUpperCase()
      ) {
        return Response.json(
          { error: 'Callback currency mismatch.' },
          { status: 400 },
        );
      }
      if (onCompleted) {
        await onCompleted(reservation, webhook);
      }
      await store.markFinal(reservation.actionId, 'completed', null);
    } else if (webhook.status === 'failed') {
      await store.markFinal(
        reservation.actionId,
        'failed',
        webhook.error || 'Payment failed',
      );
    }

    return Response.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    }
    const pathname = new URL(request.url).pathname;
    if (pathname.endsWith('/callback')) {
      return handleCallback(request);
    }
    return handleInitiate(request);
  };
}
