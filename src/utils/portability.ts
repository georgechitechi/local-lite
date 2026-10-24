import type { LocalFirstClient } from '../core/client.js';
import { escapeIdentifier } from './sql.js';

export interface ExportJsonOptions {
  /** Pretty-print JSON with 2-space indentation. Default: false */
  pretty?: boolean;
  /** Explicit list of tables to export. If not specified, exports all registered tables. */
  tables?: string[];
}

export interface JsonExportData {
  version: number;
  exportedAt: string;
  tables: Record<string, Array<Record<string, any>>>;
}

export interface ImportJsonOptions {
  /**
   * 'merge' (default): updates existing rows and inserts new rows using primary key.
   * 'replace': deletes all rows in the table before inserting the imported data.
   */
  mode?: 'merge' | 'replace';
  /**
   * Whether to skip queueing outbox mutations for remote sync.
   * When true, imported data is only stored in local SQLite without triggering sync pushes.
   * Default: false.
   */
  skipOutbox?: boolean;
  /** Whitelist of tables to import. If specified, any tables in JSON not in this list are ignored. */
  tables?: string[];
}

export interface ExportCsvOptions {
  /** Columns to export in order. If omitted, uses all columns from the table. */
  columns?: string[];
  /** Field delimiter. Default: ',' */
  delimiter?: string;
  /** Whether to output the first row as column headers. Default: true */
  includeHeader?: boolean;
}

export interface ImportCsvOptions {
  /** 'merge' (default) or 'replace' */
  mode?: 'merge' | 'replace';
  /** Whether to skip queueing outbox records. Default: false */
  skipOutbox?: boolean;
  /** Field delimiter. Default: ',' */
  delimiter?: string;
  /** Whether the first line contains header columns. Default: true */
  hasHeader?: boolean;
  /** Explicit column names if CSV has no header. */
  columns?: string[];
}

export interface ImportSummary {
  tables: string[];
  rowCounts: Record<string, number>;
}

/**
 * Escapes a single CSV cell value according to RFC-4180.
 */
function escapeCsvValue(val: any, delimiter: string): string {
  if (val === null || val === undefined) {
    return '';
  }
  let str: string;
  if (typeof val === 'object') {
    str = JSON.stringify(val);
  } else {
    str = String(val);
  }

  // Quote if contains delimiter, double quote, or newlines
  if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Robust RFC-4180 CSV parser supporting multiline fields and escaped quotes.
 */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          // Escaped quote
          currentVal += '"';
          i += 2;
          continue;
        } else {
          // End quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentVal += char;
        i++;
        continue;
      }
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (char === delimiter) {
      currentRow.push(currentVal);
      currentVal = '';
      i++;
      continue;
    }

    if (char === '\r') {
      if (i + 1 < text.length && text[i + 1] === '\n') {
        i++;
      }
      currentRow.push(currentVal);
      currentVal = '';
      rows.push(currentRow);
      currentRow = [];
      i++;
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentVal);
      currentVal = '';
      rows.push(currentRow);
      currentRow = [];
      i++;
      continue;
    }

    currentVal += char;
    i++;
  }

  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Exports SQLite tables to a structured JSON string.
 */
export async function exportTablesToJson(
  client: LocalFirstClient,
  tables?: string[],
  options: ExportJsonOptions = {},
): Promise<string> {
  const targetTables = tables && tables.length > 0 ? tables : client.tables;
  const result: JsonExportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: {},
  };

  for (const table of targetTables) {
    try {
      const rows = await client.findMany(table);
      result.tables[table] = rows;
    } catch {
      result.tables[table] = [];
    }
  }

  return JSON.stringify(result, null, options.pretty ? 2 : undefined);
}

/**
 * Imports tables from a JSON export string into the database.
 */
