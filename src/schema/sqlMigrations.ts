import fs from 'node:fs';
import path from 'node:path';

export type SchemaFieldType =
  | 'string'
  | 'string | null'
  | 'number'
  | 'number | null'
  | 'boolean'
  | 'boolean | null'
  | 'json'
  | 'json | null'
  | 'string[]'
  | 'string[] | null';

export type SchemaDictionary = Record<string, Record<string, SchemaFieldType>>;

export interface SqlColumnDef {
  sqlType: string;
  nullable: boolean;
  defaultSql: string | null;
  primaryKey?: boolean;
}

export interface SqlIndexDef {
  name: string;
  columns: string[];
}

export interface SqlTableDef {
  columns: Record<string, SqlColumnDef>;
  indexes: SqlIndexDef[];
}

export interface SqlSchemaState {
  version: number;
  tables: Record<string, SqlTableDef>;
}

export type SqlDialect = 'mysql' | 'postgres' | 'sqlite';

export interface GenerateSqlMigrationOptions {
  dictionary: SchemaDictionary;
  migrationsDir: string;
  dialect?: SqlDialect;
  tableOrder?: readonly string[];
  name?: string;
  dryRun?: boolean;
  serverSchemaPath?: string;
  longTextColumns?: Iterable<string>;
  bigintColumns?: Iterable<string>;
}

export interface GenerateSqlMigrationResult {
  up: string[];
  down: string[];
  warnings: string[];
  sql: string;
  migrationPath?: string;
  serverSchemaPath?: string;
  schema: SqlSchemaState;
}

const DEFAULT_LONG_TEXT_COLUMNS = new Set([
  'remarks',
  'notes',
  'description',
  'body',
  'content',
  'message',
  'html',
  'template',
  'error',
  'reason',
  'summary',
  'terms',
  'signature',
  'payload',
  'raw_payload',
  'secret',
  'backup_codes',
]);

const DEFAULT_BIGINT_COLUMNS = new Set([
  'timestamp',
  'expires_at',
  'used_at',
  'revoked_at',
  'sort_order',
]);

const TAIL_COLUMN_ORDER = ['deleted', 'created_at', 'updated_at'];

function columnOrderRank(name: string): number {
  if (name === 'id') return -1;
  const tailIdx = TAIL_COLUMN_ORDER.indexOf(name);
  return tailIdx === -1 ? 0 : 1 + tailIdx;
}

function quoteIdent(name: string, dialect: SqlDialect): string {
  return dialect === 'mysql' ? `\`${name}\`` : `"${name}"`;
}

