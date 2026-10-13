# 🌐 Remote Backend Adapters

`local-lite` supports multiple cloud synchronization backends out of the box.

---

## 1. Supabase (Postgres + Realtime)

The Supabase adapter synchronizes local SQLite tables with Supabase Postgres tables in real time.

```bash
npm install @supabase/supabase-js
```

### 1.1 Postgres Setup (SQL Editor)

Run the following SQL in your Supabase SQL Editor to enable timestamp triggers and soft deletes:

```sql
-- 1. Automatic Timestamp Trigger
CREATE OR REPLACE FUNCTION public.set_sync_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create your table
CREATE TABLE IF NOT EXISTS public.todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  deleted BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Attach trigger
CREATE TRIGGER tr_todos_updated_at
BEFORE UPDATE ON public.todos
FOR EACH ROW EXECUTE FUNCTION public.set_sync_updated_at();

-- 4. Enable Supabase Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;
```

### 1.2 Client Configuration

```typescript
import { defineSyncConfig } from 'local-lite/config';

export const config = defineSyncConfig({
  tables: ['todos'],
  supabase: {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    updatedAtColumn: 'updated_at',
    deletedColumn: 'deleted',
    deletedValue: true,
  },
});
```

---

## 2. Convex (Reactive Cloud Documents)

The Convex adapter coordinates with a live Convex backend via batch mutations and delta queries.

```bash
npm install convex
```

### 2.1 Convex Schema (`convex/schema.ts`)

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  todos: defineTable({
    id: v.string(),
    title: v.string(),
    completed: v.boolean(),
    deleted: v.boolean(),
    updatedAt: v.number(),
  }).index('by_updatedAt', ['updatedAt']),
});
```

### 2.2 Convex Sync Functions (`convex/sync.ts`)

```typescript
// convex/sync.ts
import { mutationGeneric as mutation, queryGeneric as query } from 'convex/server';
import { v } from 'convex/values';

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
      const table = op.tableName as 'todos';
      const existing = await ctx.db
        .query(table)
        .filter((q) => q.eq(q.field('id'), op.rowId))
        .first();

      if (op.operation === 'DELETE') {
        if (existing) {
          await ctx.db.patch(existing._id, { deleted: true, updatedAt: op.timestamp });
        }
      } else {
        const doc = { ...(op.payload || {}), id: op.rowId, deleted: false, updatedAt: op.timestamp };
        if (existing) {
          await ctx.db.patch(existing._id, doc);
        } else {
          await ctx.db.insert(table, doc);
        }
      }
    }
    return true;
  },
});

export const pullDeltas = query({
  args: {
    sinceTimestamp: v.number(),
    tables: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const results: Record<string, any[]> = {};
    for (const table of args.tables) {
      const rows = await ctx.db
        .query(table as 'todos')
        .withIndex('by_updatedAt', (q) => q.gt('updatedAt', args.sinceTimestamp))
        .collect();
      results[table] = rows;
    }
    return results;
  },
});
```

### 2.3 Client Configuration

```typescript
import { defineSyncConfig } from 'local-lite/config';
import { ConvexClient } from 'convex/browser';

const convexClient = new ConvexClient(process.env.EXPO_PUBLIC_CONVEX_URL!);

export const config = defineSyncConfig({
  tables: ['todos'],
  convex: {
    client: convexClient,
    pushMutation: 'sync:pushBatch',
    pullQuery: 'sync:pullDeltas',
    updatedAtColumn: 'updatedAt',
    deletedColumn: 'deleted',
  },
});
```

---

## 3. Firebase / Cloud Firestore

Synchronizes local SQLite with Google Cloud Firestore collections.

```bash
npm install firebase # or @react-native-firebase/firestore
```

### Client Configuration

```typescript
import { defineSyncConfig } from 'local-lite/config';
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const app = initializeApp({
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
});
const firestore = getFirestore(app);

export const config = defineSyncConfig({
  tables: ['todos'],
  firebase: {
    firestore,
    updatedAtColumn: 'updatedAt',
    deletedColumn: 'deleted',
  },
});
```

---

## 4. In-Memory Simulated Demo Backend

For mock testing, automated unit tests, and prototyping when you don't have internet access or cloud credentials:

```typescript
import { defineSyncConfig } from 'local-lite/config';

export const config = defineSyncConfig({
  tables: ['todos'],
  inMemoryRemote: true, // Simulates remote with 300ms network delay
});
```

---

## 5. Custom Remote Adapters

Implement `RemoteDBAdapter` to connect `local-lite` to your own REST, GraphQL, or WebSocket servers:

```typescript
import { RemoteDBAdapter, SyncOp } from 'local-lite';

export class MyCustomServerAdapter implements RemoteDBAdapter {
  async pushChanges(operations: SyncOp[]): Promise<boolean> {
    const response = await fetch('https://api.mybackend.com/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations }),
    });
    return response.ok;
  }

  async fetchChanges(tables: string[], sinceTimestamp: number): Promise<Record<string, any[]>> {
    const res = await fetch(`https://api.mybackend.com/sync/pull?since=${sinceTimestamp}`);
    return await res.json();
  }

  subscribe?(tables: string[], onRemoteChange: () => void): () => void {
    // Optional WebSocket or SSE listener
    const ws = new WebSocket('wss://api.mybackend.com/realtime');
    ws.onmessage = () => onRemoteChange();
    return () => ws.close();
  }
}
```
