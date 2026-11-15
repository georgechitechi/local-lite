import type { LocalDBAdapter } from '../adapters/local/index.js';
import { DEFAULT_KV_STORE_TABLE, KVStore } from '../kv-store/store.js';
import { escapeIdentifier, isInternalTable, isReadQuery } from '../utils/sql.js';

export interface DashboardHandlerOptions {
  /** Display title in the dashboard header. */
  title?: string;
  /** Disable mutations and mutating SQL queries. Defaults to false. */
  readOnly?: boolean;
  /** Optional bearer/query token required to access the dashboard and its APIs. */
  authToken?: string;
  /** Base path if mounted under a sub-path (e.g. '/_dashboard'). Defaults to ''. */
  basePath?: string;
}

interface TableColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

interface TableIndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

interface TableSummary {
  name: string;
  internal: boolean;
  rowCount: number;
  columns: TableColumnInfo[];
  indexes: TableIndexInfo[];
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

function isAuthorized(request: Request, url: URL, authToken?: string): boolean {
  if (!authToken) return true;
  const header = request.headers.get('authorization');
  if (header === `Bearer ${authToken}`) return true;
  if (url.searchParams.get('token') === authToken) return true;
  return false;
}

async function listTables(db: LocalDBAdapter): Promise<TableSummary[]> {
  const tablesRows = await db.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC;`,
  );
  const summaries: TableSummary[] = [];

  for (const row of tablesRows ?? []) {
    const name = String(row.name ?? '');
    if (!name) continue;
    const quoted = escapeIdentifier(name);
    const [infoRows, countRows, indexListRows] = await Promise.all([
      db.execute(`PRAGMA table_info(${quoted});`),
      db.execute(`SELECT COUNT(*) AS cnt FROM ${quoted};`),
      db.execute(`PRAGMA index_list(${quoted});`).catch(() => [] as any[]),
    ]);

    const columns: TableColumnInfo[] = (infoRows ?? []).map((col: any) => ({
      cid: Number(col.cid ?? 0),
      name: String(col.name ?? ''),
      type: String(col.type ?? ''),
      notnull: Number(col.notnull ?? 0),
      dflt_value: col.dflt_value ?? null,
      pk: Number(col.pk ?? 0),
    }));

    const indexes: TableIndexInfo[] = [];
    for (const idx of indexListRows ?? []) {
      const idxName = String(idx.name ?? '');
      if (!idxName) continue;
      const idxInfoRows = await db
        .execute(`PRAGMA index_info(${escapeIdentifier(idxName)});`)
        .catch(() => [] as any[]);
      indexes.push({
        name: idxName,
        unique: Boolean(idx.unique),
        columns: (idxInfoRows ?? [])
          .map((item: any) => String(item.name ?? ''))
          .filter(Boolean),
      });
    }

    const rowCount = Number(countRows?.[0]?.cnt ?? 0);
    summaries.push({
      name,
      internal: isInternalTable(name),
      rowCount,
      columns,
      indexes,
    });
  }
  return summaries;
}

async function readRowsIfTableExists(
  db: LocalDBAdapter,
  tableName: string,
  limit = 100,
): Promise<any[] | null> {
  const exists = await db.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?;`,
    [tableName],
  );
  if (!exists?.length) return null;
  const rows = await db.execute(
    `SELECT * FROM ${escapeIdentifier(tableName)} LIMIT ?;`,
    [limit],
  );
  return rows ?? [];
}

function toCsv(columns: string[], rows: any[]): string {
  const escapeCell = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const header = columns.map(escapeCell).join(',');
  const lines = rows.map((row) =>
    columns.map((col) => escapeCell(row?.[col])).join(','),
  );
  return [header, ...lines].join('\r\n');
}

/**
 * Creates a Web Standard Request/Response handler for the local-lite dashboard.
 * Can be mounted on any Node, Bun, Deno, or Edge server, or launched via `local-lite dashboard`.
 */
