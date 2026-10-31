import { afterEach, describe, expect, it } from 'vitest';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { LocalFirstClient } from '../src/core/client.js';
import { MockDB } from './helpers/mock-db.js';

describe('relationship delete actions', () => {
  const clients: LocalFirstClient[] = [];

  function createClient(
    relationships: NonNullable<ConstructorParameters<typeof LocalFirstClient>[0]['relationships']>,
    tables = ['parents', 'children', 'grandchildren']
  ) {
    const client = new LocalFirstClient({
      local: new MockDB(),
      remote: new MemoryDemoRemoteAdapter(0),
      network: new DefaultNetworkStatusProvider(false),
      autoStart: false,
      tables,
      relationships,
    });
    clients.push(client);
    return client;
  }

  afterEach(() => {
    clients.splice(0).forEach((client) => client.stop());
  });

  it('rejects a delete when a restrict relationship exists, even after a cascade branch', async () => {
    const client = createClient([
      { table: 'children', foreignKey: 'parentId', references: 'parents', onDelete: 'cascade' },
      { table: 'grandchildren', foreignKey: 'parentId', references: 'parents', onDelete: 'restrict' },
    ]);
    await client.insert('parents', { id: 'p1' });
    await client.insert('children', { id: 'c1', parentId: 'p1' });
    await client.insert('grandchildren', { id: 'g1', parentId: 'p1' });

    await expect(client.delete('parents', 'p1')).rejects.toThrow(/still reference it/);
  });

  it('handles a cascade graph with two paths to the same child once', async () => {
    const client = createClient([
      { table: 'children', foreignKey: 'parentId', references: 'parents', onDelete: 'cascade' },
      { table: 'grandchildren', foreignKey: 'childId', references: 'children', onDelete: 'cascade' },
      { table: 'grandchildren', foreignKey: 'rootId', references: 'parents', onDelete: 'cascade' },
    ]);
    await client.insert('parents', { id: 'p1' });
    await client.insert('children', { id: 'c1', parentId: 'p1' });
    await client.insert('grandchildren', { id: 'g1', childId: 'c1', rootId: 'p1' });

    await client.delete('parents', 'p1');

    expect(await client.findById('parents', 'p1')).toBeNull();
    expect(await client.findById('children', 'c1')).toBeNull();
    expect(await client.findById('grandchildren', 'g1')).toBeNull();
  });

  it('rejects relationships that reference tables outside the configured sync tables', () => {
    expect(() => createClient([
      { table: 'children', foreignKey: 'parentId', references: 'parents', onDelete: 'cascade' },
    ], ['parents'])).toThrow(/must be included in config\.tables/);
  });

  it('rejects duplicate child foreign-key definitions', () => {
    expect(() => createClient([
      { table: 'children', foreignKey: 'parentId', references: 'parents', onDelete: 'cascade' },
      { table: 'children', foreignKey: 'parentId', references: 'parents', onDelete: 'setNull' },
    ])).toThrow(/Duplicate relationship/);
  });
});