export async function importTablesFromJson(
  client: LocalFirstClient,
  jsonString: string,
  options: ImportJsonOptions = {},
): Promise<ImportSummary> {
  let parsed: JsonExportData;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: any) {
    throw new Error(`Invalid JSON export format: ${err.message}`);
  }

  if (!parsed || typeof parsed.tables !== 'object') {
    throw new Error('Invalid JSON export format: missing tables object.');
  }

  const mode = options.mode ?? 'merge';
  const skipOutbox = options.skipOutbox ?? false;
  const filterTables = options.tables ? new Set(options.tables) : null;
  const pk = client.getPrimaryKey();

  const importedTables: string[] = [];
  const rowCounts: Record<string, number> = {};

  for (const [table, rows] of Object.entries(parsed.tables)) {
    if (filterTables && !filterTables.has(table)) {
      continue;
    }
    if (!Array.isArray(rows)) {
      continue;
    }

    importedTables.push(table);
    rowCounts[table] = 0;

    await client.transaction(async tx => {
      if (mode === 'replace') {
        const safeTable = escapeIdentifier(table);
        await tx.query(`DELETE FROM ${safeTable}`);
      }

      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const id = String(row[pk] ?? row.id ?? row.ID);
        if (!id) continue;

        // Upsert row
        await tx.mutate(table, id, 'INSERT', row, { primaryKey: pk, skipOutbox });
        rowCounts[table]++;
      }
    });
  }

  return { tables: importedTables, rowCounts };
}

/**
 * Exports a single SQLite table to an RFC-4180 CSV string.
 */
export async function exportTableToCsv(
  client: LocalFirstClient,
  tableName: string,
  options: ExportCsvOptions = {},
): Promise<string> {
  const delimiter = options.delimiter ?? ',';
  const includeHeader = options.includeHeader ?? true;
  const rows = await client.findMany(tableName);

  if (rows.length === 0) {
    if (options.columns && includeHeader) {
      return options.columns.map(c => escapeCsvValue(c, delimiter)).join(delimiter);
    }
    return '';
  }

  // Determine columns
  const columns = options.columns && options.columns.length > 0
    ? options.columns
    : Object.keys(rows[0]);

  const lines: string[] = [];

  if (includeHeader) {
    lines.push(columns.map(c => escapeCsvValue(c, delimiter)).join(delimiter));
  }

  for (const row of rows) {
    const values = columns.map(col => escapeCsvValue(row[col], delimiter));
    lines.push(values.join(delimiter));
  }

  return lines.join('\n');
}

/**
 * Imports an RFC-4180 CSV string into a SQLite table.
 */
export async function importTableFromCsv(
  client: LocalFirstClient,
  tableName: string,
  csvString: string,
  options: ImportCsvOptions = {},
): Promise<{ rowCount: number }> {
  if (!csvString || !csvString.trim()) {
    return { rowCount: 0 };
  }

  const delimiter = options.delimiter ?? ',';
  const hasHeader = options.hasHeader ?? true;
  const mode = options.mode ?? 'merge';
  const skipOutbox = options.skipOutbox ?? false;
  const pk = client.getPrimaryKey();

  const parsedRows = parseCsv(csvString.trim(), delimiter);
  if (parsedRows.length === 0) {
    return { rowCount: 0 };
  }

  let columns: string[];
  let dataRows: string[][];

  if (hasHeader) {
    columns = parsedRows[0].map(c => c.trim());
    dataRows = parsedRows.slice(1);
  } else {
    if (!options.columns || options.columns.length === 0) {
      throw new Error('Explicit columns must be specified when CSV has no header.');
    }
    columns = options.columns;
    dataRows = parsedRows;
  }

  let importedCount = 0;

  await client.transaction(async tx => {
    if (mode === 'replace') {
      const safeTable = escapeIdentifier(tableName);
      await tx.query(`DELETE FROM ${safeTable}`);
    }

    for (const rowVals of dataRows) {
      if (rowVals.length === 0 || (rowVals.length === 1 && !rowVals[0].trim())) {
        continue;
      }

      const payload: Record<string, any> = {};
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const raw = rowVals[i];
        if (raw === undefined || raw === '') {
          payload[col] = null;
          continue;
        }

        // Auto-detect JSON, boolean, and numeric types
        const trimmed = raw.trim();
        if (
          (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
          try {
            payload[col] = JSON.parse(trimmed);
            continue;
          } catch {
            // Keep as string
          }
        }

        if (trimmed.toLowerCase() === 'true') {
          payload[col] = 1;
        } else if (trimmed.toLowerCase() === 'false') {
          payload[col] = 0;
        } else if (!isNaN(Number(trimmed)) && trimmed !== '') {
          payload[col] = Number(trimmed);
        } else {
          payload[col] = raw;
        }
      }

      const id = String(payload[pk] ?? payload.id);
      if (!id) continue;

      await tx.mutate(tableName, id, 'INSERT', payload, { primaryKey: pk, skipOutbox });
      importedCount++;
    }
  });

  return { rowCount: importedCount };
}
