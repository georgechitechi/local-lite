---
name: local-lite-offline-actions
description: Queue offline actions, schedule background jobs, store key-value preferences, and track sync telemetry in local-lite. Use when using client.actions, client.scheduler, client.kv, client.getMetrics(), or handling offline mutation retries.
---

# local-lite Offline Actions, KV & Scheduler

Guide for executing queued actions, running background jobs, persisting key-value pairs, and inspecting sync telemetry with `local-lite`.

---

## 1. Action Manager & Outbox (`client.actions`)

The Action Manager handles complex business logic mutations that must be queued offline and executed reliably when connectivity is restored:

### Enqueueing an Action
```typescript
import { getSyncClient } from './sync.config';

const client = await getSyncClient();

// Enqueue an action (e.g. sending an email, processing a payment, or syncing with third-party API)
const action = await client.actions.enqueue({
  type: 'SEND_INVITATION',
  payload: {
    inviteeEmail: 'colleague@example.com',
    teamId: 'team_xyz',
  },
  maxRetries: 5,
  retryDelayMs: 2000,
});

console.log('Queued action:', action.id, action.status);
```

### Registering Action Handlers
Register handlers that execute when the device is online:

```typescript
client.actions.registerHandler('SEND_INVITATION', async (payload) => {
  const res = await fetch('https://api.example.com/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Invitation failed with status ${res.status}`);
  }

  return await res.json();
});
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

