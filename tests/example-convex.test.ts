import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';

// Exercise the deployed handlers with a small indexed database double.
function database() {
  const tables = new Map<string, any[]>();
  let nextId = 0;
  const rows = (table: string) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  };
  return {
    query(table: string) {
      const predicates: ((row: any) => boolean)[] = [];
      const range = {
        eq(key: string, value: any) { predicates.push(row => row[key] === value); return range; },
        gt(key: string, value: number) { predicates.push(row => row[key] > value); return range; },
      };
      const query = {
        withIndex(_name: string, build: (range: any) => void) { build(range); return query; },
        async collect() { return rows(table).filter(row => predicates.every(predicate => predicate(row))); },
        async take(count: number) { return (await query.collect()).slice(0, count); },
        async first() { return (await query.collect())[0] ?? null; },
      };
      return query;
    },
    async insert(table: string, value: any) { rows(table).push({ ...value, _id: String(++nextId) }); },
    async replace(id: string, value: any) {
      for (const entries of tables.values()) {
        const index = entries.findIndex(row => row._id === id);
        if (index >= 0) entries[index] = { ...value, _id: id };
      }
    },
    async delete(id: string) {
      for (const entries of tables.values()) {
        const index = entries.findIndex(row => row._id === id);
        if (index >= 0) entries.splice(index, 1);
      }
    },
    async patch(id: string, value: any) {
      for (const entries of tables.values()) {
        const row = entries.find(row => row._id === id);
        if (row) Object.assign(row, value);
      }
    },
  };
}

// Root-only installs do not install the example's optional backend dependencies.
describe.skipIf(!existsSync(new URL('../example/node_modules/convex/package.json', import.meta.url)))('example Convex sync protocol', () => {
  it('merges updates, ignores retries and stale writes, and delivers offline deletions', async () => {
    const { pullDeltas, pushBatch } = await import('../example/convex/sync');
    const ctx = { db: database() };
    const push = (operations: any[]) => (pushBatch as any)._handler(ctx, { operations });
    const pull = (sinceTimestamp = 0) => (pullDeltas as any)._handler(ctx, {
      sinceTimestamp, tables: ['properties'],
    });
    const op = { id: 'a', tableName: 'properties', rowId: 'p1', operation: 'INSERT',
      payload: { name: 'Home', rent: 100 }, timestamp: 10 };
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      await push([op]);
      const first = await pull();
      const stored = await ctx.db.query('properties').first();
      expect(stored).toMatchObject({ id: 'p1', name: 'Home', rent: 100 });
      expect(stored).not.toHaveProperty('payload');
      expect(await ctx.db.query('rentalRows').collect()).toEqual([]);
      await push([op]);
      expect((await pull(first.timestamp)).changes).toEqual([]);
      await push([{ ...op, id: 'b', operation: 'UPDATE', payload: { rent: 200 }, timestamp: 20 }]);
      const second = await pull(first.timestamp);
      expect(second.timestamp).toBeGreaterThan(first.timestamp);
      expect(second.changes[0].payload).toEqual({ id: 'p1', name: 'Home', rent: 200, deleted: false });
      await push([{ ...op, id: 'stale', timestamp: 15 }]);
      expect((await pull(second.timestamp)).changes).toEqual([]);
      await push([{ ...op, id: 'delete', operation: 'DELETE', payload: null, timestamp: 30 }]);
      expect((await pull(second.timestamp)).changes).toEqual([
        expect.objectContaining({ rowId: 'p1', operation: 'DELETE', payload: null }),
      ]);
      expect((await pull()).changes[0].operation).toBe('DELETE');
    } finally { now.mockRestore(); }
  });
  it('migrates every entity into direct fields and keeps newer target records', async () => {
    const { migrateRentalRows, pullDeltas } = await import('../example/convex/sync');
    const ctx = { db: database() };
    const entities = {
      properties: { name: 'Home', rent: 100 }, tenants: { name: 'Resident', property_id: 'properties' },
      maintenance_requests: { title: 'Repair' }, payments: { amount: 100 },
    };
    for (const [tableName, payload] of Object.entries(entities)) {
      await ctx.db.insert('rentalRows', { tableName, rowId: tableName, payload,
        deleted: false, timestamp: 1, writeTimestamp: 1 });
    }
    await ctx.db.insert('payments', { id: 'payments', amount: 200, deleted: false, timestamp: 2, writeTimestamp: 2 });
    expect(await (migrateRentalRows as any)._handler(ctx, {})).toEqual({ migrated: 4 });
    expect(await (migrateRentalRows as any)._handler(ctx, {})).toEqual({ migrated: 0 });
    for (const table of Object.keys(entities)) {
      const row = await ctx.db.query(table).first();
      expect(row.id).toBe(table);
      expect(row).not.toHaveProperty('payload');
    }
    expect((await ctx.db.query('payments').first()).amount).toBe(200);
    const all = await (pullDeltas as any)._handler(ctx, { sinceTimestamp: 0, tables: [] });
    expect(all.changes).toHaveLength(4);
    expect(all.changes.every((row: any) => !('_id' in row.payload) && !('writeTimestamp' in row.payload))).toBe(true);
  });

});
