# 📨 Generic Action Outbox & Inbuilt Email Queue

In addition to database table synchronization, `local-lite` provides a dedicated **Generic Action Outbox** (`client.actions`). This engine is specifically designed for offline-queued commands and asynchronous side effects—such as **transactional emails, push notifications, webhooks, or payment intents**—that must execute reliably without data loss when network connectivity is intermittent.

---

## 🎯 Why an Action Outbox?

Standard database record synchronization (CRUD) and external actions (RPC) have fundamentally different requirements:

| Property | Standard Data Sync (CRUD) | Action Outbox (RPC / Side Effects) |
| :--- | :--- | :--- |
| **Example** | Update user profile, edit a note | Send order receipt email, send push alert |
| **Duplicates** | Safe (Idempotent: last-write-wins) | **Dangerous** (Duplicate execution sends multiple emails or double charges) |
| **Lifecycle** | Permanent SQLite records | **Transient**: `PENDING` ➔ `EXECUTING` ➔ `COMPLETED` / `FAILED` ➔ Pruned |
| **Direction** | Two-way sync (push local, pull remote) | **One-way command execution** with a persistent receipt/result |
| **Time Sensitivity** | Changes stay valid indefinitely | **Needs TTL / Expiration** (e.g. don't send time-sensitive alerts 2 days later) |

`client.actions` solves these problems by providing atomic storage in a local `_local_actions` table, strict idempotency deduplication, crash recovery, and configurable retries.

---

## 📧 Inbuilt Email Queueing

`local-lite` offers first-class, typed helpers for enqueuing and dispatching emails:

### Enqueuing an Email Offline

Enqueuing an email is an instantaneous (0ms) local write to SQLite. If the user is offline or the app suddenly closes, the email is safely preserved in local storage.

```typescript
import { client } from './sync.config';

const emailAction = await client.actions.sendEmail({
  to: 'customer@example.com',
  subject: 'Order #1042 Confirmed',
  html: '<h1>Thank you for your purchase!</h1>',
  text: 'Thank you for your purchase!',
  template: 'order_receipt',
  templateData: { orderId: 1042, total: '$49.99' },
  
  // Guarantees at-most-once execution even if pressed multiple times
  idempotencyKey: 'receipt_order_1042',
  
  // Time-to-live: expire if device remains offline for > 24 hours
  ttlMs: 24 * 60 * 60 * 1000,
  
  // Maximum retry attempts before marking status as FAILED
  maxRetries: 3,
});

console.log('Enqueued email ID:', emailAction.id);
```

### Email Options Reference

| Option | Type | Description |
| :--- | :--- | :--- |
| `to` | `string \| string[]` | **Required.** Recipient email address(es). |
| `subject` | `string` | **Required.** Email subject line. |
| `html` | `string` | Optional HTML email body. |
| `text` | `string` | Optional plaintext fallback. |
| `from` | `string` | Optional sender address (e.g. `support@yourdomain.com`). |
| `replyTo` | `string` | Optional reply-to address. |
| `cc` | `string \| string[]` | Optional carbon copy recipient(s). |
| `bcc` | `string \| string[]` | Optional blind carbon copy recipient(s). |
| `template` | `string` | Optional template identifier (for template-based engines). |
| `templateData` | `Record<string, any>` | Optional variables passed to your email template. |
| `attachments` | `EmailAttachment[]` | Array of `{ filename, content?, url?, contentType? }`. Auto-hydrates mobile `file://` URIs. |
| `react` | `ReactNode \| () => ReactNode` | Optional React Email JSX component rendered to HTML & text automatically. |
| `headers` | `Record<string, string>` | Optional custom MIME headers. |
| `idempotencyKey` | `string` | Unique key preventing duplicate action execution. |
| `ttlMs` | `number` | Expiration window in milliseconds from time of enqueuing. |
| `expiresAt` | `number` | Explicit Unix timestamp (ms) when the action expires. |
| `maxRetries` | `number` | Maximum delivery attempts before marking as `FAILED` (default: `3`). |

---

## 🚀 Dispatching Emails

`local-lite` provides a unified **`local-lite/email`** module supporting both **Nodemailer (SMTP/Sendmail/SES)** and **HTTP APIs (Resend, SendGrid, Postmark, webhooks)** directly—without requiring Convex, Supabase, or external database adapters.

### Pattern 1: Direct Email Dispatch via `local-lite/email` (Zero Cloud Adapters)

#### Option A: Declarative Configuration via `defineSyncConfig`

You can configure email delivery directly in `defineSyncConfig`. `local-lite` will automatically instantiate the transport and register the action handler:

**Using Nodemailer (SMTP / Transport):**
```typescript
import { createSyncClient, defineSyncConfig } from 'local-lite/config';

const client = await createSyncClient(
  defineSyncConfig({
    localOnly: true,
    email: {
      transport: {
        host: 'smtp.mailgun.org',
        port: 587,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      },
      defaults: {
        from: '"My Team" <noreply@mycompany.com>',
      },
    },
  })
);
```

**Using HTTP Providers (Resend, SendGrid, Postmark, or custom HTTP endpoint):**
```typescript
import { createSyncClient, defineSyncConfig } from 'local-lite/config';

const client = await createSyncClient(
  defineSyncConfig({
    localOnly: true,
    email: {
      provider: 'resend', // 'resend' | 'sendgrid' | 'postmark' | 'http'
      apiKey: process.env.RESEND_API_KEY,
      defaults: {
        from: 'Acme <onboarding@resend.dev>',
      },
    },
  })
);
```

#### Option B: Standalone Handlers (`local-lite/email`)

You can also create standalone handlers using `createEmailHandler`, `createNodemailerHandler`, or `createHttpEmailHandler`:

```typescript
import { createEmailHandler } from 'local-lite/email';

// 1. Nodemailer SMTP transport
client.actions.registerEmailHandler(
  createEmailHandler({
    transport: { host: 'smtp.sendgrid.net', port: 587, auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY } },
    defaultFrom: 'Support <support@mycompany.com>',
  })
);

// 2. HTTP delivery (e.g. Resend)
client.actions.registerEmailHandler(
  createEmailHandler({
    provider: 'resend',
    apiKey: process.env.RESEND_API_KEY,
    defaultFrom: 'onboarding@resend.dev',
  })
);

// 3. Custom internal HTTP webhook
client.actions.registerEmailHandler(
  createEmailHandler({
    endpoint: 'https://internal.corp/api/email/dispatch',
    headers: { 'X-Secret-Token': process.env.DISPATCH_SECRET },
    defaultFrom: 'notifications@internal.corp',
  })
);

// 4. Local Development Mailbox & Terminal Preview
client.actions.registerEmailHandler(
  createEmailHandler({
    provider: 'dev', // captures emails in memory and logs formatted preview table in terminal
    defaultFrom: 'dev@localhost',
  })
);
```

#### Development Mailbox (`DevMailbox`)

During local testing or unit tests, use `provider: 'dev'` or the `DevMailbox` class:

```typescript
import { DevMailbox } from 'local-lite/email';

const mailbox = new DevMailbox();
client.actions.registerEmailHandler(mailbox.createHandler());

// Enqueue and flush
await client.actions.sendEmail({ to: 'tester@test.com', subject: 'Verify Account', text: 'Code: 1234' });
await client.actions.flush();

// Inspect captured emails
const sent = mailbox.getSentEmails();
console.log('Last email sent:', mailbox.getLatestEmail()?.subject);
mailbox.clear();
```

---

## 🎨 React Email & Mobile Attachments

`local-lite/email` provides built-in rendering and attachment processing:

### React Email JSX Rendering

You can pass React Email JSX directly via the `react` property on any email action. `local-lite` automatically converts the component to responsive HTML and plaintext fallback (using `@react-email/render` or `react-dom/server`):

```tsx
import { WelcomeEmail } from './emails/Welcome';

await client.actions.sendEmail({
  to: 'user@example.com',
  subject: 'Welcome to our platform!',
  react: <WelcomeEmail name="Alex" team="Engineering" />,
});
```

### Mobile File Attachment Auto-Hydration

When running inside React Native / Expo, attachments referencing local device files (`file://`) are automatically read into memory buffers and converted for SMTP or API payloads:

```typescript
await client.actions.sendEmail({
  to: 'accounting@company.com',
  subject: 'Expense Receipt',
  text: 'Attached is the receipt from my trip.',
  attachments: [
    {
      filename: 'receipt.pdf',
      url: 'file:///var/mobile/Containers/Data/Application/.../receipt.pdf',
      contentType: 'application/pdf',
    },
  ],
});
```

---

## 🛡️ Concurrency & Rate Limiting

Prevent overwhelming email servers or hitting provider API rate limits (e.g. Resend's 10 req/sec limit or SMTP connection limits):

### Config-Level Rate Limiting

```typescript
import { createSyncClient, defineSyncConfig } from 'local-lite/config';

const client = await createSyncClient(
  defineSyncConfig({
    localOnly: true,
    actions: {
      concurrency: 5, // process up to 5 actions concurrently
      rateLimit: {
        max: 10, // maximum 10 actions
        windowMs: 1000, // per 1000ms (1 second)
      },
    },
  })
);
```

### Flush-Level Overrides

You can also override concurrency and rate limits during a manual flush:

```typescript
const result = await client.actions.flush({
  concurrency: 2,
  rateLimit: { max: 5, windowMs: 1000 },
});
```

---

## 🔒 Type-Safe Action Contracts (`defineAction`)

Define end-to-end type-safe offline actions with runtime schema validation (supports Zod, TypeBox, or custom validator functions):

```typescript
import { z } from 'zod';

const OrderPayloadSchema = z.object({
  orderId: z.string(),
  amount: z.number().positive(),
  customerEmail: z.string().email(),
});

// Define contract with schema & handler
export const submitOrder = client.actions.defineAction({
  name: 'submit_order',
  schema: OrderPayloadSchema,
  handler: async (payload, context) => {
    // payload is strictly typed: { orderId: string; amount: number; customerEmail: string }
    return await api.post('/orders', payload);
  },
});

// Enqueue with compile-time type safety and runtime validation
const action = await submitOrder({
  orderId: 'ord_987',
  amount: 49.99,
  customerEmail: 'customer@example.com',
}, {
  idempotencyKey: 'order_ord_987',
  ttlMs: 3600000,
});
```

---

## 🌐 Turnkey Email Server Endpoint (`local-lite/server`)

If you want your mobile or web app to send emails securely without exposing API keys, deploy a 1-liner relay endpoint using `createEmailEndpoint`:

```typescript
import { createEmailEndpoint } from 'local-lite/server';

// Next.js App Router (app/api/send-email/route.ts)
const emailHandler = createEmailEndpoint({
  provider: 'resend',
  apiKey: process.env.RESEND_API_KEY!,
  defaults: { from: 'Acme <noreply@acme.com>' },
  secretToken: process.env.CLIENT_SYNC_TOKEN, // optional bearer token auth
});

export const POST = emailHandler.fetchHandler;

// Express / Node.js
import express from 'express';
const app = express();
app.use(express.json());
app.post('/api/send-email', emailHandler.expressMiddleware);
```

Then configure your mobile app client to relay through it:

```typescript
defineSyncConfig({
  email: {
    provider: 'http',
    endpoint: 'https://api.yourdomain.com/api/send-email',
    headers: { Authorization: `Bearer ${process.env.CLIENT_SYNC_TOKEN}` },
  },
});
```

### Pattern 2: Cloud Function Trigger (Supabase / Convex / Firebase)

If you prefer **not** to embed API keys in your mobile or web app, do not register a local handler. The pending actions in `_local_actions` will sync to your remote backend via `local-lite`'s normal table replication:

1. **Supabase:** Configure a Postgres Database Webhook on `_local_actions` for `action = 'send_email'`. An Edge Function executes the email send and updates the record's status to `COMPLETED`.
2. **Convex:** Define a Convex action watching `_local_actions` that invokes your email provider using secure server-side environment variables.
3. **Firebase:** Attach a Cloud Function `onDocumentCreated('_local_actions/{id}')` to send the email via SendGrid/Postmark.

The updated `COMPLETED` status syncs back down to SQLite, updating your local client UI.

---

## ⚡ Generic Offline Actions

You can use the action engine for any arbitrary offline command:

```typescript
// 1. Register a handler for push notifications
client.actions.registerHandler('push_notification', async (action, context) => {
  const { deviceToken, title, body } = action.payload;
  
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: deviceToken, title, body }),
  });

  return await res.json();
});

// 2. Enqueue from anywhere in your app while offline
await client.actions.enqueue({
  action: 'push_notification',
  payload: {
    deviceToken: 'ExponentPushToken[xxxxxxxxxxxxxx]',
    title: 'New Chat Message',
    body: 'You received a message from Sarah',
  },
  idempotencyKey: 'msg_push_4812',
  ttlMs: 60 * 60 * 1000, // 1 hour TTL
});
```

---

## 🛠️ Action Management & Operations

### Manual Flush
Trigger an immediate execution of all pending actions whose handlers are registered:

```typescript
const result = await client.actions.flush();
console.log(`Processed: ${result.processed}, Completed: ${result.completed}, Failed: ${result.failed}`);
```

### Querying Actions
Query actions by ID, status, or action type:

```typescript
// Get specific action by ID
const action = await client.actions.get('action-uuid-123');

// List actions by status
const pendingEmails = await client.actions.list({
  action: 'send_email',
  status: 'PENDING',
  limit: 20,
});
```

### Cancelling an Action
Cancel a pending action before it is executed:

```typescript
const wasCancelled = await client.actions.cancel('action-uuid-123');
```

### Pruning Old Records
Clean up completed, failed, or expired action records:

```typescript
// Prune records completed more than 7 days ago
await client.actions.prune({
  completedOlderThanMs: 7 * 24 * 60 * 60 * 1000,
  failedOlderThanMs: 30 * 24 * 60 * 60 * 1000,
  expiredOlderThanMs: 24 * 60 * 60 * 1000,
});
```

---

## 🛡️ Reliability & Crash Recovery

1. **At-Most-Once Delivery (Idempotency):**
   Passing `idempotencyKey` ensures that multiple calls (e.g. from a user tapping "Submit" multiple times) return the existing action record without creating duplicate outbox rows or sending multiple emails.
2. **Crash Recovery:**
   If the mobile app is terminated or crashes while an action is `EXECUTING`, on the next app launch `client.initialize()` automatically resets stale `EXECUTING` records back to `PENDING` so they can complete safely.
3. **Automatic Retries:**
   If a handler throws an error (e.g. temporary network error or rate limit), `retry_count` is incremented. The action is marked `FAILED` only after exceeding `maxRetries`.
4. **Lifecycle Events:**
   Listen to action lifecycle events directly through `client.events`:
   ```typescript
   client.events.on('action:enqueued', (action) => console.log('Enqueued:', action.id));
   client.events.on('action:executing', (action) => console.log('Executing:', action.id));
   client.events.on('action:completed', (action) => console.log('Completed:', action.id));
   client.events.on('action:failed', (action) => console.error('Failed:', action.id, action.lastError));
   client.events.on('action:expired', (action) => console.warn('Expired without executing:', action.id));
   ```
