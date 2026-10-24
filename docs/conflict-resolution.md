# 🛡️ Conflict Resolution

When multiple offline clients modify the same record concurrently, `local-lite` resolves conflicts during the pull phase.

---

## 1. Built-in Strategies

Specify your strategy directly in `defineSyncConfig`:

```typescript
export const config = defineSyncConfig({
  conflictResolver: 'field-merge', // Options: 'last-write-wins' | 'server-wins' | 'client-wins' | 'field-merge'
});
```

### Strategy Summary:

| Strategy | Description | Best For |
| :--- | :--- | :--- |
| **`field-merge`** (Recommended) | 3-Way field-level merge. Merges disjoint fields from both local and remote offline edits, and uses timestamps or custom rules for conflicting fields. | Collaborative apps where multiple users edit different properties of the same item. |
| **`last-write-wins`** (Default) | Compares mutation timestamps. The mutation with the most recent timestamp wins the entire record. | Standard apps where record replacement is acceptable. |
| **`server-wins`** | Any incoming remote record overrides uncommitted local edits. | Authoritative server data (banking, ticket inventory). |
| **`client-wins`** | Local changes always override incoming remote changes. | Personal draft tools, private preferences. |

---

## 2. Smart 3-Way Field-Level Conflict Resolver (`createFieldMergeResolver`)

Instead of picking all-local or all-remote, `createFieldMergeResolver` intelligently inspects individual columns:
* **Disjoint edits preserved:** If user A modifies `title` offline and user B modifies `notes` on the server, both changes are preserved in the merged row.
* **Granular field rules:** Apply `max`, `min`, `newer`, `local`, `remote`, or custom functions per table and column.
* **Custom delete handling:** Choose whether deletions win (`delete-wins`) or offline edits take precedence (`update-wins`).

```typescript
import { createFieldMergeResolver } from 'local-lite';
import { defineSyncConfig } from 'local-lite/config';

export const config = defineSyncConfig({
  conflictResolver: createFieldMergeResolver({
    defaultWinner: 'newer', // Default for overlapping fields without explicit rules
    deleteHandling: 'delete-wins',
    fieldRules: {
      notes: {
        // Automatically union tag arrays
        tags: (localTags, remoteTags) =>
          Array.from(new Set([...(localTags ?? []), ...(remoteTags ?? [])])),
        // Highest counter wins
        view_count: 'max',
      },
      '*': {
        updated_at: 'newer',
      },
    },
  }),
});
```

---

## 3. Low-Level Custom Conflict Resolvers

You can also provide a completely custom resolver function:

```typescript
import { defineSyncConfig } from 'local-lite/config';
import { ConflictContext } from 'local-lite';

export const config = defineSyncConfig({
  conflictResolver: (context: ConflictContext) => {
    const { localOutboxRecord, remoteChange, localRow } = context;

    // Return 'apply-remote' | 'keep-local' | { mergePayload: Record<string, any> }
    return 'apply-remote';
  },
});
```

