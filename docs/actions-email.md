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
| `attachments` | `EmailAttachment[]` | Array of `{ filename, content?, url?, contentType? }`. |
| `headers` | `Record<string, string>` | Optional custom MIME headers. |
| `idempotencyKey` | `string` | Unique key preventing duplicate action execution. |
| `ttlMs` | `number` | Expiration window in milliseconds from time of enqueuing. |
| `expiresAt` | `number` | Explicit Unix timestamp (ms) when the action expires. |
| `maxRetries` | `number` | Maximum delivery attempts before marking as `FAILED` (default: `3`). |

---

## 🚀 Dispatching Emails

There are two primary patterns for executing enqueued email actions:

### Pattern 1: Local Dispatcher via Provider API (Resend, SendGrid, etc.)

Register a local handler that triggers whenever the device is online and flushes pending emails:

```typescript
// Register handler (e.g. in your app initialization)
client.actions.registerEmailHandler(async (email, action, context) => {
  // Call your email delivery service (e.g., Resend)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: email.from || 'Acme <onboarding@resend.dev>',
      to: email.to,
      subject: email.subject,
      html: email.html,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to dispatch email');
  }

  const data = await response.json();
  // Return result to store receipt in SQLite
  return { messageId: data.id };
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
