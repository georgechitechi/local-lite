import { LocalTransaction } from '../adapters/local/index.js';
import { SyncOp } from './types.js';
import { escapeIdentifier } from '../utils/sql.js';
import { SchemaManager, formatValueForStorage } from './schema-manager.js';

export interface TableMutationOptions {
  autoSchema?: boolean;
  schemaManager?: SchemaManager;
}

const defaultSchemaManager = new SchemaManager();

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

    let rowData: Record<string, any>;
    if (options?.autoSchema) {
      const formatted = await sm.ensureColumns(tx, tableName, payload, primaryKey);
      rowData = { ...formatted, [primaryKey]: rowId };
    } else {
      const formatted: Record<string, any> = {};
      if (payload && typeof payload === 'object') {
        for (const k of Object.keys(payload)) {
          formatted[k] = formatValueForStorage(payload[k]);
        }
      }
      rowData = { ...formatted, [primaryKey]: rowId };
    }

    const keys = Object.keys(rowData);
    if (keys.length === 0) return;

    const existing = await tx.execute(
      `SELECT 1 FROM ${safeTable} WHERE ${safePk} = ? LIMIT 1`,
      [rowId]
    );

    if (existing && existing.length > 0) {
      // Row exists -> perform UPDATE
      const updateKeys = keys.filter((k) => k !== primaryKey);
      if (updateKeys.length > 0) {
        const setClause = updateKeys.map((k) => `${escapeIdentifier(k)} = ?`).join(', ');
        const values = updateKeys.map((k) => rowData[k]);
        values.push(rowId);
        await tx.execute(`UPDATE ${safeTable} SET ${setClause} WHERE ${safePk} = ?`, values);
      }
    } else {
      // Row does not exist -> perform INSERT
      const cols = keys.map((k) => escapeIdentifier(k)).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map((k) => rowData[k]);
      await tx.execute(`INSERT INTO ${safeTable} (${cols}) VALUES (${placeholders})`, values);
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
