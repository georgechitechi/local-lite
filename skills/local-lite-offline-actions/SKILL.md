---
name: local-lite-offline-actions
description: Queue offline actions, schedule background jobs, store key-value preferences, and track sync telemetry in local-lite. Use when using client.actions, client.scheduler, client.kv, client.getMetrics(), or handling offline mutation retries.
---

# local-lite Offline Actions, KV & Scheduler

Guide for executing queued actions, running background jobs, persisting key-value pairs, and inspecting sync telemetry with `local-lite`.

---

## 1. Action Manager & Outbox (`client.actions`)

The Action Manager handles complex business logic mutations that must be queued offline and executed reliably when connectivity is restored:

### Type-Safe Action Contracts (`defineAction`)
Validate payloads before writing to SQLite using runtime schema validators (custom predicates or Zod/TypeBox schemas):

```typescript
// Define action with runtime schema validation
client.actions.defineAction({
  name: 'PROCESS_PAYMENT',
  schema: (payload: any) => {
    if (!payload.amount || payload.amount <= 0) throw new Error('Positive amount required');
    if (!payload.currency) throw new Error('Currency required');
    return payload;
  },
  handler: async (action, context) => {
    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      body: JSON.stringify(action.payload),
    });
    return await res.json();
  },
});
```

### Rate Limiting & Concurrency Control
Configure worker concurrency and token-bucket rate limiting to avoid tripping downstream API rate limits:

```typescript
const client = await createSyncClient({
  database: 'app.db',
  // Concurrency & rate-limiting for action outbox
  // ActionManager options can be configured directly or on client actions
});
```

### Inbuilt Offline Email Queue (`client.actions.sendEmail`)
Enqueue transactional emails with 0ms local write latency:

```typescript
const emailAction = await client.actions.sendEmail({
  to: 'user@example.com',
  subject: 'Order #{{orderId}} Confirmed',
  html: '<h2>Thanks {{name}}!</h2>',
  templateData: { name: 'Alice', orderId: 1042 },
  idempotencyKey: 'order_1042',
  attachments: [
    { filename: 'receipt.pdf', url: 'file:///data/user/0/receipt.pdf' } // Auto-hydrates mobile file:// URIs
  ],
  react: <ReceiptEmail orderId={1042} />, // Optional React Email JSX rendering
});
```

### Unified Email Providers (`local-lite/email`)
Dispatch via Nodemailer SMTP, HTTP APIs (Resend, SendGrid, Postmark), or In-Memory Dev Mode:

```typescript
import { createEmailHandler, DevMailbox } from 'local-lite/email';

// 1. In-Memory Dev Mode (no external credentials needed in development)
client.actions.registerEmailHandler(
  createEmailHandler({ provider: 'dev' })
);
console.log('Dev Mailbox:', DevMailbox.getInbox());

// 2. Nodemailer SMTP
client.actions.registerEmailHandler(
  createEmailHandler({
    transport: { host: 'smtp.mailgun.org', port: 587, auth: { user: '...', pass: '...' } },
    defaultFrom: '"Support" <support@myapp.com>',
  })
);

// 3. HTTP Provider (Resend, SendGrid, Postmark)
client.actions.registerEmailHandler(
  createEmailHandler({
    provider: 'resend',
    apiKey: process.env.RESEND_API_KEY,
    defaultFrom: 'onboarding@resend.dev',
  })
);
```

---

## 2. Key-Value Store & Secret Preferences (`client.kv`)

`client.kv` provides lightweight key-value storage directly within SQLite with optional TTL expiration and AES-256-GCM encryption.

### Basic KV Usage
```typescript
// Store with optional TTL (expires in 24 hours)
await client.kv.set('last_viewed_tab', 'dashboard', { ttlMs: 24 * 60 * 60 * 1000 });

// Read value (returns null if expired or missing)
const tab = await client.kv.get('last_viewed_tab');

// Delete value
await client.kv.delete('last_viewed_tab');
```

### Encrypted Secrets (AES-256-GCM)
Store sensitive API tokens or user secrets securely:

```typescript
// Encrypt and persist
await client.kv.setSecret('api_token', 'sk-live-secret-token-12345', 'PassphraseOrHardwareKey');

// Decrypt
const token = await client.kv.getSecret('api_token', 'PassphraseOrHardwareKey');
```

---

## 3. Background Job Scheduler (`client.scheduler`)

Schedule recurring cron-style or interval jobs that run within your application:

```typescript
// Register a recurring maintenance task
client.scheduler.registerJob({
  name: 'CLEANUP_OLD_LOGS',
  intervalMs: 60 * 60 * 1000, // Run every hour
  runImmediately: false,
  handler: async () => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    await client.db.execute('DELETE FROM activity_logs WHERE created_at < ?;', [oneWeekAgo]);
    console.log('Old activity logs purged.');
  },
});

// Start scheduler execution
client.scheduler.start();
```

---

## 4. Sync Telemetry & Health Metrics (`client.getMetrics()`)

Monitor the health of your local-first sync pipeline in real time:

```typescript
const metrics = await client.getMetrics();

console.log('Outbox Queue Size:', metrics.outboxPendingCount);
console.log('Total Pushes Succeeded:', metrics.pushesSuccessCount);
console.log('Total Pushes Failed:', metrics.pushesFailedCount);
console.log('Average Push Latency:', metrics.avgPushDurationMs, 'ms');
console.log('Last Sync Timestamp:', new Date(metrics.lastSyncAt).toLocaleTimeString());
```