export function mapFieldTypeToSql(
  colName: string,
  fieldType: SchemaFieldType,
  options?: {
    dialect?: SqlDialect;
    longTextColumns?: Set<string>;
    bigintColumns?: Set<string>;
  },
): SqlColumnDef {
  const dialect = options?.dialect ?? 'mysql';
  const longText = options?.longTextColumns ?? DEFAULT_LONG_TEXT_COLUMNS;
  const bigintCols = options?.bigintColumns ?? DEFAULT_BIGINT_COLUMNS;

  const nullable = fieldType.endsWith(' | null');
  const baseType = nullable ? fieldType.slice(0, -' | null'.length) : fieldType;

  if (dialect === 'sqlite') {
    if (colName === 'id') {
      return {
        sqlType: 'TEXT',
        nullable: false,
        defaultSql: null,
        primaryKey: true,
      };
    }
    if (colName === 'deleted') {
      return { sqlType: 'INTEGER', nullable: false, defaultSql: '0' };
    }
    if (colName === 'updated_at') {
      return { sqlType: 'INTEGER', nullable: false, defaultSql: '0' };
    }
    if (baseType === 'json' || baseType === 'string[]') {
      return { sqlType: 'TEXT', nullable: true, defaultSql: null };
    }
    if (baseType === 'boolean') {
      return {
        sqlType: 'INTEGER',
        nullable,
        defaultSql: nullable ? 'NULL' : '0',
      };
    }
    if (baseType === 'number') {
      return {
        sqlType: bigintCols.has(colName) ? 'INTEGER' : 'REAL',
        nullable,
        defaultSql: nullable ? 'NULL' : null,
      };
    }
    return {
      sqlType: 'TEXT',
      nullable: nullable || longText.has(colName),
      defaultSql: nullable || longText.has(colName) ? 'NULL' : null,
    };
  }

  if (dialect === 'postgres') {
    if (colName === 'id') {
      return {
        sqlType: 'VARCHAR(128)',
        nullable: false,
        defaultSql: null,
        primaryKey: true,
      };
    }
    if (colName === 'deleted') {
      return { sqlType: 'BOOLEAN', nullable: false, defaultSql: 'FALSE' };
    }
    if (colName === 'updated_at') {
      return { sqlType: 'BIGINT', nullable: false, defaultSql: '0' };
    }
    if (baseType === 'json' || baseType === 'string[]') {
      return { sqlType: 'JSONB', nullable: true, defaultSql: null };
    }
    if (baseType === 'boolean') {
      return {
        sqlType: 'BOOLEAN',
        nullable,
        defaultSql: nullable ? 'NULL' : 'FALSE',
      };
    }
    if (baseType === 'number') {
      return {
        sqlType: bigintCols.has(colName) ? 'BIGINT' : 'DOUBLE PRECISION',
        nullable,
        defaultSql: nullable ? 'NULL' : null,
      };
    }
  }

  if (colName === 'id') {
    return {
      sqlType: 'VARCHAR(128)',
      nullable: false,
      defaultSql: null,
      primaryKey: true,
    };
  }
  if (colName === 'deleted') {
    return { sqlType: 'TINYINT(1)', nullable: false, defaultSql: '0' };
  }
  if (colName === 'updated_at') {
    return { sqlType: 'BIGINT', nullable: false, defaultSql: '0' };
  }

  if (baseType === 'json' || baseType === 'string[]') {
    return { sqlType: 'JSON', nullable: true, defaultSql: null };
  }

  if (baseType === 'boolean') {
    return {
      sqlType: 'TINYINT(1)',
      nullable,
      defaultSql: nullable ? 'NULL' : '0',
    };
  }

  if (baseType === 'number') {
    const sqlType = bigintCols.has(colName) ? 'BIGINT' : 'DOUBLE';
    return {
      sqlType,
      nullable,
      defaultSql: nullable ? 'NULL' : null,
    };
  }

  let sqlType = 'VARCHAR(255)';
  if (
    colName.endsWith('_id') ||
    colName === 'user_id' ||
    colName === 'business_id'
  ) {
    sqlType = 'VARCHAR(128)';
  } else if (longText.has(colName)) {
    sqlType = 'TEXT';
  } else if (colName.endsWith('_url') || colName === 'address') {
    sqlType = 'VARCHAR(512)';
  } else if (
    colName === 'date' ||
    colName.endsWith('_date') ||
    colName.endsWith('_at')
  ) {
    sqlType = 'VARCHAR(64)';
  }

  return {
    sqlType,
    nullable: nullable || sqlType === 'TEXT',
    defaultSql: nullable || sqlType === 'TEXT' ? 'NULL' : null,
  };
}

