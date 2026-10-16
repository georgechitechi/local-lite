import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  rentalRows: defineTable({
    tableName: v.string(), rowId: v.string(), payload: v.any(),
    deleted: v.boolean(), timestamp: v.number(), writeTimestamp: v.number(),
  }).index('by_row', ['tableName', 'rowId']).index('by_timestamp', ['timestamp']),
  syncClock: defineTable({ timestamp: v.number() }),
  syncOperations: defineTable({ operationId: v.string() }).index('by_operation', ['operationId']),
});
