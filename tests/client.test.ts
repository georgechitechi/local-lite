import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';

describe('LocalFirstClient Core', () => {
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

  it('performs atomic dual-writes: mutates local table and appends to sync_outbox', async () => {
    await client.mutate('todos', 'todo-1', 'INSERT', {
      title: 'Buy Milk',
      completed: 0,
    });

    const localRows = db.getAll('todos');
    expect(localRows).toHaveLength(1);
    expect(localRows[0]).toEqual({
      id: 'todo-1',
      title: 'Buy Milk',
      completed: 0,
    });

    const outboxRows = db.getAll('sync_outbox');
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].table_name).toBe('todos');
    expect(outboxRows[0].row_id).toBe('todo-1');
    expect(outboxRows[0].operation).toBe('INSERT');
  });

  it('automatically triggers debounced push and clears outbox after remote push', async () => {
    await client.insert('todos', {
      id: 'todo-2',
      title: 'Walk the dog',
      completed: 0,
    });

    // Wait for the push interval/debounce to execute
    await new Promise((resolve) => setTimeout(resolve, 150));

    // The remote mock should have received the batch
    expect(remote.pushedBatches.length).toBeGreaterThan(0);
    const lastBatch = remote.pushedBatches[remote.pushedBatches.length - 1];
    expect(lastBatch[0].rowId).toBe('todo-2');

    // The local outbox should be cleared
    const outboxPending = db.getAll('sync_outbox');
    expect(outboxPending).toHaveLength(0);
  });

  it('provides convenience CRUD methods (insert, update, delete)', async () => {
    // 1. insert with auto-generated UUID
    const id = await client.insert('todos', { title: 'Auto UUID Item' });
    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(10);

    // 2. update
    await client.update('todos', id, { completed: 1 });
    const updated = await client.findById('todos', id);
    expect(updated?.completed).toBe(1);

    // 3. delete
    await client.delete('todos', id);
    const deleted = await client.findById('todos', id);
    expect(deleted).toBeNull();
  });

  it('provides zero-SQL declarative queries via findMany and findById', async () => {
    await client.insert('items', { id: 'item-1', name: 'Zebra', category: 'animals' });
    await client.insert('items', { id: 'item-2', name: 'Apple', category: 'fruits' });
    await client.insert('items', { id: 'item-3', name: 'Banana', category: 'fruits' });

    // Full table read
    const all = await client.findMany('items');
    expect(all).toHaveLength(3);

    // Filtered
    const fruits = await client.findMany('items', { where: { category: 'fruits' } });
    expect(fruits).toHaveLength(2);

    // Sorted
    const sorted = await client.findMany('items', { orderBy: 'name', order: 'asc' });
    expect(sorted[0].name).toBe('Apple');
    expect(sorted[1].name).toBe('Banana');
    expect(sorted[2].name).toBe('Zebra');

    // Find by ID
    const single = await client.findById('items', 'item-2');
    expect(single?.name).toBe('Apple');

    // Find by multiple IDs
    const multiple = await client.findByIds('items', ['item-1', 'item-2']);
    expect(multiple).toHaveLength(2);
    expect(multiple.map((m: any) => m.name)).toEqual(['Zebra', 'Apple']);

    // updateMany batch updates
    await client.updateMany('items', [
      { id: 'item-1', payload: { category: 'organic-fruit' } },
      { id: 'item-2', payload: { category: 'organic-fruit' } },
    ]);
    const updated = await client.findByIds('items', ['item-1', 'item-2']);
    expect(updated[0].category).toBe('organic-fruit');
    expect(updated[1].category).toBe('organic-fruit');
  });

  it('emits reactive table change events on mutation', async () => {
    let receivedEvent: any = null;
    const unsubscribe = client.events.on('todos', (event) => {
      receivedEvent = event;
    });

    await client.insert('todos', { id: 'evt-1', title: 'Reactive Todo' });

    expect(receivedEvent).toBeDefined();
    expect(receivedEvent.operation).toBe('INSERT');
    expect(receivedEvent.rowId).toBe('evt-1');
    expect(receivedEvent.source).toBe('local');

    unsubscribe();
  });

  it('resets tables and sync cursor with client.reset()', async () => {
    client.tables = ['todos'];
    await client.insert('todos', { id: 'reset-1', title: 'Before Reset' });
    expect(await client.findById('todos', 'reset-1')).toBeDefined();

    let resetEventFired = false;
    client.events.on('reset', () => {
      resetEventFired = true;
    });

    await client.reset();

    expect(resetEventFired).toBe(true);
    const after = await client.findById('todos', 'reset-1');
    expect(after).toBeNull();
  });

  it('stops worker and releases database with client.close()', async () => {
    let closed = false;
    (db as any).close = () => {
      closed = true;
    };

    await client.close();
    expect(closed).toBe(true);
  });
});
