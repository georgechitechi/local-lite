import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { MockDB } from './helpers/mock-db.js';

describe('Advanced Query Operators', () => {
  let db: MockDB;
  let remote: MemoryDemoRemoteAdapter;
  let client: LocalFirstClient;

  beforeEach(async () => {
    db = new MockDB();
    remote = new MemoryDemoRemoteAdapter(50);

    client = new LocalFirstClient({
      local: db,
      remote,
    });

    await client.initialize();

    // Seed test data
    await client.batch([
      { tableName: 'products', rowId: 'p-1', operation: 'INSERT', payload: { id: 'p-1', title: 'iPhone 15 Pro', price: 999, category: 'electronics', tag: 'flagship', rating: 4.8 } },
      { tableName: 'products', rowId: 'p-2', operation: 'INSERT', payload: { id: 'p-2', title: 'MacBook Air M3', price: 1099, category: 'computers', tag: 'laptop', rating: 4.9 } },
      { tableName: 'products', rowId: 'p-3', operation: 'INSERT', payload: { id: 'p-3', title: 'AirPods Pro', price: 249, category: 'audio', tag: 'earbuds', rating: 4.6 } },
      { tableName: 'products', rowId: 'p-4', operation: 'INSERT', payload: { id: 'p-4', title: 'USB-C Cable', price: 19, category: 'accessories', tag: null, rating: 4.0 } },
      { tableName: 'products', rowId: 'p-5', operation: 'INSERT', payload: { id: 'p-5', title: 'Magic Mouse', price: 79, category: 'accessories', tag: 'mouse', rating: 3.8 } },
    ]);
  });

  afterEach(() => {
    client.stop();
  });

  it('supports comparison operators: $gt, $gte, $lt, $lte, $ne', async () => {
    const expensive = await client.findMany('products', {
      where: { price: { $gte: 999 } },
    });
    expect(expensive).toHaveLength(2);
    expect(expensive.map((p) => p.id)).toEqual(expect.arrayContaining(['p-1', 'p-2']));

    const cheap = await client.findMany('products', {
      where: { price: { $lt: 100 } },
    });
    expect(cheap).toHaveLength(2);
    expect(cheap.map((p) => p.id)).toEqual(expect.arrayContaining(['p-4', 'p-5']));

    const nonAudio = await client.findMany('products', {
      where: { category: { $ne: 'audio' } },
    });
    expect(nonAudio).toHaveLength(4);
  });

  it('supports array membership operators: $in and $nin', async () => {
    const selected = await client.findMany('products', {
      where: { category: { $in: ['electronics', 'computers'] } },
    });
    expect(selected).toHaveLength(2);

    const excluded = await client.findMany('products', {
      where: { category: { $nin: ['electronics', 'computers', 'accessories'] } },
    });
    expect(excluded).toHaveLength(1);
    expect(excluded[0].id).toBe('p-3');
  });

  it('supports string pattern operators: $contains, $startsWith, $endsWith', async () => {
    const pros = await client.findMany('products', {
      where: { title: { $contains: 'pro' } },
    });
    expect(pros).toHaveLength(2);
    expect(pros.map((p) => p.id)).toEqual(expect.arrayContaining(['p-1', 'p-3']));

    const macs = await client.findMany('products', {
      where: { title: { $startsWith: 'mac' } },
    });
    expect(macs).toHaveLength(1);
    expect(macs[0].id).toBe('p-2');

    const cables = await client.findMany('products', {
      where: { title: { $endsWith: 'cable' } },
    });
    expect(cables).toHaveLength(1);
    expect(cables[0].id).toBe('p-4');
  });

  it('supports $null operator', async () => {
    const untagged = await client.findMany('products', {
      where: { tag: { $null: true } },
    });
    expect(untagged).toHaveLength(1);
    expect(untagged[0].id).toBe('p-4');

    const tagged = await client.findMany('products', {
      where: { tag: { $null: false } },
    });
    expect(tagged).toHaveLength(4);
  });

  it('supports logical combinators: $or and $and', async () => {
    const orMatches = await client.findMany('products', {
      where: {
        $or: [
          { price: { $gte: 1000 } },
          { tag: 'earbuds' },
        ],
      },
    });
    expect(orMatches).toHaveLength(2);
    expect(orMatches.map((p) => p.id)).toEqual(expect.arrayContaining(['p-2', 'p-3']));

    const andMatches = await client.findMany('products', {
      where: {
        $and: [
          { price: { $lt: 500 } },
          { rating: { $gte: 4.5 } },
        ],
      },
    });
    expect(andMatches).toHaveLength(1);
    expect(andMatches[0].id).toBe('p-3');
  });

  it('supports top-level function predicates', async () => {
    const filtered = await client.findMany('products', {
      where: (row) => row.price > 100 && row.rating >= 4.8,
    });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((p) => p.id)).toEqual(expect.arrayContaining(['p-1', 'p-2']));
  });
});
