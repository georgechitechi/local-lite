import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const text = v.optional(v.union(v.string(), v.null()));
const number = v.optional(v.union(v.number(), v.null()));
const common = {
  id: v.string(),
  deleted: v.boolean(),
  timestamp: v.number(),
  writeTimestamp: v.number(),
  created_at: text,
  updated_at: text,
};
// Business fields are optional to support partial upserts and delete-before-insert tombstones.
export default defineSchema({
  properties: defineTable({
    ...common,
    name: text,
    unit: text,
    address: text,
    rent: number,
    status: text,
    bedrooms: number, bathrooms: number,
  }).index('by_id', ['id']).index('by_timestamp', ['timestamp']),
  tenants: defineTable({
    ...common,
    name: text,
    email: text,
    phone: text,
    property_id: text,
    property_name: text,
    lease_start: text,
    lease_end: text,
    rent_amount: number,
    status: text,
  }).index('by_id', ['id']).index('by_timestamp', ['timestamp']).index('by_property', ['property_id']),
  maintenance_requests: defineTable({
    ...common,
    property_name: text,
    title: text,
    priority: text,
    status: text,
    estimated_cost: number,
    reported_date: text,
  }).index('by_id', ['id']).index('by_timestamp', ['timestamp']),
  payments: defineTable({
    ...common,
    property_name: text,
    tenant_name: text,
    amount: number,
    due_date: text,
    status: text,
  }).index('by_id', ['id']).index('by_timestamp', ['timestamp']),
  syncClock: defineTable({ timestamp: v.number() }),
  syncOperations: defineTable({
    operationId: v.string()
  }).index('by_operation', ['operationId']),
});
