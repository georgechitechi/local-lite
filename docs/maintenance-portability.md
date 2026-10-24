# 🧹 Database Maintenance & Universal Data Portability

Keep your local SQLite database lean, responsive, and easily exportable.

---

## 🧹 1. Database Maintenance (`client.maintenance`)

`LocalFirstClient` includes a dedicated `maintenance` manager:

```typescript
// 1. Get complete storage breakdown
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

// 3. Defragment and reclaim free pages
await client.maintenance.vacuum();

// 4. Merge WAL logs back into database file
await client.maintenance.checkpoint('TRUNCATE');
```

---

## 📤 2. Universal Data Portability (JSON & CSV)

Allow users to export and import their data at any time for GDPR compliance, backups, or external analysis.

```typescript
import {
  exportTablesToJson,
  importTablesFromJson,
  exportTableToCsv,
  importTableFromCsv,
} from 'local-lite';
```

### JSON Export & Import:
```typescript
// Export tables to JSON string
const jsonString = await exportTablesToJson(client, ['milestones', 'vaccines'], {
  pretty: true,
});

// Import tables from JSON (supports 'merge' or 'replace' mode)
const summary = await importTablesFromJson(client, jsonString, {
  mode: 'merge', // Update existing rows and insert new ones
  skipOutbox: true, // Only restore local SQLite state without syncing to server
});
console.log('Imported tables:', summary.tables, summary.rowCounts);
```

### RFC-4180 CSV Export & Import:
```typescript
// Export a single table to CSV
const csvData = await exportTableToCsv(client, 'vaccines');

// Import CSV data with auto-detection of JSON, numeric, and boolean fields
await importTableFromCsv(client, 'vaccines', csvData, {
  mode: 'merge',
});
```
