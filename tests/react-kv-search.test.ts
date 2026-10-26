import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';
import { useKV, useSearch } from '../src/react/index.js';

describe('React hooks: useKV and useSearch', () => {
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

  it('exports useKV and useSearch functions correctly', () => {
    expect(typeof useKV).toBe('function');
    expect(typeof useSearch).toBe('function');
  });

  it('client.reset({ includeInternal: true }) purges both user and internal tables', async () => {
    await client.kv.set('savedPref', 'dark');
    expect(await client.kv.get('savedPref')).toBe('dark');

    // Reset without includeInternal keeps KV
    await client.reset({ includeInternal: false });
    expect(await client.kv.get('savedPref')).toBe('dark');

    // Reset with includeInternal purges KV
    await client.reset({ includeInternal: true });
    expect(await client.kv.get('savedPref')).toBeUndefined();
  });

  it('DatabaseMaintenance includes internal stores in known tables', () => {
    const knownTables = (client.maintenance as any).getKnownTables();
    expect(knownTables).toContain('_local_kv');
    expect(knownTables).toContain('_local_blobs');
    expect(knownTables).toContain('_local_scheduled_jobs');
    expect(knownTables).toContain('_local_api_keys');
  });
});
