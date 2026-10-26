import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';
import {
  generateApiKey,
  verifyApiKeyFormat,
  hashApiKey,
  verifyApiKey,
  createSignedToken,
  verifySignedToken,
  renewSignedToken,
} from '../src/keys/index.js';

describe('API Key Generator & Verification', () => {
  it('generates checksummed API keys with specified prefix and entropy', () => {
    const keyData = generateApiKey({
      prefix: 'prop',
      byteLength: 24,
      withChecksum: true,
    });

    expect(keyData.key.startsWith('prop_')).toBe(true);
    expect(keyData.prefix).toBe('prop');
    expect(keyData.display.startsWith('prop_...')).toBe(true);
    expect(keyData.keyHash).toHaveLength(64); // 256-bit hex hash

    // Instant syntactic & checksum format verification without DB
    expect(verifyApiKeyFormat(keyData.key)).toBe(true);
    expect(verifyApiKeyFormat(keyData.key, 'prop')).toBe(true);
    expect(verifyApiKeyFormat(keyData.key, 'wrong_prefix')).toBe(false);
  });

  it('detects tampered or corrupted API keys via checksum', () => {
    const keyData = generateApiKey({ prefix: 'sk_live' });
    expect(verifyApiKeyFormat(keyData.key)).toBe(true);

    // Tamper with middle character
    const tampered = keyData.key.slice(0, 10) + 'X' + keyData.key.slice(11);
    expect(verifyApiKeyFormat(tampered)).toBe(false);
  });

  it('verifies raw key against stored hash in constant time', () => {
    const keyData = generateApiKey({ prefix: 'client' });

    expect(verifyApiKey(keyData.key, keyData.keyHash)).toBe(true);
    expect(verifyApiKey(keyData.key, '0000000000000000000000000000000000000000000000000000000000000000')).toBe(false);
    expect(verifyApiKey('client_invalid_checksum', keyData.keyHash)).toBe(false);
  });
});

describe('Signed Tokens & Renewal (HMAC-SHA256)', () => {
  const secret = 'super-secure-app-secret-key-12345';

  it('creates, verifies, and extracts payload from signed tokens', () => {
    const payload = { businessId: 'biz_abc', role: 'manager' };
    const token = createSignedToken({
      payload,
      secret,
      expiresInMs: 3600_000, // 1 hour
    });

    const result = verifySignedToken<typeof payload>(token, secret);
    expect(result.valid).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.payload?.businessId).toBe('biz_abc');
    expect(result.payload?.role).toBe('manager');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('rejects tokens signed with a different secret or tampered content', () => {
    const token = createSignedToken({
      payload: { user: 'alice' },
      secret,
    });

    // Wrong secret
    const wrongSecretRes = verifySignedToken(token, 'different-secret');
    expect(wrongSecretRes.valid).toBe(false);
    expect(wrongSecretRes.error).toContain('Invalid token signature');

    // Tampered payload
    const parts = token.split('.');
    const tampered = `${parts[0]}.eyBkYXRhOiB7fSB9.${parts[2]}`;
    const tamperedRes = verifySignedToken(tampered, secret);
    expect(tamperedRes.valid).toBe(false);
  });

  it('detects expired signed tokens', () => {
    const token = createSignedToken({
      payload: { user: 'bob' },
      secret,
      expiresAt: Date.now() - 100_000, // expired in the past
    });

    const result = verifySignedToken(token, secret, { clockSkewSeconds: 0 });
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.error).toContain('Token expired');
  });

  it('renews valid or expired tokens with extended expiration', () => {
    const token = createSignedToken({
      payload: { tenantId: 'tenant_99' },
      secret,
      expiresInMs: 1000,
    });

    const renewed = renewSignedToken<{ tenantId: string }>(token, secret, {
      extendMs: 7 * 24 * 60 * 60 * 1000, // extend by 7 days
    });

    expect(renewed).not.toBe(token);

    const check = verifySignedToken<{ tenantId: string }>(renewed, secret);
    expect(check.valid).toBe(true);
    expect(check.payload?.tenantId).toBe('tenant_99');
    expect(check.expiresAt).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
  });
});

describe('ApiKeyManager Local SQLite Store (client.keys)', () => {
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
    });

    await client.initialize();
  });

  afterEach(() => {
    client.stop();
  });

  it('creates, stores, and verifies an API key', async () => {
    const { key, record } = await client.keys.create({
      name: 'Mobile Scanner Key',
      prefix: 'scan',
      metadata: { businessId: 'biz_500' },
    });

    expect(key.startsWith('scan_')).toBe(true);
    expect(record.name).toBe('Mobile Scanner Key');
    expect(record.prefix).toBe('scan');
    expect(record.lastUsedAt).toBeNull();
    expect(record.revoked).toBe(false);

    // Verify key
    const verification = await client.keys.verify(key);
    expect(verification.valid).toBe(true);
    expect(verification.status).toBe('VALID');
    expect(verification.record?.metadata?.businessId).toBe('biz_500');
    expect(verification.record?.lastUsedAt).toBeGreaterThan(0);
  });

  it('rejects malformed and non-existent keys', async () => {
    const malformed = await client.keys.verify('not_an_api_key');
    expect(malformed.valid).toBe(false);
    expect(malformed.status).toBe('MALFORMED');

    const fakeKey = generateApiKey({ prefix: 'scan' });
    const notFound = await client.keys.verify(fakeKey.key);
    expect(notFound.valid).toBe(false);
    expect(notFound.status).toBe('INVALID');
  });

  it('handles revocation of API keys', async () => {
    const { key, record } = await client.keys.create({
      name: 'Temporary Token',
      prefix: 'temp',
    });

    const revoked = await client.keys.revoke(record.id);
    expect(revoked).toBe(true);

    const verification = await client.keys.verify(key);
    expect(verification.valid).toBe(false);
    expect(verification.status).toBe('REVOKED');
  });

  it('handles expired API keys', async () => {
    const { key } = await client.keys.create({
      name: 'Expired Key',
      prefix: 'exp',
      expiresAt: Date.now() - 5000, // expired 5s ago
    });

    const verification = await client.keys.verify(key);
    expect(verification.valid).toBe(false);
    expect(verification.status).toBe('EXPIRED');
  });

  it('lists and prunes API keys', async () => {
    const { record: r1 } = await client.keys.create({ name: 'Key 1', prefix: 'app' });
    const { record: r2 } = await client.keys.create({ name: 'Key 2', prefix: 'app' });

    const all = await client.keys.list();
    expect(all.length).toBeGreaterThanOrEqual(2);

    await client.keys.revoke(r1.id);

    // Prune revoked
    await client.keys.prune({ revokedOlderThanMs: 0 });

    const remaining = await client.keys.list();
    expect(remaining.some((k) => k.id === r1.id)).toBe(false);
    expect(remaining.some((k) => k.id === r2.id)).toBe(true);
  });
});