export function buildSqlTargetSchema(
  dictionary: SchemaDictionary,
  tableOrder: readonly string[] = [],
  options?: {
    dialect?: SqlDialect;
    longTextColumns?: Iterable<string>;
    bigintColumns?: Iterable<string>;
  },
): SqlSchemaState {
  const dialect = options?.dialect ?? 'mysql';
  const longTextColumns = options?.longTextColumns
    ? new Set(options.longTextColumns)
    : DEFAULT_LONG_TEXT_COLUMNS;
  const bigintColumns = options?.bigintColumns
    ? new Set(options.bigintColumns)
    : DEFAULT_BIGINT_COLUMNS;

  const tables: Record<string, SqlTableDef> = {};
  const orderedNames = [
    ...tableOrder.filter((name) =>
      Object.prototype.hasOwnProperty.call(dictionary, name),
    ),
    ...Object.keys(dictionary).filter((name) => !tableOrder.includes(name)),
  ];

  for (const tableName of orderedNames) {
    const fields = dictionary[tableName];
    const rawColumns: Record<string, SqlColumnDef> = {};

    for (const [colName, fieldType] of Object.entries(fields)) {
      rawColumns[colName] = mapFieldTypeToSql(colName, fieldType, {
        dialect,
        longTextColumns,
        bigintColumns,
      });
    }

    if (!rawColumns.updated_at) {
      rawColumns.updated_at = mapFieldTypeToSql('updated_at', 'number', {
        dialect,
        longTextColumns,
        bigintColumns,
      });
    }
    if (!rawColumns.deleted) {
      rawColumns.deleted = mapFieldTypeToSql('deleted', 'boolean', {
        dialect,
        longTextColumns,
        bigintColumns,
      });
    }

    const columns: Record<string, SqlColumnDef> = {};
    for (const colName of Object.keys(rawColumns).sort(
      (a, b) => columnOrderRank(a) - columnOrderRank(b),
    )) {
      columns[colName] = rawColumns[colName];
    }

    const idxName = (suffix: string) =>
      dialect === 'mysql' ? `idx_${suffix}` : `idx_${tableName}_${suffix}`;

    const indexes: SqlIndexDef[] = [];
    if (columns.business_id) {
      indexes.push({
        name: idxName('business_updated'),
        columns: ['business_id', 'updated_at'],
      });
    }
    indexes.push({
      name: idxName('updated_at'),
      columns: ['updated_at'],
    });

    for (const colName of Object.keys(columns)) {
      if (
        colName.endsWith('_id') &&
        colName !== 'business_id' &&
        colName !== 'user_id' &&
        colName !== 'entity_id'
      ) {
        indexes.push({
          name: idxName(colName),
          columns: [colName],
        });
      }
    }

    tables[tableName] = { columns, indexes };
  }

  return { version: 1, tables };
}

function formatColumnDef(
  colName: string,
  col: SqlColumnDef,
  dialect: SqlDialect,
): string {
  const parts = [quoteIdent(colName, dialect), col.sqlType];
  if (col.primaryKey) {
    parts.push('NOT NULL', 'PRIMARY KEY');
  } else {
    parts.push(col.nullable ? 'NULL' : 'NOT NULL');
    if (col.defaultSql && col.defaultSql !== 'NULL') {
      parts.push(`DEFAULT ${col.defaultSql}`);
    }
  }
  return parts.join(' ');
}

