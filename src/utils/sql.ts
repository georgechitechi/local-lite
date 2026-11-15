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
  if (lower === 'schema_migrations') return true;
  return false;
}

const READ_QUERY_REGEX = /^(?:SELECT|WITH|EXPLAIN)\b/i;
const READ_ONLY_PRAGMA_REGEX = /^PRAGMA\b/i;
const MUTATING_PRAGMA_REGEX = /=|wal_checkpoint|shrink_memory|optimize/i;

/**
 * Determines whether a SQLite statement is a read-only query (SELECT/WITH/EXPLAIN or non-mutating PRAGMA).
 */
export function isReadQuery(sql: string): boolean {
  if (READ_QUERY_REGEX.test(sql)) return true;
  return READ_ONLY_PRAGMA_REGEX.test(sql) && !MUTATING_PRAGMA_REGEX.test(sql);
}

/**
 * Extracts a required document/row ID from a record using primaryKey, an optional fallback ID, or `id`.
 */
export function extractDocumentId(
  row: any,
  primaryKey: string,
  fallbackId?: unknown,
  providerLabel = 'Remote',
): string {
  const id = row?.[primaryKey] ?? fallbackId ?? row?.id;
  if (id === undefined || id === null || String(id).length === 0) {
    throw new Error(`${providerLabel} change is missing its document ID.`);
  }
  return String(id);
}
