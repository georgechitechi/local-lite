import { describe, expect, it, vi } from 'vitest';
import { pullDeltas, pushBatch } from '../example/convex/sync';

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
    async patch(id: string, value: any) {
      for (const entries of tables.values()) {
        const row = entries.find(row => row._id === id);
        if (row) Object.assign(row, value);
      }
    },
  };
}

describe('example Convex sync protocol', () => {
  it('merges updates, ignores retries and stale writes, and delivers offline deletions', async () => {
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
});
