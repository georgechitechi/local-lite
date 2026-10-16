import { mutationGeneric as mutation, queryGeneric as query } from 'convex/server';
import { v } from 'convex/values';

const tableName = v.union(v.literal('properties'), v.literal('tenants'),
  v.literal('maintenance_requests'), v.literal('payments'));

export const pushBatch = mutation({
  args: { operations: v.array(v.object({
    id: v.string(), tableName, rowId: v.string(),
    operation: v.union(v.literal('INSERT'), v.literal('UPDATE'), v.literal('DELETE')),
    payload: v.any(), timestamp: v.number(),
  })) },
  handler: async (ctx, { operations }) => {
    if (operations.length > 500) throw new Error('Maximum batch size is 500');
    const clock = await ctx.db.query('syncClock').first();
    let timestamp = Math.max(Date.now(), (clock?.timestamp ?? 0) + 1);
    for (const op of operations) {
      const seen = await ctx.db.query('syncOperations')
        .withIndex('by_operation', q => q.eq('operationId', op.id)).first();
      if (seen) continue;
      const existing = await ctx.db.query('rentalRows')
        .withIndex('by_row', q => q.eq('tableName', op.tableName).eq('rowId', op.rowId)).first();
      if (!existing || op.timestamp >= existing.writeTimestamp) {
        if (op.operation !== 'DELETE' && (!op.payload || typeof op.payload !== 'object' || Array.isArray(op.payload))) {
          throw new Error('Insert and update require an object payload');
        }
        const deleted = op.operation === 'DELETE';
        const payload = deleted ? null : {
          ...(existing?.payload ?? {}), ...op.payload, id: op.rowId, deleted: false,
        };
        // Strictly increasing server cursors prevent same-millisecond writes being missed.
        const row = { tableName: op.tableName, rowId: op.rowId, payload, deleted,
          timestamp: timestamp++, writeTimestamp: op.timestamp };
        if (existing) await ctx.db.replace(existing._id, row);
        else await ctx.db.insert('rentalRows', row);
      }
      await ctx.db.insert('syncOperations', { operationId: op.id });
    }
    if (clock) await ctx.db.patch(clock._id, { timestamp });
    else await ctx.db.insert('syncClock', { timestamp });
    return { failedIds: [] };
  },
});

export const pullDeltas = query({
  args: { sinceTimestamp: v.number(), tables: v.array(tableName) },
  handler: async (ctx, { sinceTimestamp, tables }) => {
    const rows = await ctx.db.query('rentalRows')
      .withIndex('by_timestamp', q => q.gt('timestamp', sinceTimestamp)).collect();
    return {
      timestamp: rows.reduce((latest, row) => Math.max(latest, row.timestamp), sinceTimestamp),
      changes: rows.filter(row => tables.length === 0 || tables.includes(row.tableName)).map(row => ({
        tableName: row.tableName, rowId: row.rowId,
        operation: row.deleted ? 'DELETE' : 'UPDATE', payload: row.payload, timestamp: row.timestamp,
      })),
    };
  },
});
