import { mutationGeneric as mutation, queryGeneric as query } from 'convex/server';
import { v } from 'convex/values';

/**
 * Batch mutation invoked by local-lite ConvexRemoteAdapter.pushChanges().
 */
export const pushBatch = mutation({
  args: {
    operations: v.array(
      v.object({
        id: v.string(),
        tableName: v.string(),
        rowId: v.string(),
        operation: v.string(),
        payload: v.any(),
        timestamp: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const op of args.operations) {
      const table = op.tableName as 'tasks' | 'notes';
      const existing = await ctx.db
        .query(table)
        .filter((q) => q.eq(q.field('id'), op.rowId))
        .first();

      if (op.operation === 'DELETE') {
        if (existing) {
          await ctx.db.patch(existing._id, {
            deleted: true,
            updatedAt: op.timestamp,
          });
        }
      } else {
        const docData = {
          ...(op.payload || {}),
          id: op.rowId,
          deleted: false,
          updatedAt: op.timestamp,
        };

        if (existing) {
          await ctx.db.patch(existing._id, docData);
        } else {
          await ctx.db.insert(table, docData);
        }
      }
    }
    return true;
  },
});

/**
 * Delta query invoked by local-lite ConvexRemoteAdapter.fetchChanges().
 */
export const pullDeltas = query({
  args: {
    sinceTimestamp: v.number(),
    tables: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    let maxTimestamp = args.sinceTimestamp;
    const changes: Array<{
      tableName: string;
      operation: 'INSERT' | 'UPDATE' | 'DELETE';
      rowId: string;
      payload: any;
      timestamp: number;
    }> = [];

    for (const tableName of args.tables) {
      const table = tableName as 'tasks' | 'notes';
      const docs = await ctx.db.query(table).collect();

      for (const doc of docs) {
        const docTime = (doc as any).updatedAt || (doc as any)._creationTime || Date.now();
        if (docTime > args.sinceTimestamp) {
          if (docTime > maxTimestamp) {
            maxTimestamp = docTime;
          }

          const isDeleted = Boolean((doc as any).deleted);
          changes.push({
            tableName,
            operation: isDeleted ? 'DELETE' : 'UPDATE',
            rowId: (doc as any).id || (doc as any)._id,
            payload: isDeleted ? null : doc,
            timestamp: docTime,
          });
        }
      }
    }

    return {
      timestamp: maxTimestamp,
      changes,
    };
  },
});
