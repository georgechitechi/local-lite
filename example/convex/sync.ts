import { mutationGeneric, queryGeneric, internalMutationGeneric } from 'convex/server';
import type { DataModelFromSchemaDefinition, MutationBuilder, QueryBuilder, GenericDatabaseReader, GenericDataModel } from 'convex/server';
import { v } from 'convex/values';
import schema from './schema';

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const mutation: MutationBuilder<DataModel, 'public'> = mutationGeneric;
const query: QueryBuilder<DataModel, 'public'> = queryGeneric;

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
      const existing = await (ctx.db as GenericDatabaseReader<GenericDataModel>).query(op.tableName)
        .withIndex('by_id', q => q.eq('id', op.rowId)).first();
      const existingWriteTimestamp = typeof existing?.writeTimestamp === 'number' ? existing.writeTimestamp : 0;
      if (!existing || op.timestamp >= existingWriteTimestamp) {
        if (op.operation !== 'DELETE' && (!op.payload || typeof op.payload !== 'object' || Array.isArray(op.payload))) {
          throw new Error('Insert and update require an object payload');
        }
        const deleted = op.operation === 'DELETE';
        const fields = { ...businessFields(existing ?? {}), ...(deleted ? {} : op.payload) };
        for (const key of ['_id', '_creationTime', 'timestamp', 'writeTimestamp']) delete fields[key];
        // Strictly increasing server cursors prevent same-millisecond writes being missed.
        const row = { ...fields, id: op.rowId, deleted,
          timestamp: timestamp++, writeTimestamp: op.timestamp };
        if (existing) await ctx.db.replace(existing._id as any, row as any);
        else await ctx.db.insert(op.tableName, row as any);
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
    const selectedTables = tables.length ? [...new Set(tables)] : rentalTables;
    const changes = (await Promise.all(selectedTables.map(async table => {
      const rows = await ctx.db.query(table)
        .withIndex('by_timestamp', q => q.gt('timestamp', sinceTimestamp)).collect();
      return rows.map(row => ({
        tableName: table, rowId: row.id, operation: row.deleted ? 'DELETE' as const : 'UPDATE' as const,
        payload: row.deleted ? null : businessFields(row), timestamp: row.timestamp,
      }));
    }))).flat().sort((a, b) => a.timestamp - b.timestamp);
    return {
      timestamp: changes.reduce((latest, row) => Math.max(latest, row.timestamp), sinceTimestamp),
      changes,
    };
  },
});

const rentalTables = ['properties', 'tenants', 'maintenance_requests', 'payments'] as const;
function businessFields(row: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(row).filter(([key]) =>
    !['_id', '_creationTime', 'timestamp', 'writeTimestamp'].includes(key)));
}

// One-time, resumable migration from the original shared table. Each batch is atomic.
// Generic context intentionally permits reading the legacy table absent from the new schema.
export const migrateRentalRows = internalMutationGeneric({
  args: {},
  handler: async ctx => {
    const legacy = await ctx.db.query('rentalRows').take(200);
    if (!legacy.length) return { migrated: 0 };
    const clock = await ctx.db.query('syncClock').first();
    let timestamp = Math.max(Date.now(), (clock?.timestamp ?? 0) + 1);
    for (const old of legacy) {
      if (!rentalTables.some(table => table === old.tableName)) throw new Error('Unknown legacy table');
      const existing = await ctx.db.query(old.tableName)
        .withIndex('by_id', q => q.eq('id', old.rowId)).first();
      if (!existing || old.writeTimestamp > existing.writeTimestamp) {
        const row = { ...businessFields(old.payload ?? {}), id: old.rowId,
          deleted: old.deleted, timestamp: timestamp++, writeTimestamp: old.writeTimestamp };
        if (existing) await ctx.db.replace(existing._id, row);
        else await ctx.db.insert(old.tableName, row);
      }
      await ctx.db.delete(old._id);
    }
    if (clock) await ctx.db.patch(clock._id, { timestamp });
    else await ctx.db.insert('syncClock', { timestamp });
    return { migrated: legacy.length };
  },
});
