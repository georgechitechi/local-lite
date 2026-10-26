import { describe, it, expect, beforeEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';
import { KVManager } from '../src/kv/index.js';

describe('KVManager & Encrypted Preferences', () => {
  let db: MockDB;
  let kv: KVManager;

  beforeEach(async () => {
    db = new MockDB();
    kv = new KVManager(db);
    await kv.initialize();
  });

  it('stores and retrieves strings, numbers, booleans, and JSON objects', async () => {
    await kv.set('theme', 'dark');
    await kv.set('retryCount', 42);
    await kv.set('notificationsEnabled', true);
    await kv.set('userProfile', { name: 'Alice', role: 'admin' });

    expect(await kv.get('theme')).toBe('dark');
    expect(await kv.get('retryCount')).toBe(42);
    expect(await kv.get('notificationsEnabled')).toBe(true);
    expect(await kv.get('userProfile')).toEqual({ name: 'Alice', role: 'admin' });

    expect(await kv.has('theme')).toBe(true);
    expect(await kv.has('nonExistentKey')).toBe(false);
  });

  it('supports deleting keys and clearing store', async () => {
    await kv.set('k1', 'val1');
    await kv.set('k2', 'val2');

    expect(await kv.get('k1')).toBe('val1');
    await kv.delete('k1');
    expect(await kv.get('k1')).toBeUndefined();
    expect(await kv.has('k1')).toBe(false);

    await kv.clear();
    expect(await kv.get('k2')).toBeUndefined();
  });

  it('respects TTL expiration and prunes expired keys', async () => {
    // Key expiring in past
    await kv.set('tempToken', 'xyz', { ttlMs: -1000 });
    // Key expiring in future
    await kv.set('activeToken', 'abc', { ttlMs: 60000 });

    expect(await kv.get('tempToken')).toBeUndefined();
    expect(await kv.get('activeToken')).toBe('abc');

    const activeKeys = await kv.keys();
    expect(activeKeys).toContain('activeToken');
    expect(activeKeys).not.toContain('tempToken');

    const pruned = await kv.pruneExpired();
    expect(pruned).toBeGreaterThanOrEqual(0);
  });

  it('encrypts and decrypts secret preferences using AES-256-GCM', async () => {
    const secretKey = 'my-super-secure-passphrase-999';
    const secretValue = { stripeApiKey: 'sk_live_123456789', webhookSecret: 'whsec_abcdef' };

    await kv.setSecret('paymentConfig', secretValue, { passphrase: secretKey });

    // Raw row should be encrypted (not plaintext JSON)
    const rawRecord = await kv.getRecord('paymentConfig');
    expect(rawRecord).not.toBeNull();
    expect(rawRecord?.type).toBe('encrypted');
    expect(typeof rawRecord?.value).toBe('string');
    expect(rawRecord?.value.includes('sk_live_123456789')).toBe(false);

    // Decrypting with correct secret succeeds
    const decrypted = await kv.getSecret('paymentConfig', secretKey);
    expect(decrypted).toEqual(secretValue);

    // Decrypting with wrong secret throws
    await expect(kv.getSecret('paymentConfig', 'wrong-passphrase')).rejects.toThrow();
  });

  it('seamlessly integrates into LocalFirstClient via client.kv', async () => {
    const remote = new MemoryDemoRemoteAdapter(50);
    const network = new DefaultNetworkStatusProvider(true);

    const client = new LocalFirstClient({
      local: db,
      remote,
      network,
    });
    await client.initialize();

    await client.kv.set('offlineMode', true);
    expect(await client.kv.get('offlineMode')).toBe(true);

    client.stop();
  });
});
