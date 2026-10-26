import { describe, it, expect, beforeEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';
import { SearchManager } from '../src/search/index.js';

describe('SearchManager & FTS Full-Text Search', () => {
  let db: MockDB;
  let search: SearchManager;

  beforeEach(() => {
    db = new MockDB();
    search = new SearchManager(db);
  });

  it('creates FTS index, indexes records, and performs match queries', async () => {
    await search.createIndex({
      table: 'properties',
      columns: ['title', 'address', 'description'],
    });

    await search.indexRecord('properties', 'prop-1', {
      title: 'Luxury Sunset Villa',
      address: '100 Ocean Drive, Miami',
      description: 'Stunning 4-bedroom beachfront property with private pool',
    });

    await search.indexRecord('properties', 'prop-2', {
      title: 'Downtown Modern Loft',
      address: '450 Broadway, New York',
      description: 'Chic urban apartment close to metro station',
    });

    // Query for "beachfront"
    const results = await search.query('properties', 'beachfront');
    expect(results).toHaveLength(1);
    expect(results[0].rowId).toBe('prop-1');
    expect(results[0].snippet).toContain('beachfront');

    // Query for "urban"
    const loftResults = await search.query('properties', 'urban');
    expect(loftResults).toHaveLength(1);
    expect(loftResults[0].rowId).toBe('prop-2');
  });

  it('removes records from search index', async () => {
    await search.createIndex({
      table: 'tenants',
      columns: ['name', 'email', 'notes'],
    });

    await search.indexRecord('tenants', 't-1', {
      name: 'John Doe',
      email: 'john@example.com',
      notes: 'Paid deposit in full',
    });

    expect(await search.query('tenants', 'John')).toHaveLength(1);

    await search.removeRecord('tenants', 't-1');
    expect(await search.query('tenants', 'John')).toHaveLength(0);
  });

  it('rebuilds search index in bulk', async () => {
    await search.createIndex({
      table: 'maintenance',
      columns: ['issue', 'priority'],
    });

    const items = [
      { id: 'm-1', issue: 'Leaking kitchen pipe', priority: 'HIGH' },
      { id: 'm-2', issue: 'Broken air conditioner', priority: 'URGENT' },
      { id: 'm-3', issue: 'Replace hallway lightbulb', priority: 'LOW' },
    ];

    await search.rebuildIndex('maintenance', items);

    const leakMatches = await search.query('maintenance', 'kitchen');
    expect(leakMatches).toHaveLength(1);
    expect(leakMatches[0].rowId).toBe('m-1');
  });

  it('integrates with LocalFirstClient and drops index cleanly', async () => {
    const remote = new MemoryDemoRemoteAdapter(50);
    const network = new DefaultNetworkStatusProvider(true);

    const client = new LocalFirstClient({
      local: db,
      remote,
      network,
    });
    await client.initialize();

    await client.search.createIndex({
      table: 'tasks',
      columns: ['title'],
    });

    expect(client.search.getIndexedTables()).toContain('tasks');
    await client.search.dropIndex('tasks');
    expect(client.search.getIndexedTables()).not.toContain('tasks');

    client.stop();
  });
});
