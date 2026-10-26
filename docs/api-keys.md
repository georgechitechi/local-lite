# 🔐 API Keys & Signed Tokens Wrapper

`local-lite` provides a zero-dependency **API Key & Signed Token toolkit** for generating, verifying, hashing, and renewing keys and tokens. It does not replace your primary authentication (e.g. Supabase Auth, Google, Microsoft), but provides utilities for issuing developer API keys, tenant scanner keys, mobile session tokens, or signed renewal tokens.

---

## ⚡ 1. Generating & Verifying Checksummed API Keys

Modern API keys (like GitHub `ghp_...` or Stripe `sk_live_...`) contain embedded checksums so their authenticity and integrity can be verified instantaneously without querying a database.

```typescript
import { generateApiKey, verifyApiKey, verifyApiKeyFormat } from 'local-lite/keys';

// 1. Generate an API key
const { key, keyHash, prefix, display } = generateApiKey({
  prefix: 'prop',       // Output: prop_x7A9..._c4f910e2
  byteLength: 24,       // 192 bits of cryptographically secure entropy
  withChecksum: true,   // Appends a 4-byte checksum
});

console.log('Plaintext Key (show to user once):', key);
console.log('Key Hash (safe to store in SQLite/Postgres):', keyHash);
console.log('Display Mask:', display); // e.g. "prop_...10e2"

// 2. Instant syntactic & checksum check (no DB required)
const isFormatValid = verifyApiKeyFormat(incomingKey, 'prop');

// 3. Cryptographic timing-safe verification against stored SHA-256 hash
const isValid = verifyApiKey(incomingKey, storedHash);
```

---

## ✍️ 2. Signed Tokens & Renewal (HMAC-SHA256)

For self-contained tokens that embed data (such as `{ businessId, role }`), expiration dates, and renewal capabilities without needing database lookups:

```typescript
import { createSignedToken, verifySignedToken, renewSignedToken } from 'local-lite/keys';

const SECRET = process.env.API_SIGNING_SECRET || 'your-secure-secret';

// 1. Create a signed token with expiration
const token = createSignedToken({
  payload: { businessId: 'biz_123', role: 'admin' },
  secret: SECRET,
  expiresInMs: 7 * 24 * 60 * 60 * 1000, // 7 days
});

// 2. Verify token signature and check expiration
const verification = verifySignedToken(token, SECRET);
if (verification.valid) {
  console.log('Authorized Payload:', verification.payload);
  console.log('Expires at:', new Date(verification.expiresAt!).toISOString());
} else if (verification.expired) {
  console.warn('Token expired at:', verification.expiresAt);
}

// 3. Renew an existing token (extends expiration with a fresh HMAC signature)
const renewedToken = renewSignedToken(token, SECRET, {
  extendMs: 7 * 24 * 60 * 60 * 1000,
});
```

---

## 💾 3. SQLite Key Manager (`client.keys.*`)

`local-lite` includes an optional SQLite store (`_local_api_keys`) managed directly via `client.keys`:

### Creating a Key
```typescript
const { key, record } = await client.keys.create({
  name: 'Mobile Property Scanner',
  prefix: 'scan',
  expiresInMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  metadata: { businessId: 'biz_99', device: 'iPad Warehouse 1' },
});

// Returns the raw key to show once, while persisting the SHA-256 hash to SQLite
```

### Verifying a Key
```typescript
const result = await client.keys.verify(incomingKey);

if (result.valid) {
  console.log('Key is active for business:', result.record.metadata.businessId);
  // Automatically stamps record.last_used_at in SQLite
} else {
  console.error('Key verification failed:', result.status, result.error);
  // status: 'INVALID' | 'EXPIRED' | 'REVOKED' | 'MALFORMED'
}
```

### Revoking, Listing & Pruning
```typescript
// Revoke a compromised or deactivated key
await client.keys.revoke(keyId);

// List active or revoked keys
const keys = await client.keys.list({ revoked: false });

// Prune old revoked keys
await client.keys.prune({ revokedOlderThanMs: 30 * 24 * 60 * 60 * 1000 });
```

---

## 🔒 Security Guarantees

* **Timing-Safe Comparison:** Hash and signature comparisons use constant-time operations (`timingSafeEqual`) to prevent side-channel timing attacks.
* **Plaintext Safety:** Plaintext keys are never stored by `ApiKeyManager`; only SHA-256 digests are written to disk.
* **Tamper-Evident:** Signed tokens are signed using HMAC-SHA256 (`@noble/hashes`); any payload alteration invalidates the signature immediately.
