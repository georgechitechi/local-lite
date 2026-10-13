import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  tasks: defineTable({
    id: v.string(),
    title: v.string(),
    completed: v.boolean(),
    deleted: v.optional(v.boolean()),
    updatedAt: v.optional(v.number()),
  }).index('by_updatedAt', ['updatedAt']),

  notes: defineTable({
    id: v.string(),
    title: v.string(),
    content: v.optional(v.string()),
    deleted: v.optional(v.boolean()),
    updatedAt: v.optional(v.number()),
  }).index('by_updatedAt', ['updatedAt']),
});
