import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';
import { ActionRecord, EmailPayload } from '../src/actions/types.js';

describe('Generic Action Outbox & Inbuilt Email Queue', () => {
  let db: MockDB;
  let remote: MemoryDemoRemoteAdapter;
  let network: DefaultNetworkStatusProvider;
  let client: LocalFirstClient;

  beforeEach(async () => {
    db = new MockDB();
    remote = new MemoryDemoRemoteAdapter(50);
    network = new DefaultNetworkStatusProvider(true);

    client = new LocalFirstClient({
      local: db,
      remote,
      network,
      pushIntervalMs: 500,
      pullIntervalMs: 1000,
    });

    await client.initialize();
  });

  afterEach(() => {
    client.stop();
  });

  it('enqueues transactional email with client.actions.sendEmail', async () => {
    const emailAction = await client.actions.sendEmail({
      to: 'user@example.com',
      subject: 'Welcome to local-lite!',
      html: '<p>Hello world</p>',
      template: 'welcome',
      templateData: { name: 'Alice' },
    });

    expect(emailAction.id).toBeDefined();
    expect(emailAction.action).toBe('send_email');
    expect(emailAction.status).toBe('PENDING');
    expect(emailAction.payload.to).toBe('user@example.com');
    expect(emailAction.payload.subject).toBe('Welcome to local-lite!');
    expect(emailAction.payload.template).toBe('welcome');
    expect(emailAction.payload.templateData).toEqual({ name: 'Alice' });

    const stored = await client.actions.get(emailAction.id);
    expect(stored).not.toBeNull();
    expect(stored?.action).toBe('send_email');
    expect(stored?.status).toBe('PENDING');
  });

  it('validates required email parameters', async () => {
    // @ts-expect-error Missing required to
    await expect(client.actions.sendEmail({ subject: 'Test' })).rejects.toThrow("Email 'to' recipient is required");
    // @ts-expect-error Missing required subject
    await expect(client.actions.sendEmail({ to: 'bob@example.com' })).rejects.toThrow("Email 'subject' is required");
  });

  it('enforces idempotency preventing duplicate action execution', async () => {
    const key = 'invite_user_42';

    const action1 = await client.actions.sendEmail({
      to: 'member@team.com',
      subject: 'You have been invited',
      idempotencyKey: key,
    });

    const action2 = await client.actions.sendEmail({
      to: 'member@team.com',
      subject: 'You have been invited (duplicate attempt)',
      idempotencyKey: key,
    });

    expect(action1.id).toBe(action2.id);
    expect(action2.payload.subject).toBe('You have been invited'); // kept original
  });

  it('flushes pending email actions when online via registerEmailHandler', async () => {
    const dispatchedEmails: EmailPayload[] = [];

    client.actions.registerEmailHandler(async (email) => {
      dispatchedEmails.push(email);
      return { messageId: 'msg-999' };
    });

    const email = await client.actions.sendEmail({
      to: 'customer@shop.com',
      subject: 'Order Confirmed',
      text: 'Thanks for your purchase!',
    });

    const flushResult = await client.actions.flush();

    expect(flushResult.completed).toBe(1);
    expect(dispatchedEmails).toHaveLength(1);
    expect(dispatchedEmails[0].to).toBe('customer@shop.com');

    const updated = await client.actions.get(email.id);
    expect(updated?.status).toBe('COMPLETED');
    expect(updated?.executedAt).toBeGreaterThan(0);
    expect(updated?.result).toEqual({ messageId: 'msg-999' });
  });

  it('keeps actions pending while offline and flushes upon reconnecting', async () => {
    network.setOnline(false);

    let sent = false;
    client.actions.registerEmailHandler(async () => {
      sent = true;
      return { messageId: 'msg-offline-recovery' };
    });

    const email = await client.actions.sendEmail({
      to: 'offline@user.com',
      subject: 'Queued offline',
    });

    // Attempt flush while offline
    const offlineFlush = await client.actions.flush();
    expect(offlineFlush.processed).toBe(0);
    expect(sent).toBe(false);

    const checkOffline = await client.actions.get(email.id);
    expect(checkOffline?.status).toBe('PENDING');

    // Reconnect
    network.setOnline(true);

    const onlineFlush = await client.actions.flush();
    expect(onlineFlush.completed).toBe(1);
    expect(sent).toBe(true);

    const checkOnline = await client.actions.get(email.id);
    expect(checkOnline?.status).toBe('COMPLETED');
  });

  it('supports arbitrary generic actions like push notifications or webhooks', async () => {
    const sentPushes: any[] = [];

    client.actions.registerHandler('push_notification', async (action) => {
      sentPushes.push(action.payload);
      return { delivered: true, deviceToken: action.payload.deviceToken };
    });

    const push = await client.actions.enqueue({
      action: 'push_notification',
      payload: {
        deviceToken: 'fcm-xyz',
        title: 'New Message',
        body: 'You got a new message from Sarah',
      },
    });

    const result = await client.actions.flush();
    expect(result.completed).toBe(1);
    expect(sentPushes).toHaveLength(1);
    expect(sentPushes[0].deviceToken).toBe('fcm-xyz');

    const updated = await client.actions.get(push.id);
    expect(updated?.status).toBe('COMPLETED');
    expect(updated?.result).toEqual({ delivered: true, deviceToken: 'fcm-xyz' });
  });

  it('expires stale actions when TTL has passed without executing them', async () => {
    let handlerCalled = false;
    const expiredEvents: ActionRecord[] = [];

    client.events.on('action:expired', (act: ActionRecord) => {
      expiredEvents.push(act);
    });

    client.actions.registerEmailHandler(async () => {
      handlerCalled = true;
    });

    // Create action with already expired TTL
    const expiredAction = await client.actions.sendEmail({
      to: 'expired@test.com',
      subject: 'Time-sensitive promo',
      expiresAt: Date.now() - 5000, // expired 5 seconds ago
    });

    const flushResult = await client.actions.flush();
    expect(flushResult.expired).toBe(1);
    expect(handlerCalled).toBe(false);

    const record = await client.actions.get(expiredAction.id);
    expect(record?.status).toBe('EXPIRED');
    expect(expiredEvents).toHaveLength(1);
    expect(expiredEvents[0].id).toBe(expiredAction.id);
  });

  it('retries on failure and marks as FAILED after maxRetries', async () => {
    let callCount = 0;
    const failedEvents: ActionRecord[] = [];

    client.events.on('action:failed', (act: ActionRecord) => {
      failedEvents.push(act);
    });

    client.actions.registerEmailHandler(async () => {
      callCount++;
      throw new Error('SMTP Connection timeout');
    });

    const email = await client.actions.sendEmail({
      to: 'retry@domain.com',
      subject: 'Test Retry',
      maxRetries: 2,
    });

    // Attempt 1: failure -> status remains PENDING, retryCount becomes 1
    const res1 = await client.actions.flush();
    expect(res1.failed).toBe(0);
    expect(callCount).toBe(1);

    let rec = await client.actions.get(email.id);
    expect(rec?.status).toBe('PENDING');
    expect(rec?.retryCount).toBe(1);
    expect(rec?.lastError).toContain('SMTP Connection timeout');

    // Attempt 2: second failure -> reaches maxRetries (2) -> marks FAILED
    const res2 = await client.actions.flush();
    expect(res2.failed).toBe(1);
    expect(callCount).toBe(2);

    rec = await client.actions.get(email.id);
    expect(rec?.status).toBe('FAILED');
    expect(rec?.retryCount).toBe(2);
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0].id).toBe(email.id);
  });

  it('cancels pending actions before execution', async () => {
    const action = await client.actions.sendEmail({
      to: 'cancel@domain.com',
      subject: 'Do not send',
    });

    const cancelled = await client.actions.cancel(action.id);
    expect(cancelled).toBe(true);

    const rec = await client.actions.get(action.id);
    expect(rec?.status).toBe('CANCELLED');
  });

  it('prunes old completed, failed, and expired actions', async () => {
    // 1. Completed action
    client.actions.registerEmailHandler(async () => ({ ok: true }));
    const act = await client.actions.sendEmail({
      to: 'prune@domain.com',
      subject: 'Prune me',
    });
    await client.actions.flush();

    // 2. Query before prune
    let list = await client.actions.list();
    expect(list.some((a) => a.id === act.id)).toBe(true);

    // 3. Prune completed older than 0ms
    await client.actions.prune({ completedOlderThanMs: 0 });

    const afterPrune = await client.actions.get(act.id);
    expect(afterPrune).toBeNull();
  });

  it('recovers interrupted EXECUTING actions on client restart', async () => {
    const act = await client.actions.sendEmail({
      to: 'crash@domain.com',
      subject: 'Crash test',
    });

    // Simulate crash while status was EXECUTING
    db.getTable('_local_actions').get(act.id).status = 'EXECUTING';

    // Restart / re-initialize client
    const restartedClient = new LocalFirstClient({
      local: db,
      remote,
      network,
    });
    await restartedClient.initialize();

    const recovered = await restartedClient.actions.get(act.id);
    expect(recovered?.status).toBe('PENDING');

    restartedClient.stop();
  });
});
