# 🛡️ Conflict Resolution

When multiple offline clients modify the same record concurrently, `local-lite` resolves conflicts during the pull phase.

---

## 1. Built-in Strategies

Specify your strategy directly in `defineSyncConfig`:

```typescript
export const config = defineSyncConfig({
  conflictResolver: 'last-write-wins', // Options: 'last-write-wins' | 'server-wins' | 'client-wins'
});
```

### Strategy Summary:

| Strategy | Description | Best For |
| :--- | :--- | :--- |
| **`last-write-wins`** (Default) | Compares timestamps (`updatedAt` / `updated_at`). The mutation with the most recent timestamp wins. | Most collaborative apps (todos, notes, rentals). |
| **`server-wins`** | Any incoming remote record overrides uncommitted local edits. | Authoritative server data (banking, ticket inventory). |
| **`client-wins`** | Local changes always override incoming remote changes. | Personal draft tools, private preferences. |

---

## 2. Custom Conflict Resolvers

For field-level merging or business logic, pass a custom resolver function:

```typescript
import { defineSyncConfig } from 'local-lite/config';
import { ConflictContext } from 'local-lite';

export const config = defineSyncConfig({
  conflictResolver: (context: ConflictContext) => {
    const { localRecord, remoteRecord, tableName } = context;

    // Example: For a 'tasks' table, merge tags and preserve the latest title
    if (tableName === 'tasks') {
      const mergedTags = Array.from(
        new Set([
          ...(localRecord?.tags || []),
          ...(remoteRecord?.tags || []),
        ])
      );

      const latestDoc = (localRecord.updatedAt > remoteRecord.updatedAt)
        ? localRecord
        : remoteRecord;

      return {
        ...latestDoc,
        tags: mergedTags,
      };
    }

    // Default to last-write-wins for other tables
    return (localRecord?.updatedAt ?? 0) >= (remoteRecord?.updatedAt ?? 0)
      ? localRecord
      : remoteRecord;
  },
});
```
