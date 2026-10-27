/**
 * Safely escape a SQL identifier (table name or column name) with double quotes.
 */
export function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Determines whether a table name is an internal SQLite or local-lite system/engine table
 * (e.g. FTS5 index and shadow tables, sync outbox, local session/key stores, sqlite/android internals).
 */
export function isInternalTable(tableName: string): boolean {
  if (!tableName || typeof tableName !== 'string') return true;
  const lower = tableName.toLowerCase();
  if (lower.startsWith('sqlite_') || lower.startsWith('android_')) return true;
  if (lower.startsWith('_fts_')) return true;
  if (lower.startsWith('_local_')) return true;
  if (lower.startsWith('sync_')) return true;
  if (lower === 'schema_migrations' || lower === '_migrations') return true;
  return false;
}
