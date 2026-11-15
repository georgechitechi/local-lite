import { describe, it, expect, beforeEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';
import { KVStoreManager } from '../src/kv-store/index.js';

describe('KVStoreManager & Encrypted Preferences', () => {
  let db: MockDB;
  let kvStore: KVStoreManager;

  beforeEach(async () => {
    db = new MockDB();
    kvStore = new KVStoreManager(db);
    await kvStore.initialize();
  });

  it('stores and retrieves strings, numbers, booleans, and JSON objects', async () => {
    await kvStore.set('theme', 'dark');
    await kvStore.set('retryCount', 42);
    await kvStore.set('notificationsEnabled', true);
    await kvStore.set('userProfile', { name: 'Alice', role: 'admin' });

    expect(await kvStore.get('theme')).toBe('dark');
    expect(await kvStore.get('retryCount')).toBe(42);
    expect(await kvStore.get('notificationsEnabled')).toBe(true);
    expect(await kvStore.get('userProfile')).toEqual({
      name: 'Alice',
      role: 'admin',
    });

    expect(await kvStore.has('theme')).toBe(true);
    expect(await kvStore.has('nonExistentKey')).toBe(false);
  });

  it('supports deleting keys and clearing store', async () => {
    await kvStore.set('k1', 'val1');
    await kvStore.set('k2', 'val2');

    expect(await kvStore.get('k1')).toBe('val1');
    await kvStore.delete('k1');
    expect(await kvStore.get('k1')).toBeUndefined();
    expect(await kvStore.has('k1')).toBe(false);

    await kvStore.clear();
    expect(await kvStore.get('k2')).toBeUndefined();
  });

  it('respects TTL expiration and prunes expired keys', async () => {
    // Key expiring in past
    await kvStore.set('tempToken', 'xyz', { ttlMs: -1000 });
    // Key expiring in future
    await kvStore.set('activeToken', 'abc', { ttlMs: 60000 });

    expect(await kvStore.get('tempToken')).toBeUndefined();
    expect(await kvStore.get('activeToken')).toBe('abc');

    const activeKeys = await kvStore.keys();
    expect(activeKeys).toContain('activeToken');
    expect(activeKeys).not.toContain('tempToken');

    const pruned = await kvStore.pruneExpired();
    expect(pruned).toBeGreaterThanOrEqual(0);
  });

  it('encrypts and decrypts secret preferences using AES-256-GCM', async () => {
    const secretKey = 'my-super-secure-passphrase-999';
    const secretValue = {
      stripeApiKey: 'sk_live_123456789',
      webhookSecret: 'whsec_abcdef',
    };

    await kvStore.setSecret('paymentConfig', secretValue, {
      passphrase: secretKey,
    });

    // Raw row should be encrypted (not plaintext JSON)
    const rawRecord = await kvStore.getRecord('paymentConfig');
    expect(rawRecord).not.toBeNull();
    expect(rawRecord?.type).toBe('encrypted');
    expect(typeof rawRecord?.value).toBe('string');
    expect(rawRecord?.value.includes('sk_live_123456789')).toBe(false);

    // Decrypting with correct secret succeeds
    const decrypted = await kvStore.getSecret('paymentConfig', secretKey);
    expect(decrypted).toEqual(secretValue);

    // Decrypting with wrong secret throws
    await expect(
      kvStore.getSecret('paymentConfig', 'wrong-passphrase'),
    ).rejects.toThrow();
  });

  it('seamlessly integrates into LocalFirstClient via client.kvStore', async () => {
    const remote = new MemoryDemoRemoteAdapter(50);
    const network = new DefaultNetworkStatusProvider(true);

    const client = new LocalFirstClient({
      local: db,
      remote,
      network,
    });
    await client.initialize();

    await client.kvStore.set('offlineMode', true);
    expect(await client.kvStore.get('offlineMode')).toBe(true);

    client.stop();
  });
});
