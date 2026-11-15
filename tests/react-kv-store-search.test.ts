import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';
import { useKVStore, useSearch } from '../src/react/index.js';

describe('React hooks: useKVStore and useSearch', () => {
  let db: MockDB;
  let client: LocalFirstClient;

  beforeEach(async () => {
    db = new MockDB();
    client = new LocalFirstClient({
      local: db,
      remote: new MemoryDemoRemoteAdapter(0),
      network: new DefaultNetworkStatusProvider(true),
      autoStart: false,
    });
    await client.initialize();
  });

  afterEach(() => {
    client.stop();
  });

  it('exports useKVStore and useSearch functions correctly', () => {
    expect(typeof useKVStore).toBe('function');
    expect(typeof useSearch).toBe('function');
  });

  it('client.reset({ includeInternal: true }) purges both user and internal tables', async () => {
    await client.kvStore.set('savedPref', 'dark');
    expect(await client.kvStore.get('savedPref')).toBe('dark');

    // Reset without includeInternal keeps KVStore
    await client.reset({ includeInternal: false });
    expect(await client.kvStore.get('savedPref')).toBe('dark');

    // Reset with includeInternal purges KVStore
    await client.reset({ includeInternal: true });
    expect(await client.kvStore.get('savedPref')).toBeUndefined();
  });

  it('DatabaseMaintenance includes internal stores in known tables', () => {
    const knownTables = (client.maintenance as any).getKnownTables();
    expect(knownTables).toContain('_local_kv_store');
    expect(knownTables).toContain('_local_blobs');
    expect(knownTables).toContain('_local_scheduled_jobs');
    expect(knownTables).toContain('_local_api_keys');
  });
});
