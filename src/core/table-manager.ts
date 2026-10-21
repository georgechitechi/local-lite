import { LocalTransaction } from '../adapters/local/index.js';
import { SyncOp } from './types.js';
import { escapeIdentifier } from '../utils/sql.js';
import { SchemaManager, formatValueForStorage } from './schema-manager.js';

export interface TableMutationOptions {
  autoSchema?: boolean;
  schemaManager?: SchemaManager;
  /**
   * Column to stamp with `touchValue` on local writes (e.g. 'updated_at').
   * - UPDATE: always overwritten (mirrors what remote adapters do on push).
   * - INSERT: only set when the payload does not already provide a value.
   * Skipped when the column does not exist and autoSchema is disabled.
   */
  touchColumn?: string | null;
  /** Value written to `touchColumn`. Default: current time as an ISO string. */
  touchValue?: any;
}

const defaultSchemaManager = new SchemaManager();

function formatPayload(payload: Record<string, any> | null): Record<string, any> {
  const formatted: Record<string, any> = {};
  if (payload && typeof payload === 'object') {
    for (const [k, v] of Object.entries(payload)) {
      formatted[k] = formatValueForStorage(v);
    }
  }
  return formatted;
}

async function withTouchedColumn(
  tx: LocalTransaction,
  sm: SchemaManager,
  tableName: string,
  operation: SyncOp,
  payload: Record<string, any> | null,
  options: TableMutationOptions
): Promise<Record<string, any> | null> {
  const col = options.touchColumn as string;
  if (operation === 'INSERT' && payload && payload[col] !== undefined && payload[col] !== null) {
    return payload;
  }
  if (!options.autoSchema && !(await sm.tableHasColumn(tx, tableName, col))) {
    return payload;
  }
  return { ...(payload || {}), [col]: options.touchValue ?? new Date().toISOString() };
}

export class TableManager {
  /**
   * Applies an insert, update, or delete mutation on a local data table.
   * If an INSERT is specified but the row already exists, it gracefully executes an UPDATE.
   * If an UPDATE is specified but the row does not exist, it inserts it.
   */
  static async applyMutation(
    tx: LocalTransaction,
    tableName: string,
    rowId: string,
    operation: SyncOp,
    payload: Record<string, any> | null,
    primaryKey: string = 'id',
    options?: TableMutationOptions
  ): Promise<void> {
    const safeTable = escapeIdentifier(tableName);
    const safePk = escapeIdentifier(primaryKey);
    const sm = options?.schemaManager ?? defaultSchemaManager;

    if (options?.autoSchema) {
      await sm.ensureTable(tx, tableName, primaryKey);
    }

    if (operation === 'DELETE') {
      await tx.execute(`DELETE FROM ${safeTable} WHERE ${safePk} = ?`, [rowId]);
      return;
    }

    if (options?.touchColumn) {
      payload = await withTouchedColumn(tx, sm, tableName, operation, payload, options);
    }

    const formatted = options?.autoSchema
      ? await sm.ensureColumns(tx, tableName, payload, primaryKey)
      : formatPayload(payload);
    const rowData: Record<string, any> = { ...formatted, [primaryKey]: rowId };
    const keys = Object.keys(rowData);
    if (keys.length === 0) return;

    // Use atomic SQLite UPSERT (INSERT ... ON CONFLICT DO UPDATE) for both INSERT and UPDATE.
    // Handles missing rows, existing rows, and partial updates in a single SQL round-trip,
    // completely eliminating the redundant SELECT 1 pre-check on every mutation!
    const updateKeys = keys.filter((k) => k !== primaryKey);
    const cols = keys.map((k) => escapeIdentifier(k)).join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((k) => rowData[k]);

    if (updateKeys.length > 0) {
      const updateClause = updateKeys
        .map((k) => `${escapeIdentifier(k)} = excluded.${escapeIdentifier(k)}`)
        .join(', ');
      await tx.execute(
        `INSERT INTO ${safeTable} (${cols}) VALUES (${placeholders}) ON CONFLICT (${safePk}) DO UPDATE SET ${updateClause}`,
        values
      );
    } else {
      await tx.execute(
        `INSERT OR IGNORE INTO ${safeTable} (${cols}) VALUES (${placeholders})`,
        values
      );
    }
  }

  /**
   * Fetches an existing row from a local table by primary key.
   */
  static async fetchRow(
    tx: LocalTransaction,
    tableName: string,
    rowId: string,
    primaryKey: string = 'id',
    options?: TableMutationOptions
  ): Promise<Record<string, any> | null> {
    const safeTable = escapeIdentifier(tableName);
    const safePk = escapeIdentifier(primaryKey);
    const sm = options?.schemaManager ?? defaultSchemaManager;

    if (options?.autoSchema) {
      await sm.ensureTable(tx, tableName, primaryKey);
    }

    const rows = await tx.execute(
      `SELECT * FROM ${safeTable} WHERE ${safePk} = ? LIMIT 1`,
      [rowId]
    );

    return rows && rows.length > 0 ? rows[0] : null;
  }
}
