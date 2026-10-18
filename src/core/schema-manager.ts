import { escapeIdentifier } from '../utils/sql.js';

export interface DBExecutable {
  execute(query: string, params?: any[]): Promise<any[]>;
}

/**
 * Detects the appropriate SQLite column type affinity from a JavaScript runtime value.
 *
 * Mapping:
 * - boolean -> INTEGER (0 or 1)
 * - integer -> INTEGER
 * - float/double -> REAL
 * - string -> TEXT
 * - object/array -> TEXT (JSON formatted)
 * - Uint8Array -> BLOB
 * - null/undefined -> TEXT (flexible SQLite type affinity)
 */
export function detectSQLiteType(value: any): 'INTEGER' | 'REAL' | 'TEXT' | 'BLOB' {
  if (value === null || value === undefined) {
    return 'TEXT';
  }

  const type = typeof value;

  if (type === 'boolean') {
    return 'INTEGER';
  }

  if (type === 'number') {
    return Number.isInteger(value) ? 'INTEGER' : 'REAL';
  }

  if (type === 'string') {
    return 'TEXT';
  }

  if (value instanceof Uint8Array) {
    return 'BLOB';
  }

  if (type === 'object') {
    return 'TEXT';
  }

  return 'TEXT';
}

/**
 * Normalizes values for SQLite storage:
 * - Booleans are converted to 1 / 0
 * - Plain objects and arrays are JSON serialized
 */
export function formatValueForStorage(value: any): any {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'object' && !(value instanceof Uint8Array)) {
    return JSON.stringify(value);
  }

  return value;
}

export class SchemaManager {
  private knownTables: Set<string> = new Set();
  private knownColumns: Set<string> = new Set();
  private knownIndexes: Set<string> = new Set();

  /**
   * Resets the schema cache (useful for testing or full database resets).
   */
  clearCache(): void {
    this.knownTables.clear();
    this.knownColumns.clear();
    this.knownIndexes.clear();
  }

  /**
   * Checks whether a column is known to exist on the specified table.
   */
  hasColumn(tableName: string, column: string): boolean {
    return this.knownColumns.has(`${tableName}:${column.toLowerCase()}`);
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
      if (Array.isArray(tableInfo)) {
        for (const col of tableInfo) {
          if (col && col.name) {
            this.knownColumns.add(`${tableName}:${String(col.name).toLowerCase()}`);
          }
        }
      }
    } catch {
      // Ignore
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
    if (this.knownTables.has(tableName)) {
      return;
    }

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

    if (!payload || typeof payload !== 'object') {
      return {};
    }

    const keys = Object.keys(payload);
    if (keys.length === 0) {
      return {};
    }

    const safeTable = escapeIdentifier(tableName);
    let cacheMiss = false;

    for (const key of keys) {
      if (key === primaryKey) continue;
      const cacheKey = `${tableName}:${key.toLowerCase()}`;
      if (!this.knownColumns.has(cacheKey)) {
        cacheMiss = true;
        break;
      }
    }

    if (cacheMiss) {
      // Query PRAGMA table_info to discover existing columns from SQLite
      try {
        const tableInfo = await db.execute(`PRAGMA table_info(${safeTable});`);
        if (Array.isArray(tableInfo)) {
          for (const col of tableInfo) {
            if (col && col.name) {
              this.knownColumns.add(`${tableName}:${String(col.name).toLowerCase()}`);
            }
          }
        }
      } catch (err) {
        // Fallback for mocks or custom drivers where PRAGMA table_info might not be supported
      }

      // Check for columns that still do not exist, and alter table
      for (const key of keys) {
        if (key === primaryKey) continue;
        const cacheKey = `${tableName}:${key.toLowerCase()}`;
        if (!this.knownColumns.has(cacheKey)) {
          const detectedType = detectSQLiteType(payload[key]);
          const safeCol = escapeIdentifier(key);

          try {
            await db.execute(`ALTER TABLE ${safeTable} ADD COLUMN ${safeCol} ${detectedType};`);
          } catch (err: any) {
            // Ignore if column already exists (e.g. concurrent race)
            const msg = String(err?.message || err || '');
            if (!msg.toLowerCase().includes('duplicate column')) {
              // Ignore or rethrow
            }
          }

          this.knownColumns.add(cacheKey);
        }

        // Auto-index foreign keys and common query columns
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.endsWith('_id') ||
          lowerKey === 'business_id' ||
          lowerKey === 'deleted' ||
          lowerKey === 'created_at' ||
          lowerKey === 'payment_date'
        ) {
          const indexKey = `${tableName}:${lowerKey}`;
          if (!this.knownIndexes.has(indexKey)) {
            this.knownIndexes.add(indexKey);
            try {
              const idxName = escapeIdentifier(`idx_${tableName}_${key}`);
              const safeCol = escapeIdentifier(key);
              await db.execute(`CREATE INDEX IF NOT EXISTS ${idxName} ON ${safeTable} (${safeCol});`);
            } catch {
              // Ignore if indexes are not supported by adapter or already exist
            }
          }
        }
      }
    }

    // Auto-create high performance composite index for multi-tenant soft-deleted queries
    if (
      this.knownColumns.has(`${tableName}:business_id`) &&
      this.knownColumns.has(`${tableName}:deleted`)
    ) {
      const compositeKey = `${tableName}:business_id_deleted`;
      if (!this.knownIndexes.has(compositeKey)) {
        this.knownIndexes.add(compositeKey);
        try {
          const idxName = escapeIdentifier(`idx_${tableName}_biz_del`);
          const safeBiz = escapeIdentifier('business_id');
          const safeDel = escapeIdentifier('deleted');
          await db.execute(
            `CREATE INDEX IF NOT EXISTS ${idxName} ON ${safeTable} (${safeBiz}, ${safeDel});`
          );
        } catch {
          // Ignore
        }
      }
    }

    // Format all values for SQLite storage
    const formatted: Record<string, any> = {};
    for (const key of keys) {
      formatted[key] = formatValueForStorage(payload[key]);
    }

    return formatted;
  }
}
