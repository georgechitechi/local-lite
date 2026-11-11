---
name: local-lite-custom-adapter
description: Write or review a custom local-lite RemoteDBAdapter for a REST, GraphQL or WebSocket backend. Use when implementing pushChanges, fetchChanges, subscribeToLiveChanges or setSyncScope, or debugging sync that duplicates, loses, or never stops receiving changes.
---

# local-lite custom remote adapter

Implement `RemoteDBAdapter` (exported from `local-lite`, with `SyncOperation`, `DeltaChanges`, `PushResult` types). Check `node_modules/local-lite/dist` type definitions and `docs/adapters-remote.md` ("Custom Remote Adapters") for exact shapes.

## Contract

- `pushChanges(operations): Promise<boolean | PushResult>`
  - Must be idempotent: the client retries after failures, so applying the same operation twice must be safe.
  - Return `false` (or a failing `PushResult`) or reject on failure so operations stay in the outbox. Never report success for operations that were not stored.
- `fetchChanges(sinceTimestamp, scope?): Promise<DeltaChanges>`
  - Return a **complete** batch of everything changed after `sinceTimestamp`, through the timestamp you report. Reject on partial failure; never return a truncated page as complete, or the checkpoint will skip data.
  - Apply `scope` filtering server-side when provided.
- `subscribeToLiveChanges(callback, scope?): () => void`
  - **Must return a cleanup function** (a no-op if no listener was created). Returning `void` is a breaking change since 0.0.30.
  - Live events do not advance the durable pull checkpoint.
  - `scope` may be an object or a (possibly async) function. If setup is async, guard against cleanup running before setup finishes (generation counter or cancelled flag) so listeners do not leak.
- `setSyncScope?(scope)`: optional; implement it if the backend filters by scope, and re-subscribe live listeners when scope changes.

> [!TIP]
> **Built-in Self-Hosted Adapter**: Before writing a custom adapter from scratch, consider using `SelfHostedRemoteAdapter` (or `server: { url, token }` in `defineSyncConfig`) paired with `createSyncEndpoint()` from `local-lite/server`. It implements an idempotent push/pull sync protocol out-of-the-box.

## Skeleton

```typescript
import type { RemoteDBAdapter, SyncOperation, DeltaChanges } from 'local-lite';

export class MyAdapter implements RemoteDBAdapter {
  async pushChanges(operations: SyncOperation[]): Promise<boolean> {
    const res = await fetch('/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations }),
    });
    return res.ok;
  }

  async fetchChanges(since: number, scope?: Record<string, any>): Promise<DeltaChanges> {
    const res = await fetch(`/sync/pull?since=${since}&scope=${encodeURIComponent(JSON.stringify(scope ?? {}))}`);
    if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
    return res.json();
  }

  subscribeToLiveChanges(callback: (c: DeltaChanges) => void): () => void {
    const ws = new WebSocket('wss://example.com/realtime');
    ws.onmessage = (e) => callback(JSON.parse(e.data));
    return () => ws.close();
  }
}
```

## Review checklist

- Non-OK HTTP responses throw or return failure, never silently succeed.
- Server timestamps are consistent with `sinceTimestamp`.
- Pushes are idempotent (upsert by `id`).
- A cleanup function is always returned and actually releases the listener.
- Tests with a mock server cover push failure, partial pull failure, and cleanup.