export function createDashboardHandler(
  db: LocalDBAdapter,
  options: DashboardHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const title = options.title ?? 'local-lite Dashboard';
  const readOnly = Boolean(options.readOnly);
  const basePath = (options.basePath ?? '').replace(/\/+$/, '');

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    let pathname = url.pathname;
    if (basePath && pathname.startsWith(basePath)) {
      pathname = pathname.slice(basePath.length) || '/';
    }

    if (!isAuthorized(request, url, options.authToken)) {
      return errorResponse('Unauthorized.', 401);
    }

    try {
      if (
        request.method === 'GET' &&
        (pathname === '/' || pathname === '/index.html' || pathname.startsWith('/assets/'))
      ) {
        const staticRes = await tryServeDashboardAsset(pathname, title);
        if (staticRes) return staticRes;
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head><body style="font-family:sans-serif;background:#0b0d12;color:#e6ebf5;padding:32px;"><h2>${escapeHtml(title)}</h2><p>Dashboard UI not built. Run <code>npm --prefix dashboard run build</code> or launch via <code>npx local-lite dashboard</code>.</p></body></html>`,
          {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          },
        );
      }

      if (request.method === 'GET' && pathname === '/api/overview') {
        const [tables, versionRows, journalRows, pageSizeRows, pageCountRows] =
          await Promise.all([
            listTables(db),
            db.execute('SELECT sqlite_version() AS version;'),
            db.execute('PRAGMA journal_mode;').catch(() => [] as any[]),
            db.execute('PRAGMA page_size;').catch(() => [] as any[]),
            db.execute('PRAGMA page_count;').catch(() => [] as any[]),
          ]);

        const dataTables = tables.filter((t) => !t.internal);
        const systemTables = tables.filter((t) => t.internal);
        const totalRows = dataTables.reduce((acc, t) => acc + t.rowCount, 0);
        const totalIndexes = tables.reduce((acc, t) => acc + t.indexes.length, 0);
        const pageSize = Number(pageSizeRows?.[0]?.page_size ?? 0);
        const pageCount = Number(pageCountRows?.[0]?.page_count ?? 0);

        return jsonResponse({
          title,
          readOnly,
          sqliteVersion: String(versionRows?.[0]?.version ?? 'unknown'),
          journalMode: String(journalRows?.[0]?.journal_mode ?? 'unknown'),
          databaseSizeBytes: pageSize * pageCount,
          dataTableCount: dataTables.length,
          systemTableCount: systemTables.length,
          totalDataRows: totalRows,
          totalIndexes,
          topTables: [...dataTables]
            .sort((a, b) => b.rowCount - a.rowCount)
            .slice(0, 8)
            .map((t) => ({ name: t.name, rowCount: t.rowCount })),
        });
      }

      if (request.method === 'GET' && pathname === '/api/tables') {
        const tables = await listTables(db);
        return jsonResponse({ tables });
      }

      if (request.method === 'GET' && pathname === '/api/schema/sql') {
        const dialectRaw = (url.searchParams.get('dialect') ?? 'sqlite').toLowerCase();
        const dialect = ['sqlite', 'postgres', 'mysql'].includes(dialectRaw)
          ? dialectRaw
          : 'sqlite';
        const includeSystem = url.searchParams.get('includeSystem') === '1';
        const onlyTable = url.searchParams.get('table');
        const allTables = await listTables(db);
        const selected = allTables.filter((t) => {
          if (onlyTable && t.name !== onlyTable) return false;
          if (!onlyTable && !includeSystem && t.internal) return false;
          return true;
        });

        const quoteId = (id: string) =>
          dialect === 'mysql'
            ? `\`${id.replace(/`/g, '``')}\``
            : escapeIdentifier(id);

        const mapColType = (rawType: string, isPk: boolean) => {
          const upper = (rawType || 'TEXT').toUpperCase();
          if (dialect === 'sqlite') return upper;
          if (dialect === 'postgres') {
            if (upper.includes('INT')) return 'BIGINT';
            if (upper.includes('REAL') || upper.includes('FLOA') || upper.includes('DOUB')) return 'DOUBLE PRECISION';
            if (upper.includes('BLOB')) return 'BYTEA';
            if (upper.includes('NUM') || upper.includes('DEC')) return 'NUMERIC';
            return 'TEXT';
          }
          // mysql
          if (upper.includes('INT')) return 'BIGINT';
          if (upper.includes('REAL') || upper.includes('FLOA') || upper.includes('DOUB')) return 'DOUBLE';
          if (upper.includes('BLOB')) return 'LONGBLOB';
          if (upper.includes('NUM') || upper.includes('DEC')) return 'DECIMAL(18, 4)';
          return isPk ? 'VARCHAR(255)' : 'TEXT';
        };

        const statements: string[] = [];
        for (const t of selected) {
          const pkCols = t.columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
          const singlePk = pkCols.length === 1;
          const lines = t.columns.map((c) => {
            const parts = [quoteId(c.name), mapColType(c.type, c.pk > 0)];
            if (singlePk && c.pk > 0) parts.push('PRIMARY KEY');
            if (c.notnull > 0 && !(singlePk && c.pk > 0)) parts.push('NOT NULL');
            if (c.dflt_value != null) parts.push(`DEFAULT ${String(c.dflt_value)}`);
            return `  ${parts.join(' ')}`;
          });
          if (pkCols.length > 1) {
            lines.push(`  PRIMARY KEY (${pkCols.map((c) => quoteId(c.name)).join(', ')})`);
          }
          statements.push(
            `CREATE TABLE IF NOT EXISTS ${quoteId(t.name)} (\n${lines.join(',\n')}\n);`,
          );
          for (const idx of t.indexes) {
            if (idx.name.startsWith('sqlite_autoindex_') || idx.columns.length === 0) {
              continue;
            }
            const uniqueSql = idx.unique ? 'UNIQUE ' : '';
            const ifNotExists = dialect === 'mysql' ? '' : 'IF NOT EXISTS ';
            statements.push(
              `CREATE ${uniqueSql}INDEX ${ifNotExists}${quoteId(idx.name)} ON ${quoteId(t.name)} (${idx.columns.map(quoteId).join(', ')});`,
            );
          }
        }

        const sql = statements.join('\n\n');
        if (url.searchParams.get('download') === '1') {
          return new Response(sql, {
            status: 200,
            headers: {
              'Content-Type': 'application/sql; charset=utf-8',
              'Content-Disposition': `attachment; filename="schema-${dialect}.sql"`,
            },
          });
        }
        return jsonResponse({ dialect, tableCount: selected.length, sql });
      }

      if (request.method === 'POST' && pathname === '/api/tables') {
        if (readOnly) {
          return errorResponse('Dashboard is running in read-only mode.', 403);
        }
        const body = (await request.json().catch(() => null)) as {
          name?: string;
          columns?: Array<{
            name: string;
            type?: string;
            pk?: boolean;
            notnull?: boolean;
          }>;
        } | null;
        const name = String(body?.name ?? '').trim();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
          return errorResponse('Invalid table name. Use letters, numbers, and underscores.', 400);
        }
        if (isInternalTable(name)) {
          return errorResponse('Cannot create an internal system table.', 400);
        }
        const cols = Array.isArray(body?.columns) ? body.columns : [];
        if (cols.length === 0) {
          return errorResponse('At least one column is required.', 400);
        }
        const allowedTypes = new Set(['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC']);
        const colDefs = cols.map((c) => {
          const colName = String(c.name ?? '').trim();
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(colName)) {
            throw new Error(`Invalid column name: ${colName}`);
          }
          const colType = allowedTypes.has(String(c.type ?? 'TEXT').toUpperCase())
            ? String(c.type ?? 'TEXT').toUpperCase()
            : 'TEXT';
          const parts = [escapeIdentifier(colName), colType];
          if (c.pk) parts.push('PRIMARY KEY');
          if (c.notnull && !c.pk) parts.push('NOT NULL');
          return parts.join(' ');
        });
        await db.execute(
          `CREATE TABLE ${escapeIdentifier(name)} (${colDefs.join(', ')});`,
        );
        return jsonResponse({ ok: true, name }, 201);
      }

      const tableTargetMatch = pathname.match(/^\/api\/tables\/([^/]+)$/);
      if (tableTargetMatch && request.method === 'PATCH') {
        if (readOnly) {
          return errorResponse('Dashboard is running in read-only mode.', 403);
        }
        const tableName = decodeURIComponent(tableTargetMatch[1]);
        if (isInternalTable(tableName)) {
          return errorResponse('Cannot modify internal system tables.', 403);
        }
        const body = (await request.json().catch(() => null)) as {
          newName?: string;
          addColumn?: {
            name?: string;
            type?: string;
            notnull?: boolean;
            defaultValue?: string;
          };
          dropColumn?: string;
        } | null;

        if (body?.newName) {
          const nextName = String(body.newName).trim();
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nextName) || isInternalTable(nextName)) {
            return errorResponse('Invalid target table name.', 400);
          }
          await db.execute(
            `ALTER TABLE ${escapeIdentifier(tableName)} RENAME TO ${escapeIdentifier(nextName)};`,
          );
          return jsonResponse({ ok: true, name: nextName });
        }

        if (body?.addColumn) {
          const colName = String(body.addColumn.name ?? '').trim();
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(colName)) {
            return errorResponse('Invalid column name.', 400);
          }
          const allowedTypes = new Set(['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC']);
          const colType = allowedTypes.has(String(body.addColumn.type ?? 'TEXT').toUpperCase())
            ? String(body.addColumn.type ?? 'TEXT').toUpperCase()
            : 'TEXT';
          const parts = [escapeIdentifier(colName), colType];
          const dflt = body.addColumn.defaultValue;
          if (dflt !== undefined && dflt !== '') {
            const escapedDflt = `'${String(dflt).replace(/'/g, "''")}'`;
            if (body.addColumn.notnull) parts.push('NOT NULL');
            parts.push(`DEFAULT ${escapedDflt}`);
          } else if (body.addColumn.notnull) {
            parts.push("NOT NULL DEFAULT ''");
          }
          await db.execute(
            `ALTER TABLE ${escapeIdentifier(tableName)} ADD COLUMN ${parts.join(' ')};`,
          );
          return jsonResponse({ ok: true });
        }

        if (body?.dropColumn) {
          const colName = String(body.dropColumn).trim();
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(colName)) {
            return errorResponse('Invalid column name.', 400);
          }
          await db.execute(
            `ALTER TABLE ${escapeIdentifier(tableName)} DROP COLUMN ${escapeIdentifier(colName)};`,
          );
          return jsonResponse({ ok: true });
        }

        return errorResponse('Provide newName, addColumn, or dropColumn.', 400);
      }

      if (tableTargetMatch && request.method === 'DELETE') {
        if (readOnly) {
          return errorResponse('Dashboard is running in read-only mode.', 403);
        }
        const tableName = decodeURIComponent(tableTargetMatch[1]);
        if (isInternalTable(tableName)) {
          return errorResponse('Cannot drop internal system tables.', 403);
        }
        await db.execute(`DROP TABLE IF EXISTS ${escapeIdentifier(tableName)};`);
        return jsonResponse({ ok: true });
      }

      const clearTableMatch = pathname.match(/^\/api\/tables\/([^/]+)\/clear$/);
      if (clearTableMatch && request.method === 'POST') {
        if (readOnly) {
          return errorResponse('Dashboard is running in read-only mode.', 403);
        }
        const tableName = decodeURIComponent(clearTableMatch[1]);
        if (isInternalTable(tableName)) {
          return errorResponse('Cannot clear internal system tables from here.', 403);
        }
        await db.execute(`DELETE FROM ${escapeIdentifier(tableName)};`);
        return jsonResponse({ ok: true });
      }

      const importTableMatch = pathname.match(/^\/api\/tables\/([^/]+)\/import$/);
      if (importTableMatch && request.method === 'POST') {
        if (readOnly) {
          return errorResponse('Dashboard is running in read-only mode.', 403);
        }
        const tableName = decodeURIComponent(importTableMatch[1]);
        const tables = await listTables(db);
        const tableMeta = tables.find((t) => t.name === tableName);
        if (!tableMeta) {
          return errorResponse(`Table "${tableName}" not found.`, 404);
        }
        const body = (await request.json().catch(() => null)) as {
          rows?: Record<string, any>[];
        } | null;
        const rows = Array.isArray(body?.rows) ? body.rows : [];
        if (rows.length === 0) {
          return errorResponse('rows array is required.', 400);
        }
        const validCols = new Set(tableMeta.columns.map((c) => c.name));
        let imported = 0;
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue;
          const entries = Object.entries(row).filter(([k]) => validCols.has(k));
          if (entries.length === 0) continue;
          const cols = entries.map(([k]) => escapeIdentifier(k)).join(', ');
          const placeholders = entries.map(() => '?').join(', ');
          await db.execute(
            `INSERT OR REPLACE INTO ${escapeIdentifier(tableName)} (${cols}) VALUES (${placeholders});`,
            entries.map(([, v]) => v),
          );
          imported += 1;
        }
        return jsonResponse({ ok: true, imported });
      }

      const indexCreateMatch = pathname.match(/^\/api\/tables\/([^/]+)\/indexes$/);
      if (indexCreateMatch && request.method === 'POST') {
        if (readOnly) {
          return errorResponse('Dashboard is running in read-only mode.', 403);
        }
        const tableName = decodeURIComponent(indexCreateMatch[1]);
        const body = (await request.json().catch(() => null)) as {
          name?: string;
          columns?: string[];
          unique?: boolean;
        } | null;
        const idxName = String(body?.name ?? '').trim();
        const cols = Array.isArray(body?.columns) ? body.columns.filter(Boolean) : [];
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(idxName) || cols.length === 0) {
          return errorResponse('Valid index name and at least one column are required.', 400);
        }
        const uniqueSql = body?.unique ? 'UNIQUE ' : '';
        const colSql = cols.map((c) => escapeIdentifier(c)).join(', ');
        await db.execute(
          `CREATE ${uniqueSql}INDEX IF NOT EXISTS ${escapeIdentifier(idxName)} ON ${escapeIdentifier(tableName)} (${colSql});`,
        );
        return jsonResponse({ ok: true }, 201);
      }

      const indexDropMatch = pathname.match(/^\/api\/tables\/([^/]+)\/indexes\/([^/]+)$/);
      if (indexDropMatch && request.method === 'DELETE') {
        if (readOnly) {
          return errorResponse('Dashboard is running in read-only mode.', 403);
        }
        const idxName = decodeURIComponent(indexDropMatch[2]);
        await db.execute(`DROP INDEX IF EXISTS ${escapeIdentifier(idxName)};`);
        return jsonResponse({ ok: true });
      }

      const exportMatch = pathname.match(/^\/api\/tables\/([^/]+)\/export$/);
      if (exportMatch && request.method === 'GET') {
        const tableName = decodeURIComponent(exportMatch[1]);
        const tables = await listTables(db);
        const tableMeta = tables.find((t) => t.name === tableName);
        if (!tableMeta) {
          return errorResponse(`Table "${tableName}" not found.`, 404);
        }
        const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
        const rows =
          (await db.execute(
            `SELECT * FROM ${escapeIdentifier(tableName)} LIMIT 10000;`,
          )) ?? [];

        if (format === 'csv') {
          const cols = tableMeta.columns.map((c) => c.name);
          return new Response(toCsv(cols, rows), {
            status: 200,
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="${tableName}.csv"`,
            },
          });
        }
        return new Response(JSON.stringify(rows, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="${tableName}.json"`,
          },
        });
      }

      const tableRowsMatch = pathname.match(/^\/api\/tables\/([^/]+)\/rows$/);
      if (tableRowsMatch) {
        const tableName = decodeURIComponent(tableRowsMatch[1]);
        const tables = await listTables(db);
        const tableMeta = tables.find((t) => t.name === tableName);
        if (!tableMeta) {
          return errorResponse(`Table "${tableName}" not found.`, 404);
        }

        const quotedTable = escapeIdentifier(tableName);

        if (request.method === 'GET') {
          const limit = Math.min(
            500,
            Math.max(1, Number(url.searchParams.get('limit') ?? 50)),
          );
          const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
          const search = (url.searchParams.get('search') ?? '').trim();
          const filterCol = (url.searchParams.get('filterCol') ?? '').trim();
          const filterVal = url.searchParams.get('filterVal') ?? '';
          const orderBy = url.searchParams.get('orderBy') ?? '';
          const orderDir =
            url.searchParams.get('orderDir')?.toUpperCase() === 'DESC'
              ? 'DESC'
              : 'ASC';

          const validColNames = new Set(tableMeta.columns.map((c) => c.name));
          const params: any[] = [];
          const conditions: string[] = [];

          if (search && tableMeta.columns.length > 0) {
            const likeTerm = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
            const predicates = tableMeta.columns.map((col) => {
              params.push(likeTerm);
              return `CAST(${escapeIdentifier(col.name)} AS TEXT) LIKE ? ESCAPE '\\'`;
            });
            conditions.push(`(${predicates.join(' OR ')})`);
          }

          if (filterCol && validColNames.has(filterCol) && filterVal !== '') {
            params.push(filterVal);
            conditions.push(
              `CAST(${escapeIdentifier(filterCol)} AS TEXT) = ?`,
            );
          }

          const whereClause =
            conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

          let orderClause = '';
          if (orderBy && validColNames.has(orderBy)) {
            orderClause = ` ORDER BY ${escapeIdentifier(orderBy)} ${orderDir}`;
          }

          const countRows = await db.execute(
            `SELECT COUNT(*) AS cnt FROM ${quotedTable}${whereClause};`,
            params,
          );
          const total = Number(countRows?.[0]?.cnt ?? 0);

          const rows = await db.execute(
            `SELECT * FROM ${quotedTable}${whereClause}${orderClause} LIMIT ? OFFSET ?;`,
            [...params, limit, offset],
          );

          return jsonResponse({
            table: tableMeta,
            rows: rows ?? [],
            total,
            limit,
            offset,
          });
        }

        if (readOnly) {
          return errorResponse('Dashboard is running in read-only mode.', 403);
        }

        const body = (await request.json().catch(() => null)) as Record<
          string,
          any
        > | null;
        if (!body || typeof body !== 'object') {
          return errorResponse('JSON object body is required.', 400);
        }

        const validColNames = new Set(tableMeta.columns.map((c) => c.name));
        const pkColumns = tableMeta.columns
          .filter((c) => c.pk > 0)
          .sort((a, b) => a.pk - b.pk);

        if (request.method === 'POST') {
          const entries = Object.entries(body).filter(([key]) =>
            validColNames.has(key),
          );
          if (entries.length === 0) {
            return errorResponse('At least one valid column is required.', 400);
          }
          const cols = entries.map(([k]) => escapeIdentifier(k)).join(', ');
          const placeholders = entries.map(() => '?').join(', ');
          const values = entries.map(([, v]) => v);
          await db.execute(
            `INSERT INTO ${quotedTable} (${cols}) VALUES (${placeholders});`,
            values,
          );
          return jsonResponse({ ok: true }, 201);
        }

        if (request.method === 'PATCH') {
          if (pkColumns.length === 0) {
            return errorResponse(
              `Table "${tableName}" has no primary key for row updates.`,
              400,
            );
          }
          const updates = body.updates as Record<string, any> | undefined;
          const key = body.key as Record<string, any> | undefined;
          if (!updates || !key) {
            return errorResponse('Both "key" and "updates" objects are required.', 400);
          }
          const setEntries = Object.entries(updates).filter(
            ([col]) => validColNames.has(col),
          );
          if (setEntries.length === 0) {
            return errorResponse('No valid update columns provided.', 400);
          }
          const setClause = setEntries
            .map(([col]) => `${escapeIdentifier(col)} = ?`)
            .join(', ');
          const whereClause = pkColumns
            .map((pk) => `${escapeIdentifier(pk.name)} = ?`)
            .join(' AND ');
          const params = [
            ...setEntries.map(([, val]) => val),
            ...pkColumns.map((pk) => key[pk.name]),
          ];
          await db.execute(
            `UPDATE ${quotedTable} SET ${setClause} WHERE ${whereClause};`,
            params,
          );
          return jsonResponse({ ok: true });
        }

        if (request.method === 'DELETE') {
          if (pkColumns.length === 0) {
            return errorResponse(
              `Table "${tableName}" has no primary key for row deletion.`,
              400,
            );
          }
          const key = (body.key ?? body) as Record<string, any>;
          const whereClause = pkColumns
            .map((pk) => `${escapeIdentifier(pk.name)} = ?`)
            .join(' AND ');
          const params = pkColumns.map((pk) => key[pk.name]);
          await db.execute(
            `DELETE FROM ${quotedTable} WHERE ${whereClause};`,
            params,
          );
          return jsonResponse({ ok: true });
        }
      }

      if (request.method === 'POST' && pathname === '/api/query') {
        const body = (await request.json().catch(() => null)) as {
          sql?: string;
          params?: any[];
        } | null;
        const sql = String(body?.sql ?? '').trim();
        if (!sql) {
          return errorResponse('SQL query is required.', 400);
        }
        if (readOnly && !isReadQuery(sql)) {
          return errorResponse(
            'Only read-only SELECT / WITH / EXPLAIN / PRAGMA queries are allowed in read-only mode.',
            403,
          );
        }
        const started = performance.now();
        const rows =
          (await db.execute(
            sql,
            Array.isArray(body?.params) ? body.params : [],
          )) ?? [];
        const durationMs = Math.round((performance.now() - started) * 100) / 100;
        const columns =
          rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null
            ? Object.keys(rows[0])
            : [];
        return jsonResponse({
          columns,
          rows,
          rowsAffected: 0,
          durationMs,
        });
      }

      if (request.method === 'GET' && pathname === '/api/system') {
        const [outbox, kvStore, scheduler, actions, users, sessions, migrations] =
          await Promise.all([
            readRowsIfTableExists(db, 'sync_outbox', 200),
            readRowsIfTableExists(db, DEFAULT_KV_STORE_TABLE, 200),
            readRowsIfTableExists(db, '_local_scheduler', 100),
            readRowsIfTableExists(db, '_local_actions', 100),
            readRowsIfTableExists(db, '_local_users', 100),
            readRowsIfTableExists(db, '_local_sessions', 100),
            readRowsIfTableExists(db, 'schema_migrations', 100),
          ]);
        return jsonResponse({
          outbox,
          kvStore,
          scheduler,
          actions,
          users,
          sessions,
          migrations,
        });
      }

      if (request.method === 'GET' && pathname === '/api/settings') {
        const [
          journalRows,
          syncRows,
          busyRows,
          cacheRows,
          fkRows,
          pageSizeRows,
          pageCountRows,
          freelistRows,
          kvRows,
          outboxRows,
          scheduledJobsRows,
          schedulerRows,
        ] = await Promise.all([
          db.execute('PRAGMA journal_mode;').catch(() => [] as any[]),
          db.execute('PRAGMA synchronous;').catch(() => [] as any[]),
          db.execute('PRAGMA busy_timeout;').catch(() => [] as any[]),
          db.execute('PRAGMA cache_size;').catch(() => [] as any[]),
          db.execute('PRAGMA foreign_keys;').catch(() => [] as any[]),
          db.execute('PRAGMA page_size;').catch(() => [] as any[]),
          db.execute('PRAGMA page_count;').catch(() => [] as any[]),
          db.execute('PRAGMA freelist_count;').catch(() => [] as any[]),
          readRowsIfTableExists(db, DEFAULT_KV_STORE_TABLE, 500),
          readRowsIfTableExists(db, 'sync_outbox', 1000),
          readRowsIfTableExists(db, '_local_scheduled_jobs', 100),
          readRowsIfTableExists(db, '_local_scheduler', 100),
        ]);

        const outboxList = outboxRows ?? [];
        return jsonResponse({
          dashboard: {
            title,
            readOnly,
            authEnabled: Boolean(options.authToken),
            basePath,
          },
          pragmas: {
            journalMode: String(journalRows?.[0]?.journal_mode ?? 'unknown'),
            synchronous: Number(syncRows?.[0]?.synchronous ?? 0),
            busyTimeout: Number(busyRows?.[0]?.timeout ?? busyRows?.[0]?.busy_timeout ?? 0),
            cacheSize: Number(cacheRows?.[0]?.cache_size ?? 0),
            foreignKeys: Boolean(Number(fkRows?.[0]?.foreign_keys ?? 0)),
            pageSize: Number(pageSizeRows?.[0]?.page_size ?? 0),
            pageCount: Number(pageCountRows?.[0]?.page_count ?? 0),
            freelistCount: Number(freelistRows?.[0]?.freelist_count ?? 0),
          },
          kvStore: {
            exists: kvRows !== null,
            entries: kvRows ?? [],
          },
          sync: {
            outboxExists: outboxRows !== null,
            outboxTotal: outboxList.length,
            outboxPending: outboxList.filter((r: any) => r.status === 'pending' || !r.status).length,
            outboxFailed: outboxList.filter((r: any) => r.status === 'failed').length,
            schedulerJobs: scheduledJobsRows ?? schedulerRows ?? null,
          },
        });
      }

      if (request.method === 'POST' && pathname === '/api/settings/pragma') {
        if (readOnly) {
          return errorResponse('Dashboard is running in read-only mode.', 403);
        }
        const body = (await request.json().catch(() => null)) as {
          pragma?: string;
          value?: string | number | boolean;
        } | null;
        const pragma = String(body?.pragma ?? '');
        const val = body?.value;

        if (pragma === 'journal_mode') {
          const allowed = new Set(['DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY', 'WAL', 'OFF']);
          const mode = String(val ?? '').toUpperCase();
          if (!allowed.has(mode)) {
            return errorResponse(`Unsupported journal_mode: ${mode}`, 400);
          }
          const rows = await db.execute(`PRAGMA journal_mode = ${mode};`);
          return jsonResponse({ ok: true, pragma, value: rows?.[0]?.journal_mode ?? mode });
        }

        if (pragma === 'synchronous') {
          const num = Number(val);
          if (!Number.isInteger(num) || num < 0 || num > 3) {
            return errorResponse('synchronous must be 0 (OFF), 1 (NORMAL), 2 (FULL), or 3 (EXTRA).', 400);
          }
          await db.execute(`PRAGMA synchronous = ${num};`);
          return jsonResponse({ ok: true, pragma, value: num });
        }

        if (pragma === 'busy_timeout') {
          const ms = Number(val);
          if (!Number.isInteger(ms) || ms < 0 || ms > 600000) {
            return errorResponse('busy_timeout must be an integer between 0 and 600000 ms.', 400);
          }
          await db.execute(`PRAGMA busy_timeout = ${ms};`);
          return jsonResponse({ ok: true, pragma, value: ms });
        }

        if (pragma === 'cache_size') {
          const size = Number(val);
          if (!Number.isInteger(size) || size < -1048576 || size > 1048576) {
            return errorResponse('cache_size must be an integer between -1048576 and 1048576.', 400);
          }
          await db.execute(`PRAGMA cache_size = ${size};`);
          return jsonResponse({ ok: true, pragma, value: size });
        }

        if (pragma === 'foreign_keys') {
          const enabled = val === true || val === 1 || val === '1' || String(val).toUpperCase() === 'ON';
          await db.execute(`PRAGMA foreign_keys = ${enabled ? 'ON' : 'OFF'};`);
          return jsonResponse({ ok: true, pragma, value: enabled });
        }

        return errorResponse(`Unsupported pragma "${pragma}".`, 400);
      }

      if (request.method === 'POST' && pathname === '/api/settings/maintenance') {
        const body = (await request.json().catch(() => null)) as { action?: string } | null;
        const action = String(body?.action ?? '');

        if (action === 'integrity_check') {
          const rows = await db.execute('PRAGMA integrity_check;');
          const result = (rows ?? []).map((r: any) => Object.values(r)[0]).join(', ') || 'ok';
          return jsonResponse({ ok: true, action, message: `Integrity check: ${result}` });
        }

        if (readOnly) {
          return errorResponse('Dashboard is running in read-only mode.', 403);
        }

        if (action === 'vacuum') {
          await db.execute('VACUUM;');
          return jsonResponse({ ok: true, action, message: 'VACUUM completed.' });
        }
        if (action === 'checkpoint') {
          const rows = await db.execute('PRAGMA wal_checkpoint(TRUNCATE);');
          return jsonResponse({ ok: true, action, message: 'WAL checkpoint completed.', detail: rows?.[0] ?? null });
        }
        if (action === 'prune_kv_expired') {
          const exists = await db.execute(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?;`,
            [DEFAULT_KV_STORE_TABLE],
          );
          if (exists?.length) {
            await KVStore.pruneExpired(db, DEFAULT_KV_STORE_TABLE);
          }
          return jsonResponse({ ok: true, action, message: 'Expired KV Store entries pruned.' });
        }
        if (action === 'prune_outbox') {
          const exists = await db.execute(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_outbox';`,
          );
          if (exists?.length) {
            await db.execute(`DELETE FROM sync_outbox WHERE status = 'synced';`);
          }
          return jsonResponse({ ok: true, action, message: 'Synced outbox entries pruned.' });
        }
        if (action === 'clear_failed_outbox') {
          const exists = await db.execute(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_outbox';`,
          );
          if (exists?.length) {
            await db.execute(`DELETE FROM sync_outbox WHERE status = 'failed';`);
          }
          return jsonResponse({ ok: true, action, message: 'Failed outbox mutations cleared.' });
        }

        return errorResponse(`Unsupported maintenance action "${action}".`, 400);
      }

      if (request.method === 'GET' && pathname === '/api/settings/export') {
        const includeInternal = url.searchParams.get('includeInternal') === '1';
        const tables = await listTables(db);
        const selected = includeInternal ? tables : tables.filter((t) => !t.internal);
        const data: Record<string, any[]> = {};
        for (const t of selected) {
          data[t.name] =
            (await db.execute(`SELECT * FROM ${escapeIdentifier(t.name)} LIMIT 50000;`)) ?? [];
        }
        return new Response(
          JSON.stringify({ exportedAt: new Date().toISOString(), tables: data }, null, 2),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Disposition': 'attachment; filename="local-lite-export.json"',
            },
          },
        );
      }

      if (pathname === '/api/kv-store') {
        if (readOnly) {
          return errorResponse('Dashboard is running in read-only mode.', 403);
        }
        const body = (await request.json().catch(() => null)) as {
          key?: string;
          value?: any;
          type?: string;
          ttlMs?: number | null;
        } | null;

        if (request.method === 'POST') {
          const key = String(body?.key ?? '').trim();
          if (!key) {
            return errorResponse('Key is required.', 400);
          }
          await KVStore.ensureSchema(db, DEFAULT_KV_STORE_TABLE);
          const type = ['string', 'number', 'boolean', 'json'].includes(String(body?.type))
            ? String(body?.type)
            : 'string';
          let valueStr: string;
          if (type === 'number') {
            const n = Number(body?.value);
            if (Number.isNaN(n)) return errorResponse('Invalid number value.', 400);
            valueStr = String(n);
          } else if (type === 'boolean') {
            const b = body?.value === true || body?.value === 'true' || body?.value === '1' || body?.value === 1;
            valueStr = b ? '1' : '0';
          } else if (type === 'json') {
            try {
              const parsed = typeof body?.value === 'string' ? JSON.parse(body.value) : body?.value;
              valueStr = JSON.stringify(parsed ?? null);
            } catch {
              return errorResponse('Invalid JSON value.', 400);
            }
          } else {
            valueStr = String(body?.value ?? '');
          }
          const now = Date.now();
          const expiresAt =
            body?.ttlMs != null && Number(body.ttlMs) > 0 ? now + Number(body.ttlMs) : null;
          await KVStore.set(db, DEFAULT_KV_STORE_TABLE, key, valueStr, type, now, expiresAt);
          return jsonResponse({ ok: true });
        }

        if (request.method === 'DELETE') {
          const key = String(body?.key ?? '').trim();
          if (!key) {
            return errorResponse('Key is required.', 400);
          }
          await KVStore.ensureSchema(db, DEFAULT_KV_STORE_TABLE);
          await KVStore.delete(db, DEFAULT_KV_STORE_TABLE, key);
          return jsonResponse({ ok: true });
        }
      }

      if (request.method === 'GET' && pathname === '/api/files') {
        const blobs = await readRowsIfTableExists(db, '_local_blobs', 500);
        return jsonResponse({ exists: blobs !== null, files: blobs ?? [] });
      }

      const fileDeleteMatch = pathname.match(/^\/api\/files\/([^/]+)$/);
      if (fileDeleteMatch && request.method === 'DELETE') {
        if (readOnly) {
          return errorResponse('Dashboard is running in read-only mode.', 403);
        }
        const fileId = decodeURIComponent(fileDeleteMatch[1]);
        const exists = await db.execute(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_local_blobs';`,
        );
        if (exists?.length) {
          await db.execute(`DELETE FROM _local_blobs WHERE id = ?;`, [fileId]);
        }
        return jsonResponse({ ok: true });
      }

      if (pathname === '/api/auth-admin') {
        if (request.method === 'GET') {
          const [users, sessions, apiKeys] = await Promise.all([
            readRowsIfTableExists(db, '_local_users', 500),
            readRowsIfTableExists(db, '_local_sessions', 500),
            readRowsIfTableExists(db, '_local_api_keys', 500),
          ]);
          return jsonResponse({ users, sessions, apiKeys });
        }

        if (request.method === 'POST') {
          if (readOnly) {
            return errorResponse('Dashboard is running in read-only mode.', 403);
          }
          const body = (await request.json().catch(() => null)) as {
            action?: string;
            id?: string;
          } | null;
          const action = String(body?.action ?? '');
          const id = String(body?.id ?? '');
          if (!id) return errorResponse('id is required.', 400);

          if (action === 'revoke_session') {
            await db.execute(`DELETE FROM _local_sessions WHERE id = ?;`, [id]);
            return jsonResponse({ ok: true });
          }
          if (action === 'unlock_user') {
            await db.execute(
              `UPDATE _local_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?;`,
              [id],
            );
            return jsonResponse({ ok: true });
          }
          if (action === 'revoke_api_key') {
            await db.execute(
              `UPDATE _local_api_keys SET revoked_at = ? WHERE id = ?;`,
              [Date.now(), id],
            ).catch(async () => {
              await db.execute(`DELETE FROM _local_api_keys WHERE id = ?;`, [id]);
            });
            return jsonResponse({ ok: true });
          }
          return errorResponse(`Unsupported auth action "${action}".`, 400);
        }
      }

      if (pathname === '/api/jobs') {
        if (request.method === 'GET') {
          const [actions, scheduledJobs, jobRuns, outbox] = await Promise.all([
            readRowsIfTableExists(db, '_local_actions', 500),
            readRowsIfTableExists(db, '_local_scheduled_jobs', 200),
            readRowsIfTableExists(db, '_local_job_runs', 200),
            readRowsIfTableExists(db, 'sync_outbox', 500),
          ]);
          return jsonResponse({ actions, scheduledJobs, jobRuns, outbox });
        }

        if (request.method === 'POST') {
          if (readOnly) {
            return errorResponse('Dashboard is running in read-only mode.', 403);
          }
          const body = (await request.json().catch(() => null)) as {
            action?: string;
            id?: string;
            enabled?: boolean;
          } | null;
          const action = String(body?.action ?? '');
          const id = String(body?.id ?? '');

          if (action === 'retry_action' && id) {
            await db.execute(
              `UPDATE _local_actions SET status = 'pending', attempts = 0, last_error = NULL WHERE id = ?;`,
              [id],
            );
            return jsonResponse({ ok: true });
          }
          if (action === 'delete_action' && id) {
            await db.execute(`DELETE FROM _local_actions WHERE id = ?;`, [id]);
            return jsonResponse({ ok: true });
          }
          if (action === 'clear_completed_actions') {
            const exists = await db.execute(
              `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_local_actions';`,
            );
            if (exists?.length) {
              await db.execute(`DELETE FROM _local_actions WHERE status = 'completed';`);
            }
            return jsonResponse({ ok: true });
          }
          if (action === 'retry_outbox' && id) {
            await db.execute(
              `UPDATE sync_outbox SET status = 'pending', retry_count = 0, last_error = NULL WHERE id = ?;`,
              [id],
            );
            return jsonResponse({ ok: true });
          }
          if (action === 'toggle_job' && id) {
            await db.execute(
              `UPDATE _local_scheduled_jobs SET enabled = ? WHERE id = ?;`,
              [body?.enabled ? 1 : 0, id],
            );
            return jsonResponse({ ok: true });
          }
          if (action === 'delete_job' && id) {
            await db.execute(`DELETE FROM _local_scheduled_jobs WHERE id = ?;`, [id]);
            return jsonResponse({ ok: true });
          }
          return errorResponse(`Unsupported job action "${action}".`, 400);
        }
      }

      return errorResponse('Not found.', 404);
    } catch (err: any) {
      return errorResponse(err?.message ?? 'Internal server error.', 500);
    }
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function tryServeDashboardAsset(
  pathname: string,
  title: string,
): Promise<Response | null> {
  try {
    const [{ readFile }, path] = await Promise.all([
      import('node:fs/promises'),
      import('node:path'),
    ]);
    const here = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
    const distDir = path.resolve(here, '..', '..', 'dashboard', 'dist');
    const rel = pathname === '/' || pathname === '/index.html'
      ? 'index.html'
      : pathname.replace(/^\/+/, '');
    const target = path.resolve(distDir, rel);
    if (!target.startsWith(distDir + path.sep) && target !== path.join(distDir, 'index.html')) {
      return null;
    }
    const content = await readFile(target);
    if (rel === 'index.html') {
      const html = content
        .toString('utf8')
        .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }
    const ext = path.extname(target).toLowerCase();
    const mime =
      ext === '.js'
        ? 'application/javascript; charset=utf-8'
        : ext === '.css'
          ? 'text/css; charset=utf-8'
          : ext === '.svg'
            ? 'image/svg+xml'
            : 'application/octet-stream';
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': mime },
    });
  } catch {
    return null;
  }
}