export function generateSqlDiff(
  prevSchema: SqlSchemaState | null,
  nextSchema: SqlSchemaState,
  dialect: SqlDialect = 'mysql',
): { up: string[]; down: string[]; warnings: string[] } {
  const up: string[] = [];
  const down: string[] = [];
  const warnings: string[] = [];
  const prevTables = prevSchema?.tables || {};

  for (const [tableName, nextTable] of Object.entries(nextSchema.tables)) {
    const prevTable = prevTables[tableName];
    const qTable = quoteIdent(tableName, dialect);

    if (!prevTable) {
      const colLines = Object.entries(nextTable.columns).map(
        ([colName, col]) => `  ${formatColumnDef(colName, col, dialect)}`,
      );
      if (dialect === 'mysql') {
        const idxLines = (nextTable.indexes || []).map(
          (idx) =>
            `  INDEX ${quoteIdent(idx.name, dialect)} (${idx.columns.map((c) => quoteIdent(c, dialect)).join(', ')})`,
        );
        const body = [...colLines, ...idxLines].join(',\n');
        up.push(
          `CREATE TABLE IF NOT EXISTS ${qTable} (\n${body}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
        );
      } else {
        const body = colLines.join(',\n');
        const idxStmts = (nextTable.indexes || []).map((idx) => {
          const cols = idx.columns
            .map((c) => quoteIdent(c, dialect))
            .join(', ');
          return `CREATE INDEX IF NOT EXISTS ${quoteIdent(idx.name, dialect)} ON ${qTable} (${cols});`;
        });
        up.push(
          [
            `CREATE TABLE IF NOT EXISTS ${qTable} (\n${body}\n);`,
            ...idxStmts,
          ].join('\n'),
        );
      }
      down.unshift(`DROP TABLE IF EXISTS ${qTable};`);
      continue;
    }

    for (const [colName, col] of Object.entries(nextTable.columns)) {
      const prevCol = prevTable.columns?.[colName];
      if (!prevCol) {
        const safeCol =
          !col.nullable && !col.defaultSql
            ? { ...col, nullable: true, defaultSql: 'NULL' }
            : col;
        up.push(
          dialect === 'mysql'
            ? `ALTER TABLE ${qTable} ADD COLUMN IF NOT EXISTS ${formatColumnDef(colName, safeCol, dialect)};`
            : `ALTER TABLE ${qTable} ADD COLUMN ${formatColumnDef(colName, safeCol, dialect)};`,
        );
        down.unshift(
          dialect === 'mysql'
            ? `ALTER TABLE ${qTable} DROP COLUMN IF EXISTS ${quoteIdent(colName, dialect)};`
            : `ALTER TABLE ${qTable} DROP COLUMN ${quoteIdent(colName, dialect)};`,
        );
      } else if (prevCol.sqlType !== col.sqlType) {
        warnings.push(
          `Column type changed for ${tableName}.${colName} (${prevCol.sqlType} -> ${col.sqlType}); review manually before altering.`,
        );
      }
    }

    for (const prevColName of Object.keys(prevTable.columns || {})) {
      if (!nextTable.columns[prevColName]) {
        warnings.push(
          `Column removed from schema: ${tableName}.${prevColName}; skipped DROP COLUMN to preserve data.`,
        );
      }
    }

    const prevIdxNames = new Set((prevTable.indexes || []).map((i) => i.name));
    for (const idx of nextTable.indexes || []) {
      if (!prevIdxNames.has(idx.name)) {
        const cols = idx.columns.map((c) => quoteIdent(c, dialect)).join(', ');
        const qIdx = quoteIdent(idx.name, dialect);
        if (dialect === 'mysql') {
          up.push(`CREATE INDEX ${qIdx} ON ${qTable} (${cols});`);
          down.unshift(`DROP INDEX ${qIdx} ON ${qTable};`);
        } else {
          up.push(`CREATE INDEX IF NOT EXISTS ${qIdx} ON ${qTable} (${cols});`);
          down.unshift(`DROP INDEX IF EXISTS ${qIdx};`);
        }
      }
    }
  }

  for (const prevTableName of Object.keys(prevTables)) {
    if (prevTableName.startsWith('_')) continue;
    if (!nextSchema.tables[prevTableName]) {
      warnings.push(
        `Table removed from schema: ${prevTableName}; skipped DROP TABLE to preserve data.`,
      );
    }
  }

  return { up, down, warnings };
}

function extractUpSql(rawSql: string): string {
  const lines: string[] = [];
  let active: 'up' | 'other' | null = null;
  for (const line of rawSql.split(/\r?\n/)) {
    const marker = line.trim().toLowerCase();
    if (marker === '-- +up') {
      active = 'up';
      continue;
    }
    if (
      marker === '-- +down' ||
      marker === '-- +up-optional' ||
      marker === '-- +down-optional'
    ) {
      active = 'other';
      continue;
    }
    if (active === 'up') lines.push(line);
  }
  return lines.join('\n');
}

function splitTopLevel(input: string, delimiter = ';'): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;
  let inLineComment = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (!quote && ch === '-' && next === '-') {
      inLineComment = true;
      i++;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === '\\' && next) {
        current += next;
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;

    if (ch === delimiter && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }

  const trailing = current.trim();
  if (trailing) parts.push(trailing);
  return parts;
}

function parseSqlType(rest: string): string {
  const match = rest
    .trim()
    .match(/^([A-Za-z]+(?:\s*\([^)]*\))?(?:\s+UNSIGNED)?)/i);
  return match ? match[1].replace(/\s+/g, ' ').toUpperCase() : '';
}

function parseColumnList(rawCols: string): string[] {
  return rawCols
    .split(',')
    .map(
      (c) =>
        c
          .trim()
          .replace(/^[`"]|[`"]$/g, '')
          .split(/\s+/)[0],
    )
    .filter(Boolean);
}

function applySqlStatement(
  tables: Record<string, SqlTableDef>,
  stmt: string,
): void {
  const createTableMatch = stmt.match(
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([\s\S]*)\)\s*(?:ENGINE=|DEFAULT|CHARSET|COLLATE|;|$)/i,
  );
  if (createTableMatch) {
    const tableName = createTableMatch[1];
    const body = createTableMatch[2];
    const columns: Record<string, SqlColumnDef> = {};
    const indexes: SqlIndexDef[] = [];

    for (const item of splitTopLevel(body, ',')) {
      const idxMatch = item.match(
        /^(?:UNIQUE\s+)?(?:INDEX|KEY)\s+[`"]?(\w+)[`"]?\s*\(([^)]+)\)/i,
      );
      if (idxMatch) {
        indexes.push({
          name: idxMatch[1],
          columns: parseColumnList(idxMatch[2]),
        });
        continue;
      }
      if (
        /^(?:PRIMARY\s+KEY|CONSTRAINT|FOREIGN\s+KEY|FULLTEXT|SPATIAL|CHECK)\b/i.test(
          item,
        )
      ) {
        continue;
      }
      const colMatch = item.match(/^[`"]?(\w+)[`"]?\s+([\s\S]+)$/);
      if (colMatch) {
        columns[colMatch[1]] = {
          sqlType: parseSqlType(colMatch[2]),
          nullable: !/\bNOT\s+NULL\b/i.test(colMatch[2]),
          defaultSql: null,
        };
      }
    }

    tables[tableName] = { columns, indexes };
    return;
  }

  const dropTableMatch = stmt.match(
    /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)[`"]?/i,
  );
  if (dropTableMatch) {
    delete tables[dropTableMatch[1]];
    return;
  }

  const createIdxMatch = stmt.match(
    /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s+ON\s+[`"]?(\w+)[`"]?\s*\(([^)]+)\)/i,
  );
  if (createIdxMatch) {
    const [, idxName, tableName, rawCols] = createIdxMatch;
    if (tables[tableName]) {
      tables[tableName].indexes.push({
        name: idxName,
        columns: parseColumnList(rawCols),
      });
    }
    return;
  }

  const dropIdxMatch = stmt.match(
    /^DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)[`"]?(?:\s+ON\s+[`"]?(\w+)[`"]?)?/i,
  );
  if (dropIdxMatch) {
    const [, idxName, tableName] = dropIdxMatch;
    if (tableName && tables[tableName]) {
      tables[tableName].indexes = tables[tableName].indexes.filter(
        (i) => i.name !== idxName,
      );
    } else if (!tableName) {
      for (const tbl of Object.values(tables)) {
        tbl.indexes = tbl.indexes.filter((i) => i.name !== idxName);
      }
    }
    return;
  }

  const alterMatch = stmt.match(
    /^ALTER\s+TABLE\s+[`"]?(\w+)[`"]?\s+([\s\S]+)$/i,
  );
  if (alterMatch) {
    const tableName = alterMatch[1];
    const table = tables[tableName];
    if (!table) return;

    for (const clause of splitTopLevel(alterMatch[2], ',')) {
      const addCol = clause.match(
        /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s+([\s\S]+)$/i,
      );
      if (
        addCol &&
        !/^(?:UNIQUE|INDEX|KEY|CONSTRAINT|PRIMARY|FOREIGN)\b/i.test(addCol[1])
      ) {
        table.columns[addCol[1]] = {
          sqlType: parseSqlType(addCol[2]),
          nullable: !/\bNOT\s+NULL\b/i.test(addCol[2]),
          defaultSql: null,
        };
        continue;
      }
      const dropCol = clause.match(
        /^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?[`"]?(\w+)[`"]?$/i,
      );
      if (dropCol) {
        delete table.columns[dropCol[1]];
        continue;
      }
      const modCol = clause.match(
        /^MODIFY\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?\s+([\s\S]+)$/i,
      );
      if (modCol) {
        table.columns[modCol[1]] = {
          sqlType: parseSqlType(modCol[2]),
          nullable: !/\bNOT\s+NULL\b/i.test(modCol[2]),
          defaultSql: null,
        };
        continue;
      }
      const changeCol = clause.match(
        /^CHANGE\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?\s+[`"]?(\w+)[`"]?\s+([\s\S]+)$/i,
      );
      if (changeCol) {
        delete table.columns[changeCol[1]];
        table.columns[changeCol[2]] = {
          sqlType: parseSqlType(changeCol[3]),
          nullable: !/\bNOT\s+NULL\b/i.test(changeCol[3]),
          defaultSql: null,
        };
        continue;
      }
      const addIdx = clause.match(
        /^ADD\s+(?:UNIQUE\s+)?(?:INDEX|KEY)\s+[`"]?(\w+)[`"]?\s*\(([^)]+)\)/i,
      );
      if (addIdx) {
        table.indexes.push({
          name: addIdx[1],
          columns: parseColumnList(addIdx[2]),
        });
        continue;
      }
      const dropIdx = clause.match(/^DROP\s+(?:INDEX|KEY)\s+[`"]?(\w+)[`"]?$/i);
      if (dropIdx) {
        table.indexes = table.indexes.filter((i) => i.name !== dropIdx[1]);
      }
    }
  }
}

export function loadSqlSchemaFromMigrations(
  migrationsDir: string,
): SqlSchemaState | null {
  if (!fs.existsSync(migrationsDir)) return null;
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) return null;

  const tables: Record<string, SqlTableDef> = {};
  for (const file of files) {
    const rawSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const upSql = extractUpSql(rawSql);
    for (const stmt of splitTopLevel(upSql, ';')) {
      applySqlStatement(tables, stmt);
    }
  }
  return { version: 1, tables };
}

export function formatSyncedSchemaTs(schema: SqlSchemaState): string {
  const entries = Object.entries(schema.tables).map(([tableName, table]) => {
    const cols = Object.keys(table.columns)
      .map((c) => `'${c}'`)
      .join(', ');
    return `  ${tableName}: [${cols}],`;
  });
  return [
    '// Auto-generated by local-lite db:generate',
    'export const SYNCED_TABLE_COLUMNS: Record<string, readonly string[]> = {',
    ...entries,
    '};',
    '',
  ].join('\n');
}

function formatTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

export function generateSqlMigration(
  options: GenerateSqlMigrationOptions,
): GenerateSqlMigrationResult {
  const dialect = options.dialect ?? 'mysql';
  const nextSchema = buildSqlTargetSchema(
    options.dictionary,
    options.tableOrder,
    {
      dialect,
      longTextColumns: options.longTextColumns,
      bigintColumns: options.bigintColumns,
    },
  );
  const prevSchema = loadSqlSchemaFromMigrations(options.migrationsDir);
  const { up, down, warnings } = generateSqlDiff(
    prevSchema,
    nextSchema,
    dialect,
  );
  const sql =
    up.length > 0
      ? `-- +up\n${up.join('\n\n')}\n\n-- +down\n${down.join('\n')}\n`
      : '';

  const result: GenerateSqlMigrationResult = {
    up,
    down,
    warnings,
    sql,
    schema: nextSchema,
  };

  if (options.dryRun) {
    return result;
  }

  if (up.length > 0) {
    fs.mkdirSync(options.migrationsDir, { recursive: true });
    const safeName = (options.name || 'auto_schema')
      .replace(/[^a-z0-9_]+/gi, '_')
      .toLowerCase();
    const outPath = path.join(
      options.migrationsDir,
      `${formatTimestamp()}_${safeName}.sql`,
    );
    fs.writeFileSync(outPath, sql, 'utf8');
    result.migrationPath = outPath;
  }

  if (
    options.serverSchemaPath &&
    (up.length > 0 || !fs.existsSync(options.serverSchemaPath))
  ) {
    fs.mkdirSync(path.dirname(options.serverSchemaPath), { recursive: true });
    fs.writeFileSync(
      options.serverSchemaPath,
      formatSyncedSchemaTs(nextSchema),
      'utf8',
    );
    result.serverSchemaPath = options.serverSchemaPath;
  }

  return result;
}
