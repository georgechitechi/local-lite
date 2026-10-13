import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';

describe('LocalFirstClient Batch & Transactions', () => {
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
      pushIntervalMs: 500,
      pullIntervalMs: 1000,
    });

    await client.initialize();
  });

  afterEach(() => {
    client.stop();
  });

  it('client.batch atomically executes multiple mutations across tables', async () => {
    const eventsReceived: string[] = [];
    client.events.on('properties', () => eventsReceived.push('properties'));
    client.events.on('tenants', () => eventsReceived.push('tenants'));

    const ids = await client.batch([
      {
        tableName: 'properties',
        rowId: 'prop-1',
        operation: 'INSERT',
        payload: { id: 'prop-1', name: 'Oceanview Condo', rent: 2500 },
      },
      {
        tableName: 'tenants',
        rowId: 'ten-1',
        operation: 'INSERT',
        payload: { id: 'ten-1', name: 'Alice Smith', property_id: 'prop-1' },
      },
    ]);

    expect(ids).toEqual(['prop-1', 'ten-1']);

    // Check local database
    const props = db.getAll('properties');
    const tenants = db.getAll('tenants');
    expect(props).toHaveLength(1);
    expect(tenants).toHaveLength(1);
    expect(props[0].name).toBe('Oceanview Condo');
    expect(tenants[0].name).toBe('Alice Smith');

    // Check events emitted
    expect(eventsReceived).toContain('properties');
    expect(eventsReceived).toContain('tenants');

    // Wait for debounced push
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(remote.pushedBatches.length).toBeGreaterThan(0);
    const lastBatch = remote.pushedBatches[remote.pushedBatches.length - 1];
    expect(lastBatch.map((o) => o.rowId)).toContain('prop-1');
    expect(lastBatch.map((o) => o.rowId)).toContain('ten-1');
  });

  it('client.insertMany bulk-inserts multiple items atomically', async () => {
    const ids = await client.insertMany('todos', [
      { title: 'Task A', completed: 0 },
      { title: 'Task B', completed: 1 },
      { title: 'Task C', completed: 0 },
    ]);

    expect(ids).toHaveLength(3);
    const todos = await client.findMany('todos');
    expect(todos).toHaveLength(3);
    expect(todos.map((t) => t.title)).toEqual(
      expect.arrayContaining(['Task A', 'Task B', 'Task C'])
    );
  });

  it('client.transaction commits operations and emits events on success', async () => {
    let emitted = false;
    client.events.on('invoices', () => {
      emitted = true;
    });

    const result = await client.transaction(async (tx) => {
      const invId = await tx.insert('invoices', { amount: 500, status: 'DRAFT' });
      await tx.update('invoices', invId, { status: 'PAID' });
      return invId;
    });

    expect(result).toBeDefined();
    expect(emitted).toBe(true);

    const invoice = await client.findById('invoices', result);
    expect(invoice?.status).toBe('PAID');
    expect(invoice?.amount).toBe(500);
  });

  it('client.transaction rolls back and emits zero events when an error is thrown', async () => {
    let eventFired = false;
    client.events.on('accounts', () => {
      eventFired = true;
    });

    await expect(
      client.transaction(async (tx) => {
        await tx.insert('accounts', 'acc-1', { balance: 100 });
        throw new Error('Simulated transaction failure');
      })
    ).rejects.toThrow('Simulated transaction failure');

    // Events should not fire
    expect(eventFired).toBe(false);

    // Outbox should not contain the aborted mutation
    const outbox = db.getAll('sync_outbox');
    expect(outbox.filter((r) => r.row_id === 'acc-1')).toHaveLength(0);
  });
});
