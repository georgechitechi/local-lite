# 🧹 Database Maintenance & Universal Data Portability

Keep your local SQLite database lean, responsive, and easily exportable.

```typescript
import {
  exportTablesToJson,
  importTablesFromJson,
  exportTableToCsv,
  importTableFromCsv,
} from 'local-lite';

import { useDatabaseMaintenance } from 'local-lite/react';
```

---

## 🧹 1. Database Maintenance (`client.maintenance`)

`LocalFirstClient` includes a dedicated `DatabaseMaintenance` instance:

```typescript
// 1. Get complete storage metrics breakdown
const stats = await client.maintenance.getStorageStats();
console.log('Database size on disk:', stats.databaseSizeBytes, 'bytes');
console.log('Table rows:', stats.tables);
console.log('Outbox queue status:', stats.outbox);

// 2. Prune old or completed sync outbox records
const pruned = await client.maintenance.pruneOutbox({
  retentionDays: 14, // Delete records older than 14 days
  maxEntries: 1000,  // Keep at most 1,000 completed/failed records
  statuses: ['COMPLETED', 'FAILED'],
});
console.log(`Pruned ${pruned} outbox records`);

// 3. Defragment database and reclaim unused pages
await client.maintenance.vacuum();

// 4. Force WAL log checkpointing back into database file
// Modes: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE'
await client.maintenance.checkpoint('TRUNCATE');

// 5. Query planner optimization (PRAGMA optimize / analyze)
await client.maintenance.analyze();

// 6. SQLite structural integrity check (PRAGMA integrity_check)
const isHealthy = await client.maintenance.integrityCheck();
console.log('Database health:', isHealthy ? 'OK' : 'Corrupted');
```

---

## ⚛️ 2. React Maintenance Hook (`useDatabaseMaintenance`)

Manage database health directly from your settings screen:

```tsx
import React from 'react';
import { View, Text, Button } from 'react-native';
import { useDatabaseMaintenance } from 'local-lite/react';

export function StorageSettings({ client }) {
  const {
    stats,
    loading,
    refreshStats,
    pruneOutbox,
    vacuum,
    checkpoint,
  } = useDatabaseMaintenance(client);

  return (
    <View style={{ padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold' }}>Database Storage</Text>
      <Text>Database Size: {stats?.databaseSizeBytes ? `${(stats.databaseSizeBytes / 1024).toFixed(1)} KB` : '...'}</Text>
      <Text>Pending Mutations: {stats?.outbox.pending ?? 0}</Text>
      <Text>Completed History: {stats?.outbox.completed ?? 0}</Text>

      <Button
        title="Prune Old Outbox Records"
        onPress={() => pruneOutbox({ retentionDays: 7 })}
      />
      <Button
        title="Reclaim Free Disk Space (VACUUM)"
        onPress={vacuum}
      />
      <Button
        title="Checkpoint WAL File"
        onPress={() => checkpoint('TRUNCATE')}
      />
    </View>
  );
}
```

---

## 📤 3. Universal Data Portability (JSON & CSV)

Allow users to export and import their data at any time for GDPR compliance, account switching, local backups, or spreadsheet analysis.

### JSON Export & Import:
```typescript
// Export specific tables (or all managed tables) to JSON string
const jsonString = await client.exportToJson(['milestones', 'vaccines'], {
  pretty: true,
});

// Import tables from JSON string
const summary = await client.importFromJson(jsonString, {
  mode: 'merge',     // 'merge' (updates existing rows by ID & inserts new) or 'replace' (deletes all existing rows first)
  skipOutbox: true,  // When true, does not re-queue restored rows to the sync outbox
});

console.log('Import summary:', summary.tables, summary.rowCounts);
```

### RFC-4180 CSV Export & Import:
```typescript
// Export a single table to CSV
const csvData = await client.exportToCsv('vaccines', {
  delimiter: ',',
  includeHeaders: true,
});

// Import CSV data with auto-detection of numbers, booleans, and JSON structures
const { rowCount } = await client.importFromCsv('vaccines', csvData, {
  mode: 'merge',     // 'merge' or 'replace'
  skipOutbox: true,
});
console.log(`Successfully imported ${rowCount} rows`);
```
