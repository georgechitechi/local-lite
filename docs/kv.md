# Fast Key-Value & Encrypted Preferences (`client.kv`)

`local-lite` includes a built-in, lightning-fast key-value store directly inside your SQLite database (`_local_kv`), providing zero-overhead storage for application state, user preferences, offline session flags, and zero-knowledge encrypted secrets.

---

## Features

- **Typed Storage**: Transparently handles strings, numbers, booleans, and JSON objects.
- **TTL Support**: Built-in TTL expiration (e.g., tokens expiring in 15 minutes, caches expiring in 24 hours).
- **Lazy & Immediate Cleanup**: Expired keys return `undefined` on access and are automatically purged via `client.kv.pruneExpired()`.
- **Zero-Knowledge Encrypted Preferences**: Store sensitive tokens, API credentials, and personal encryption keys using military-grade **AES-256-GCM** + **PBKDF2** encryption.
- **Cross-Platform**: Works everywhere without native dependencies on Web, Expo/React Native, and Node.js.

---

## Basic Usage

Access the store directly from your `LocalFirstClient` instance:

```typescript
// Strings
await client.kv.set('theme', 'dark');
const theme = await client.kv.get('theme'); // 'dark'

// Numbers & Booleans
await client.kv.set('retryCount', 3);
await client.kv.set('offlineMode', true);

// JSON Objects
await client.kv.set('userPreferences', {
  language: 'en-US',
  currency: 'USD',
  notifications: true,
});

const prefs = await client.kv.get('userPreferences');
console.log(prefs.currency); // 'USD'

// Check existence
const hasTheme = await client.kv.has('theme'); // true

// Delete key
await client.kv.delete('theme');

// List keys
const allKeys = await client.kv.keys();
```

---

## TTL & Expiration

```typescript
// Expire in 10 minutes (600,000 ms)
await client.kv.set('tempSessionToken', 'session_123', {
  ttlMs: 10 * 60 * 1000,
});

// Or set an absolute timestamp
await client.kv.set('flashPromo', { discount: 20 }, {
  expiresAt: Date.now() + 3600000,
});

// Prune expired entries
await client.kv.pruneExpired();
```

---

## Encrypted Preferences (AES-256-GCM)

Protect sensitive secrets, OAuth refresh tokens, and payment API keys at rest on the client:

```typescript
const userPassphrase = 'user-provided-secure-passphrase';

// Store encrypted secret
await client.kv.setSecret('stripe_config', {
  secretKey: 'sk_live_123456789',
  webhookSecret: 'whsec_abcdef',
}, {
  passphrase: userPassphrase,
});

// Decrypt secret
const stripeConfig = await client.kv.getSecret('stripe_config', userPassphrase);
console.log(stripeConfig.secretKey); // 'sk_live_123456789'
```
