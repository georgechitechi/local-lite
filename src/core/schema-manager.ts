import { escapeIdentifier } from '../utils/sql.js';

export interface DBExecutable {
  execute(query: string, params?: any[]): Promise<any[]>;
}

/**
 * Detects the appropriate SQLite column type affinity from a JavaScript runtime value.
 */
export function detectSQLiteType(value: any): 'INTEGER' | 'REAL' | 'TEXT' | 'BLOB' {
  if (typeof value === 'boolean') return 'INTEGER';
  if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'REAL';
  if (value instanceof Uint8Array) return 'BLOB';
  return 'TEXT';
}

/**
 * Normalizes values for SQLite storage:
 * - Booleans are converted to 1 / 0
 * - Plain objects and arrays are JSON serialized
 */
export function formatValueForStorage(value: any): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object' && !(value instanceof Uint8Array)) return JSON.stringify(value);
  return value;
}

export class SchemaManager {
  private knownTables: Set<string> = new Set();
  private knownColumns: Set<string> = new Set();
  private knownIndexes: Set<string> = new Set();

  clearCache(): void {
    this.knownTables.clear();
    this.knownColumns.clear();
    this.knownIndexes.clear();
  }

  hasColumn(tableName: string, column: string): boolean {
    return this.knownColumns.has(`${tableName}:${column.toLowerCase()}`);
  }

  /**
   * Returns whether `column` exists on `tableName`, introspecting via PRAGMA table_info
   * at most once per table (cached). Unlike ensureTableIntrospected, this has no
   * side effects (no auto-indexing), so it is safe on hand-written schemas.
   */
  async tableHasColumn(db: DBExecutable, tableName: string, column: string): Promise<boolean> {
    if (this.hasColumn(tableName, column)) return true;
    const probeKey = `${tableName}:__probed__`;
    if (!this.knownColumns.has(probeKey)) {
      try {
        const tableInfo = await db.execute(`PRAGMA table_info(${escapeIdentifier(tableName)});`);
        if (Array.isArray(tableInfo) && tableInfo.length > 0) {
          // Only cache once the table exists, so tables created later get re-probed.
          this.knownColumns.add(probeKey);
          for (const col of tableInfo) {
            if (col?.name) this.knownColumns.add(`${tableName}:${String(col.name).toLowerCase()}`);
          }
        }
      } catch {}
    }
    return this.hasColumn(tableName, column);
  }

  /**
   * Introspects table columns via PRAGMA table_info if not previously cached.
   */
  async ensureTableIntrospected(db: DBExecutable, tableName: string): Promise<void> {
    const cacheKey = `${tableName}:__introspected__`;
    if (this.knownColumns.has(cacheKey)) return;
    this.knownColumns.add(cacheKey);

    const safeTable = escapeIdentifier(tableName);
    try {
      const tableInfo = await db.execute(`PRAGMA table_info(${safeTable});`);
      const cols: string[] = [];
      if (Array.isArray(tableInfo)) {
        for (const col of tableInfo) {
          if (col?.name) {
            this.knownColumns.add(`${tableName}:${String(col.name).toLowerCase()}`);
            cols.push(String(col.name));
          }
        }
      }
      await this.autoIndexColumns(db, tableName, safeTable, cols);
    } catch {}
  }

  /**
   * Automatically creates single-column and composite FK+deleted indexes for given columns.
   */
  private async autoIndexColumns(
    db: DBExecutable,
    tableName: string,
    safeTable: string,
    columns: string[]
  ): Promise<void> {
    const hasDeleted = this.knownColumns.has(`${tableName}:deleted`);
    for (const key of columns) {
      const lower = key.toLowerCase();
      if (lower.endsWith('_id') || lower === 'deleted' || lower === 'created_at' || lower === 'updated_at') {
        const indexKey = `${tableName}:${lower}`;
        if (!this.knownIndexes.has(indexKey)) {
          this.knownIndexes.add(indexKey);
          try {
            await db.execute(`CREATE INDEX IF NOT EXISTS ${escapeIdentifier(`idx_${tableName}_${key}`)} ON ${safeTable} (${escapeIdentifier(key)});`);
          } catch {}
        }
      }

      if (hasDeleted && lower.endsWith('_id') && lower !== 'id') {
        const compositeKey = `${tableName}:${lower}_deleted`;
        if (!this.knownIndexes.has(compositeKey)) {
          this.knownIndexes.add(compositeKey);
          try {
            await db.execute(`CREATE INDEX IF NOT EXISTS ${escapeIdentifier(`idx_${tableName}_${lower}_del`)} ON ${safeTable} (${escapeIdentifier(key)}, "deleted");`);
          } catch {}
        }
      }
    }
  }

  /**
   * Ensures that the target table exists in SQLite with the specified primary key.
   */
  async ensureTable(
    db: DBExecutable,
    tableName: string,
    primaryKey: string = 'id'
  ): Promise<void> {
    if (this.knownTables.has(tableName)) return;

    const safeTable = escapeIdentifier(tableName);
    const safePk = escapeIdentifier(primaryKey);

    await db.execute(
      `CREATE TABLE IF NOT EXISTS ${safeTable} (${safePk} TEXT PRIMARY KEY);`
    );

    this.knownTables.add(tableName);
    this.knownColumns.add(`${tableName}:${primaryKey.toLowerCase()}`);
  }

  /**
   * Automatically introspects and adds missing columns to the table via ALTER TABLE.
   * Also normalizes payload values for SQLite compatibility.
   */
  async ensureColumns(
    db: DBExecutable,
    tableName: string,
    payload: Record<string, any> | null,
    primaryKey: string = 'id'
  ): Promise<Record<string, any>> {
    await this.ensureTable(db, tableName, primaryKey);

    if (!payload || typeof payload !== 'object') return {};
    const keys = Object.keys(payload);
    if (keys.length === 0) return {};

    const safeTable = escapeIdentifier(tableName);
    let cacheMiss = false;

    for (const key of keys) {
      if (key !== primaryKey && !this.knownColumns.has(`${tableName}:${key.toLowerCase()}`)) {
        cacheMiss = true;
        break;
      }
    }

    if (cacheMiss) {
      try {
        const tableInfo = await db.execute(`PRAGMA table_info(${safeTable});`);
        if (Array.isArray(tableInfo)) {
          for (const col of tableInfo) {
            if (col?.name) {
              this.knownColumns.add(`${tableName}:${String(col.name).toLowerCase()}`);
            }
          }
        }
      } catch {}

      for (const key of keys) {
        if (key === primaryKey) continue;
        const cacheKey = `${tableName}:${key.toLowerCase()}`;
        if (!this.knownColumns.has(cacheKey)) {
          const detectedType = detectSQLiteType(payload[key]);
          try {
            await db.execute(`ALTER TABLE ${safeTable} ADD COLUMN ${escapeIdentifier(key)} ${detectedType};`);
          } catch {}
          this.knownColumns.add(cacheKey);
        }
      }

      await this.autoIndexColumns(db, tableName, safeTable, keys);
    }

    const formatted: Record<string, any> = {};
    for (const key of keys) {
      formatted[key] = formatValueForStorage(payload[key]);
    }
    return formatted;
  }
}
