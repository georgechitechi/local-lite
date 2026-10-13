/**
 * Safely escape a SQL identifier (table name or column name) with double quotes.
 */
export function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
