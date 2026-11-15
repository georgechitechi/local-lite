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
        (pathname === '/' || pathname === '/index.html')
      ) {
        return new Response(renderDashboardHtml(title, readOnly, basePath), {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
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

      const dropTableMatch = pathname.match(/^\/api\/tables\/([^/]+)$/);
      if (dropTableMatch && request.method === 'DELETE') {
        if (readOnly) {
          return errorResponse('Dashboard is running in read-only mode.', 403);
        }
        const tableName = decodeURIComponent(dropTableMatch[1]);
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

function renderDashboardHtml(
  title: string,
  readOnly: boolean,
  basePath: string,
): string {
  const safeTitle = escapeHtml(title);
  const safeBase = JSON.stringify(basePath);
  const safeReadOnly = JSON.stringify(readOnly);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root {
      --bg: #0b0d12;
      --panel: #121620;
      --panel-2: #171c28;
      --panel-3: #1e2536;
      --border: #232a3b;
      --text: #e6ebf5;
      --muted: #8b95a8;
      --accent: #f37021;
      --accent-soft: rgba(243, 112, 33, 0.14);
      --green: #22c55e;
      --red: #ef4444;
      --blue: #60a5fa;
      --amber: #fbbf24;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    [data-theme="light"] {
      --bg: #f6f8fa;
      --panel: #ffffff;
      --panel-2: #f0f3f6;
      --panel-3: #e6ebf1;
      --border: #d0d7de;
      --text: #1f2328;
      --muted: #656d76;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 13px; }
    .app { display: flex; flex-direction: column; height: 100vh; }
    .topbar {
      height: 48px; display: flex; align-items: center; justify-content: space-between;
      padding: 0 16px; border-bottom: 1px solid var(--border); background: var(--panel);
    }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 14px; }
    .dot { width: 9px; height: 9px; border-radius: 99px; background: var(--accent); box-shadow: 0 0 10px var(--accent); }
    .badge {
      font-size: 11px; padding: 2px 8px; border-radius: 99px; border: 1px solid var(--border);
      color: var(--muted); background: var(--panel-2); white-space: nowrap;
    }
    .badge.ro { color: var(--amber); border-color: rgba(251, 191, 36, 0.35); }
    .badge.ok { color: var(--green); border-color: rgba(34, 197, 94, 0.35); }
    .badge.pk { color: var(--accent); border-color: rgba(243, 112, 33, 0.35); background: var(--accent-soft); }
    .top-actions { display: flex; align-items: center; gap: 8px; }
    .workspace { display: flex; flex: 1; min-height: 0; }
    .nav {
      width: 260px; border-right: 1px solid var(--border); background: var(--panel);
      display: flex; flex-direction: column; min-height: 0;
    }
    .nav-tabs { padding: 10px 8px; display: flex; flex-direction: column; gap: 2px; border-bottom: 1px solid var(--border); }
    .nav-btn {
      display: flex; align-items: center; justify-content: space-between;
      width: 100%; padding: 7px 10px; border: 0; border-radius: 6px;
      background: transparent; color: var(--muted); cursor: pointer; text-align: left; font-size: 13px;
    }
    .nav-btn:hover { background: var(--panel-2); color: var(--text); }
    .nav-btn.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
    .tables-header { padding: 10px 12px 6px; display: flex; align-items: center; justify-content: space-between; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    .table-filter-wrap { padding: 0 8px 8px; }
    .tables-list { flex: 1; overflow-y: auto; padding: 0 8px 12px; }
    .table-item {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 6px 10px; border-radius: 6px; cursor: pointer; color: var(--text); font-family: var(--mono); font-size: 12px;
    }
    .table-item:hover { background: var(--panel-2); }
    .table-item.active { background: var(--accent-soft); color: var(--accent); }
    .table-item .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .table-item .cnt { color: var(--muted); font-size: 11px; flex-shrink: 0; }
    .main { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
    .toolbar {
      padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--panel-2);
      display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
    }
    .input, select.input {
      background: var(--bg); color: var(--text); border: 1px solid var(--border);
      border-radius: 6px; padding: 6px 10px; font-size: 12px; outline: none;
    }
    .input:focus { border-color: var(--accent); }
    .btn {
      background: var(--panel); color: var(--text); border: 1px solid var(--border);
      border-radius: 6px; padding: 6px 11px; font-size: 12px; cursor: pointer;
    }
    .btn:hover { border-color: var(--muted); background: var(--panel-3); }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
    .btn.primary:hover { filter: brightness(1.08); }
    .btn.danger { color: var(--red); border-color: rgba(239, 68, 68, 0.35); }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .content { flex: 1; overflow: auto; padding: 16px; }
    .grid-wrap { border: 1px solid var(--border); border-radius: 8px; overflow: auto; background: var(--panel); }
    table { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 12px; }
    th, td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    th { background: var(--panel-2); color: var(--muted); font-weight: 600; position: sticky; top: 0; cursor: pointer; user-select: none; }
    th:hover { color: var(--text); }
    tr:hover td { background: rgba(255,255,255,0.025); }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .schema-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
    .card .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
    .card .value { font-size: 20px; font-weight: 700; font-family: var(--mono); }
    .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-family: var(--mono); font-size: 12px; }
    .bar-track { flex: 1; height: 8px; background: var(--bg); border-radius: 99px; overflow: hidden; border: 1px solid var(--border); }
    .bar-fill { height: 100%; background: var(--accent); border-radius: 99px; }
    textarea.sql {
      width: 100%; min-height: 130px; background: var(--panel); color: var(--text);
      border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-family: var(--mono); font-size: 12px; resize: vertical;
    }
    .snippets { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 12px; }
    .error-banner {
      margin-bottom: 12px; padding: 10px 12px; border-radius: 6px;
      background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); color: #fca5a5;
    }
    .success-banner {
      margin-bottom: 12px; padding: 10px 12px; border-radius: 6px;
      background: rgba(34, 197, 94, 0.12); border: 1px solid rgba(34, 197, 94, 0.35); color: var(--green);
    }
    .settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 14px; }
    .setting-row {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 8px 0; border-bottom: 1px solid var(--border);
    }
    .setting-row:last-child { border-bottom: 0; }
    .setting-label { display: flex; flex-direction: column; gap: 2px; }
    .setting-label strong { font-size: 12px; }
    .setting-label span { font-size: 11px; color: var(--muted); }
    .empty { padding: 40px; text-align: center; color: var(--muted); }
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.68); display: none; align-items: center; justify-content: center; z-index: 50;
    }
    .modal-backdrop.open { display: flex; }
    .modal {
      width: min(680px, 94vw); max-height: 86vh; overflow: auto;
      background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px;
    }
    .field-row { margin-bottom: 10px; }
    .field-row label { display: block; color: var(--muted); font-size: 11px; font-family: var(--mono); margin-bottom: 4px; }
    .field-row input { width: 100%; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--mono); font-size: 12px; background: var(--bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border); }
  </style>
</head>
<body>
  <div class="app">
    <div class="topbar">
      <div class="brand">
        <span class="dot"></span>
        <span>${safeTitle}</span>
        <span id="modeBadge" class="badge"></span>
        <span id="dbBadge" class="badge">SQLite</span>
      </div>
      <div class="top-actions">
        <select id="pollSelect" class="input" title="Auto-refresh interval">
          <option value="0">Live: Off</option>
          <option value="2000">Live: 2s</option>
          <option value="5000">Live: 5s</option>
          <option value="10000">Live: 10s</option>
        </select>
        <button id="refreshBtn" class="btn">Refresh</button>
      </div>
    </div>
    <div class="workspace">
      <aside class="nav">
        <div class="nav-tabs">
          <button class="nav-btn active" data-view="data"><span>Data</span></button>
          <button class="nav-btn" data-view="schema"><span>Schema &amp; Indexes</span></button>
          <button class="nav-btn" data-view="sql"><span>SQL Console</span></button>
          <button class="nav-btn" data-view="sync"><span>Sync &amp; System</span></button>
          <button class="nav-btn" data-view="overview"><span>Overview</span></button>
          <button class="nav-btn" data-view="settings"><span>Settings</span></button>
        </div>
        <div class="tables-header">
          <span>Tables</span>
          <label style="display:flex;align-items:center;gap:4px;text-transform:none;cursor:pointer;">
            <input type="checkbox" id="showSystemToggle" /> sys
          </label>
        </div>
        <div class="table-filter-wrap">
          <input id="tableFilterInput" class="input" style="width:100%;" placeholder="Filter tables..." />
        </div>
        <div id="tablesList" class="tables-list"></div>
      </aside>
      <main class="main">
        <div id="toolbar" class="toolbar"></div>
        <div id="content" class="content"></div>
      </main>
    </div>
  </div>

  <div id="modalBackdrop" class="modal-backdrop">
    <div class="modal">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <strong id="modalTitle">Inspect</strong>
        <button id="modalClose" class="btn">Close</button>
      </div>
      <div id="modalBody"></div>
    </div>
  </div>

  <script>
    const BASE = ${safeBase};
    const READ_ONLY = ${safeReadOnly};
    const token = new URLSearchParams(location.search).get('token');

    let pollTimer = null;
    const state = {
      view: 'data',
      tables: [],
      tableFilter: '',
      selectedTable: null,
      showSystem: false,
      rows: [],
      total: 0,
      limit: Number(localStorage.getItem('local_lite_limit') || 50),
      offset: 0,
      search: '',
      filterCol: '',
      filterVal: '',
      orderBy: '',
      orderDir: 'ASC',
      overview: null,
      system: null,
      settings: null,
      settingsMsg: null,
      theme: localStorage.getItem('local_lite_theme') || 'dark',
      sqlText: 'SELECT name, type FROM sqlite_master ORDER BY name;',
      sqlResult: null,
      sqlHistory: JSON.parse(localStorage.getItem('local_lite_sql_history') || '[]'),
      error: null,
    };

    document.documentElement.setAttribute('data-theme', state.theme);

    const modeBadge = document.getElementById('modeBadge');
    modeBadge.textContent = READ_ONLY ? 'Read-Only' : 'Read / Write';
    modeBadge.className = 'badge ' + (READ_ONLY ? 'ro' : 'ok');

    function authUrl(path) {
      return BASE + path + (token ? (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token) : '');
    }

    async function api(path, opts = {}) {
      const res = await fetch(authUrl(path), {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    }

    function esc(v) {
      return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatVal(v) {
      if (v === null || v === undefined) return '<span style="color:var(--muted)">NULL</span>';
      if (typeof v === 'object') return esc(JSON.stringify(v));
      return esc(String(v));
    }

    function openModal(title, html) {
      document.getElementById('modalTitle').textContent = title;
      document.getElementById('modalBody').innerHTML = html;
      document.getElementById('modalBackdrop').classList.add('open');
    }
    function closeModal() {
      document.getElementById('modalBackdrop').classList.remove('open');
    }
    document.getElementById('modalClose').onclick = closeModal;
    document.getElementById('modalBackdrop').onclick = (e) => {
      if (e.target.id === 'modalBackdrop') closeModal();
    };

    async function loadTables() {
      const data = await api('/api/tables');
      state.tables = data.tables || [];
      if (!state.selectedTable && state.tables.length > 0) {
        const firstUser = state.tables.find(t => !t.internal) || state.tables[0];
        state.selectedTable = firstUser.name;
      }
      renderTablesList();
    }

    function renderTablesList() {
      const list = document.getElementById('tablesList');
      const q = state.tableFilter.trim().toLowerCase();
      const visible = state.tables.filter(t => (state.showSystem || !t.internal) && (!q || t.name.toLowerCase().includes(q)));
      if (visible.length === 0) {
        list.innerHTML = '<div style="padding:10px;color:var(--muted);">No matching tables</div>';
        return;
      }
      list.innerHTML = visible.map(t => \`
        <div class="table-item \${state.selectedTable === t.name ? 'active' : ''}" data-table="\${esc(t.name)}">
          <span class="name">\${esc(t.name)}</span>
          <span class="cnt">\${t.rowCount}</span>
        </div>
      \`).join('');
      list.querySelectorAll('.table-item').forEach(el => {
        el.onclick = () => {
          state.selectedTable = el.dataset.table;
          state.offset = 0;
          state.orderBy = '';
          state.filterCol = '';
          state.filterVal = '';
          if (state.view !== 'data' && state.view !== 'schema') {
            state.view = 'data';
            updateNavButtons();
          }
          renderTablesList();
          refreshActiveView();
        };
      });
    }

    function updateNavButtons() {
      document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === state.view);
      });
    }

    async function loadTableRows() {
      if (!state.selectedTable) {
        state.rows = [];
        state.total = 0;
        return;
      }
      const q = new URLSearchParams({
        limit: String(state.limit),
        offset: String(state.offset),
        search: state.search,
        filterCol: state.filterCol,
        filterVal: state.filterVal,
        orderBy: state.orderBy,
        orderDir: state.orderDir,
      });
      const data = await api('/api/tables/' + encodeURIComponent(state.selectedTable) + '/rows?' + q.toString());
      state.rows = data.rows || [];
      state.total = data.total || 0;
    }

    async function refreshActiveView() {
      state.error = null;
      try {
        if (state.view === 'data') {
          await loadTables();
          await loadTableRows();
        } else if (state.view === 'schema') {
          await loadTables();
        } else if (state.view === 'overview') {
          state.overview = await api('/api/overview');
          document.getElementById('dbBadge').textContent = 'SQLite ' + state.overview.sqliteVersion;
        } else if (state.view === 'sync') {
          state.system = await api('/api/system');
        } else if (state.view === 'settings') {
          state.settings = await api('/api/settings');
        }
      } catch (err) {
        state.error = err.message;
      }
      renderMain();
    }

    function openRowEditor(meta, existingRow) {
      const isEdit = Boolean(existingRow);
      const pkCols = meta.columns.filter(c => c.pk > 0).map(c => c.name);
      const fieldsHtml = meta.columns.map(c => {
        const val = isEdit ? (existingRow[c.name] ?? '') : '';
        const disabled = isEdit && pkCols.includes(c.name) ? 'disabled' : '';
        return \`
          <div class="field-row">
            <label>\${esc(c.name)} <span style="color:var(--muted);">(\${esc(c.type || 'ANY')}\${c.pk ? ', PK' : ''}\${c.notnull ? ', NOT NULL' : ''})</span></label>
            <input class="input" data-field="\${esc(c.name)}" value="\${esc(typeof val === 'object' ? JSON.stringify(val) : val)}" \${disabled} />
          </div>
        \`;
      }).join('');
      openModal((isEdit ? 'Edit row in ' : 'Insert into ') + meta.name, \`
        <div>\${fieldsHtml}</div>
        <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">
          <button id="submitRowForm" class="btn primary">\${isEdit ? 'Save Changes' : 'Insert Row'}</button>
        </div>
      \`);
      document.getElementById('submitRowForm').onclick = async () => {
        try {
          const payload = {};
          document.querySelectorAll('[data-field]').forEach(inp => {
            if (!inp.disabled) {
              const v = inp.value;
              if (v !== '' || isEdit) payload[inp.dataset.field] = v === '' ? null : v;
            }
          });
          if (isEdit) {
            const key = {};
            pkCols.forEach(pk => { key[pk] = existingRow[pk]; });
            await api('/api/tables/' + encodeURIComponent(meta.name) + '/rows', {
              method: 'PATCH',
              body: JSON.stringify({ key, updates: payload }),
            });
          } else {
            await api('/api/tables/' + encodeURIComponent(meta.name) + '/rows', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
          }
          closeModal();
          refreshActiveView();
        } catch (err) { alert(err.message); }
      };
    }

    function renderMain() {
      const toolbar = document.getElementById('toolbar');
      const content = document.getElementById('content');
      const errHtml = state.error ? \`<div class="error-banner">\${esc(state.error)}</div>\` : '';

      if (state.view === 'data') {
        const meta = state.tables.find(t => t.name === state.selectedTable);
        const colOptions = meta ? meta.columns.map(c => \`<option value="\${esc(c.name)}" \${state.filterCol === c.name ? 'selected' : ''}>\${esc(c.name)}</option>\`).join('') : '';
        toolbar.innerHTML = \`
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong style="font-family:var(--mono);">\${esc(state.selectedTable || 'No table')}</strong>
            <span class="badge">\${state.total} rows</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <select id="filterColSelect" class="input"><option value="">Filter col...</option>\${colOptions}</select>
            <input id="filterValInput" class="input" style="width:120px;" placeholder="Exact value" value="\${esc(state.filterVal)}" />
            <input id="searchInput" class="input" placeholder="Search all cols..." value="\${esc(state.search)}" />
            \${meta ? \`
              <a class="btn" style="text-decoration:none;" href="\${authUrl('/api/tables/' + encodeURIComponent(meta.name) + '/export?format=csv')}">CSV</a>
              <a class="btn" style="text-decoration:none;" href="\${authUrl('/api/tables/' + encodeURIComponent(meta.name) + '/export?format=json')}">JSON</a>
            \` : ''}
            \${READ_ONLY || !meta ? '' : '<button id="addRowBtn" class="btn primary">+ Add Row</button>'}
          </div>
        \`;

        const applyFilter = () => {
          state.filterCol = document.getElementById('filterColSelect').value;
          state.filterVal = document.getElementById('filterValInput').value;
          state.search = document.getElementById('searchInput').value;
          state.offset = 0;
          refreshActiveView();
        };
        document.getElementById('searchInput').onkeydown = (e) => { if (e.key === 'Enter') applyFilter(); };
        document.getElementById('filterValInput').onkeydown = (e) => { if (e.key === 'Enter') applyFilter(); };
        document.getElementById('filterColSelect').onchange = () => {
          if (document.getElementById('filterValInput').value) applyFilter();
        };

        const addBtn = document.getElementById('addRowBtn');
        if (addBtn && meta) addBtn.onclick = () => openRowEditor(meta, null);

        if (!meta) {
          content.innerHTML = errHtml + '<div class="empty">Select a table from the sidebar.</div>';
          return;
        }

        const cols = meta.columns.map(c => c.name);
        const pkCols = meta.columns.filter(c => c.pk > 0).map(c => c.name);
        content.innerHTML = errHtml + \`
          <div class="grid-wrap">
            <table>
              <thead>
                <tr>
                  \${cols.map(c => \`<th data-col="\${esc(c)}">\${esc(c)}\${pkCols.includes(c) ? ' 🔑' : ''}\${state.orderBy === c ? (state.orderDir === 'ASC' ? ' ▲' : ' ▼') : ''}</th>\`).join('')}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                \${state.rows.length === 0 ? \`<tr><td colspan="\${cols.length + 1}" class="empty">No rows</td></tr>\` : state.rows.map((r, idx) => \`
                  <tr>
                    \${cols.map(c => \`<td>\${formatVal(r[c])}</td>\`).join('')}
                    <td>
                      <button class="btn view-row" data-idx="\${idx}">JSON</button>
                      \${!READ_ONLY && pkCols.length > 0 ? \`<button class="btn edit-row" data-idx="\${idx}">Edit</button><button class="btn danger del-row" data-idx="\${idx}">Del</button>\` : ''}
                    </td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          </div>
          <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <span style="color:var(--muted);">Showing \${state.rows.length} of \${state.total}</span>
            <div style="display:flex;gap:6px;align-items:center;">
              <select id="limitSelect" class="input">
                \${[25, 50, 100, 250].map(n => \`<option value="\${n}" \${state.limit === n ? 'selected' : ''}>\${n} / page</option>\`).join('')}
              </select>
              <button id="prevPage" class="btn" \${state.offset <= 0 ? 'disabled' : ''}>Prev</button>
              <button id="nextPage" class="btn" \${state.offset + state.limit >= state.total ? 'disabled' : ''}>Next</button>
            </div>
          </div>
        \`;

        content.querySelectorAll('th[data-col]').forEach(th => {
          th.onclick = () => {
            const col = th.dataset.col;
            if (state.orderBy === col) state.orderDir = state.orderDir === 'ASC' ? 'DESC' : 'ASC';
            else { state.orderBy = col; state.orderDir = 'ASC'; }
            refreshActiveView();
          };
        });
        content.querySelectorAll('.view-row').forEach(btn => {
          btn.onclick = () => {
            const row = state.rows[Number(btn.dataset.idx)];
            openModal(meta.name + ' Row', '<pre>' + esc(JSON.stringify(row, null, 2)) + '</pre>');
          };
        });
        content.querySelectorAll('.edit-row').forEach(btn => {
          btn.onclick = () => openRowEditor(meta, state.rows[Number(btn.dataset.idx)]);
        });
        content.querySelectorAll('.del-row').forEach(btn => {
          btn.onclick = async () => {
            if (!confirm('Delete this row?')) return;
            const row = state.rows[Number(btn.dataset.idx)];
            const key = {};
            pkCols.forEach(pk => { key[pk] = row[pk]; });
            try {
              await api('/api/tables/' + encodeURIComponent(meta.name) + '/rows', {
                method: 'DELETE',
                body: JSON.stringify({ key }),
              });
              refreshActiveView();
            } catch (err) { alert(err.message); }
          };
        });
        document.getElementById('limitSelect').onchange = (e) => {
          state.limit = Number(e.target.value);
          state.offset = 0;
          refreshActiveView();
        };
        document.getElementById('prevPage').onclick = () => { state.offset = Math.max(0, state.offset - state.limit); refreshActiveView(); };
        document.getElementById('nextPage').onclick = () => { state.offset += state.limit; refreshActiveView(); };
      } else if (state.view === 'schema') {
        toolbar.innerHTML = '<strong>Schema &amp; Indexes</strong><span class="badge">' + state.tables.length + ' tables</span>';
        const visible = state.tables.filter(t => state.showSystem || !t.internal);
        content.innerHTML = errHtml + (visible.length === 0 ? '<div class="empty">No tables found</div>' : \`
          <div class="schema-grid">
            \${visible.map(t => \`
              <div class="card">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                  <strong style="font-family:var(--mono);font-size:13px;">\${esc(t.name)}</strong>
                  <span class="badge">\${t.rowCount} rows</span>
                </div>
                <div class="grid-wrap" style="margin-bottom:10px;">
                  <table>
                    <thead><tr><th>Column</th><th>Type</th><th>Attrs</th></tr></thead>
                    <tbody>
                      \${t.columns.map(c => \`
                        <tr>
                          <td>\${esc(c.name)}</td>
                          <td style="color:var(--blue);">\${esc(c.type || 'ANY')}</td>
                          <td>
                            \${c.pk ? '<span class="badge pk">PK</span> ' : ''}
                            \${c.notnull ? '<span class="badge">NOT NULL</span>' : ''}
                          </td>
                        </tr>
                      \`).join('')}
                    </tbody>
                  </table>
                </div>
                <div style="color:var(--muted);font-size:11px;">
                  Indexes: \${t.indexes.length === 0 ? 'None' : t.indexes.map(i => \`<span class="badge">\${esc(i.name)} (\${esc(i.columns.join(', '))})\${i.unique ? ' UNIQUE' : ''}</span>\`).join(' ')}
                </div>
              </div>
            \`).join('')}
          </div>
        \`);
      } else if (state.view === 'sql') {
        toolbar.innerHTML = \`
          <strong>SQL Console</strong>
          <div style="display:flex;gap:8px;">
            <button id="explainBtn" class="btn">Explain Plan</button>
            <button id="runSqlBtn" class="btn primary">Run Query (Ctrl+Enter)</button>
          </div>
        \`;
        const res = state.sqlResult;
        content.innerHTML = errHtml + \`
          <textarea id="sqlInput" class="sql">\${esc(state.sqlText)}</textarea>
          <div class="snippets">
            <button class="btn snippet" data-sql="SELECT name, type FROM sqlite_master ORDER BY name;">List Schema</button>
            <button class="btn snippet" data-sql="PRAGMA table_list;">Table List</button>
            <button class="btn snippet" data-sql="PRAGMA journal_mode;">Journal Mode</button>
            \${state.selectedTable ? \`<button class="btn snippet" data-sql="SELECT * FROM &quot;\${esc(state.selectedTable)}&quot; LIMIT 25;">Preview \${esc(state.selectedTable)}</button>\` : ''}
          </div>
          \${state.sqlHistory.length > 0 ? \`
            <div style="margin-bottom:12px;">
              <span style="color:var(--muted);font-size:11px;">Recent: </span>
              \${state.sqlHistory.slice(0, 4).map((q, i) => \`<button class="btn hist" data-idx="\${i}" style="font-family:var(--mono);font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\${esc(q)}</button>\`).join(' ')}
            </div>
          \` : ''}
          <div>
            \${res ? \`
              <div style="margin-bottom:8px;color:var(--muted);">
                \${res.rows.length} row(s) • \${res.durationMs} ms
              </div>
              <div class="grid-wrap">
                <table>
                  <thead><tr>\${res.columns.map(c => \`<th>\${esc(c)}</th>\`).join('')}</tr></thead>
                  <tbody>
                    \${res.rows.map(r => \`<tr>\${res.columns.map(c => \`<td>\${formatVal(r[c])}</td>\`).join('')}</tr>\`).join('')}
                  </tbody>
                </table>
              </div>
            \` : '<div class="empty">Run a SQL query to inspect results.</div>'}
          </div>
        \`;
        const sqlInput = document.getElementById('sqlInput');
        const run = async (prefix = '') => {
          const raw = sqlInput.value.trim();
          state.sqlText = raw;
          state.error = null;
          try {
            const sqlToRun = prefix ? prefix + raw : raw;
            state.sqlResult = await api('/api/query', {
              method: 'POST',
              body: JSON.stringify({ sql: sqlToRun }),
            });
            if (!prefix && raw && state.sqlHistory[0] !== raw) {
              state.sqlHistory = [raw, ...state.sqlHistory.filter(x => x !== raw)].slice(0, 10);
              localStorage.setItem('local_lite_sql_history', JSON.stringify(state.sqlHistory));
            }
          } catch (err) { state.error = err.message; }
          renderMain();
        };
        document.getElementById('runSqlBtn').onclick = () => run('');
        document.getElementById('explainBtn').onclick = () => run('EXPLAIN QUERY PLAN ');
        content.querySelectorAll('.snippet').forEach(b => {
          b.onclick = () => { sqlInput.value = b.dataset.sql; state.sqlText = b.dataset.sql; };
        });
        content.querySelectorAll('.hist').forEach(b => {
          b.onclick = () => {
            const q = state.sqlHistory[Number(b.dataset.idx)];
            sqlInput.value = q;
            state.sqlText = q;
          };
        });
        sqlInput.onkeydown = (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(''); }
        };
      } else if (state.view === 'sync') {
        toolbar.innerHTML = '<strong>Sync &amp; System Tables</strong>';
        const sys = state.system || {};
        const sections = [
          ['Sync Outbox (sync_outbox)', sys.outbox],
          ['KV Store (_local_kv_store)', sys.kvStore],
          ['Scheduler (_local_scheduler)', sys.scheduler],
          ['Actions (_local_actions)', sys.actions],
          ['Local Users (_local_users)', sys.users],
          ['Sessions (_local_sessions)', sys.sessions],
          ['Migrations (schema_migrations)', sys.migrations],
        ];
        content.innerHTML = errHtml + sections.map(([label, rows]) => \`
          <div class="card" style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <div class="label" style="margin:0;">\${esc(label)}</div>
              <span class="badge">\${rows === null ? 'Not present' : rows.length + ' rows'}</span>
            </div>
            \${rows === null ? '<div style="color:var(--muted);">Not initialized in this database</div>' :
              rows.length === 0 ? '<div style="color:var(--muted);">0 entries</div>' :
              '<pre>' + esc(JSON.stringify(rows, null, 2)) + '</pre>'}
          </div>
        \`).join('');
      } else if (state.view === 'overview') {
        toolbar.innerHTML = '<strong>Database Overview</strong>';
        const o = state.overview;
        const maxRows = o && o.topTables && o.topTables.length ? Math.max(1, ...o.topTables.map(t => t.rowCount)) : 1;
        content.innerHTML = errHtml + (o ? \`
          <div class="cards">
            <div class="card"><div class="label">SQLite Version</div><div class="value">\${esc(o.sqliteVersion)}</div></div>
            <div class="card"><div class="label">Journal Mode</div><div class="value">\${esc(o.journalMode)}</div></div>
            <div class="card"><div class="label">Data Tables</div><div class="value">\${o.dataTableCount}</div></div>
            <div class="card"><div class="label">System Tables</div><div class="value">\${o.systemTableCount}</div></div>
            <div class="card"><div class="label">Total Data Rows</div><div class="value">\${o.totalDataRows}</div></div>
            <div class="card"><div class="label">Indexes</div><div class="value">\${o.totalIndexes}</div></div>
            <div class="card"><div class="label">DB Size</div><div class="value">\${Math.round(o.databaseSizeBytes / 1024)} KB</div></div>
          </div>
          <div class="card">
            <div class="label" style="margin-bottom:12px;">Top Tables by Row Count</div>
            \${(o.topTables || []).length === 0 ? '<div style="color:var(--muted);">No data tables</div>' : o.topTables.map(t => \`
              <div class="bar-row">
                <span style="width:160px;overflow:hidden;text-overflow:ellipsis;">\${esc(t.name)}</span>
                <div class="bar-track"><div class="bar-fill" style="width:\${Math.round((t.rowCount / maxRows) * 100)}%;"></div></div>
                <span style="width:60px;text-align:right;color:var(--muted);">\${t.rowCount}</span>
              </div>
            \`).join('')}
          </div>
        \` : '<div class="empty">Loading...</div>');
      } else if (state.view === 'settings') {
        toolbar.innerHTML = '<strong>Settings &amp; Administration</strong>';
        const s = state.settings;
        const msgHtml = state.settingsMsg ? \`<div class="success-banner">\${esc(state.settingsMsg)}</div>\` : '';
        if (!s) {
          content.innerHTML = errHtml + '<div class="empty">Loading settings...</div>';
          return;
        }
        const p = s.pragmas || {};
        const kvEntries = (s.kvStore && s.kvStore.entries) || [];
        const sync = s.sync || {};
        const roDis = READ_ONLY ? 'disabled' : '';
        content.innerHTML = errHtml + msgHtml + \`
          <div class="settings-grid">
            <div class="card">
              <div class="label" style="margin-bottom:10px;">Dashboard &amp; Connection</div>
              <div class="setting-row">
                <div class="setting-label"><strong>Title</strong><span>Configured dashboard header title</span></div>
                <span class="badge">\${esc(s.dashboard.title)}</span>
              </div>
              <div class="setting-row">
                <div class="setting-label"><strong>Access Mode</strong><span>Write operations are \${READ_ONLY ? 'blocked' : 'enabled'}</span></div>
                <span class="badge \${READ_ONLY ? 'ro' : 'ok'}">\${READ_ONLY ? 'Read-Only' : 'Read / Write'}</span>
              </div>
              <div class="setting-row">
                <div class="setting-label"><strong>Auth Token</strong><span>Bearer / query token protection</span></div>
                <span class="badge \${s.dashboard.authEnabled ? 'ok' : ''}">\${s.dashboard.authEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <div class="setting-row">
                <div class="setting-label"><strong>Theme</strong><span>Switch between dark and light mode</span></div>
                <select id="themeSelect" class="input">
                  <option value="dark" \${state.theme === 'dark' ? 'selected' : ''}>Dark</option>
                  <option value="light" \${state.theme === 'light' ? 'selected' : ''}>Light</option>
                </select>
              </div>
              <div class="setting-row">
                <div class="setting-label"><strong>Rows Per Page</strong><span>Default pagination size for Data view</span></div>
                <select id="pageSizeSelect" class="input">
                  \${[25, 50, 100, 250].map(n => \`<option value="\${n}" \${state.limit === n ? 'selected' : ''}>\${n} rows</option>\`).join('')}
                </select>
              </div>
            </div>

            <div class="card">
              <div class="label" style="margin-bottom:10px;">SQLite PRAGMAs &amp; Storage</div>
              <div class="setting-row">
                <div class="setting-label"><strong>journal_mode</strong><span>Current: \${esc(p.journalMode)}</span></div>
                <div style="display:flex;gap:6px;">
                  <select id="pragmaJournal" class="input" \${roDis}>
                    \${['WAL', 'DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY'].map(m => \`<option value="\${m}" \${String(p.journalMode).toUpperCase() === m ? 'selected' : ''}>\${m}</option>\`).join('')}
                  </select>
                  <button class="btn pragma-apply" data-pragma="journal_mode" data-input="pragmaJournal" \${roDis}>Apply</button>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-label"><strong>synchronous</strong><span>0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA</span></div>
                <div style="display:flex;gap:6px;">
                  <select id="pragmaSync" class="input" \${roDis}>
                    \${[[0,'0 (OFF)'],[1,'1 (NORMAL)'],[2,'2 (FULL)'],[3,'3 (EXTRA)']].map(([v,lbl]) => \`<option value="\${v}" \${Number(p.synchronous) === v ? 'selected' : ''}>\${lbl}</option>\`).join('')}
                  </select>
                  <button class="btn pragma-apply" data-pragma="synchronous" data-input="pragmaSync" \${roDis}>Apply</button>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-label"><strong>busy_timeout (ms)</strong><span>Lock wait timeout in milliseconds</span></div>
                <div style="display:flex;gap:6px;">
                  <input id="pragmaBusy" type="number" class="input" style="width:90px;" value="\${esc(p.busyTimeout)}" \${roDis} />
                  <button class="btn pragma-apply" data-pragma="busy_timeout" data-input="pragmaBusy" \${roDis}>Apply</button>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-label"><strong>cache_size</strong><span>Pages (positive) or KiB (negative)</span></div>
                <div style="display:flex;gap:6px;">
                  <input id="pragmaCache" type="number" class="input" style="width:90px;" value="\${esc(p.cacheSize)}" \${roDis} />
                  <button class="btn pragma-apply" data-pragma="cache_size" data-input="pragmaCache" \${roDis}>Apply</button>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-label"><strong>foreign_keys</strong><span>Enforce foreign key constraints</span></div>
                <div style="display:flex;gap:6px;">
                  <select id="pragmaFk" class="input" \${roDis}>
                    <option value="1" \${p.foreignKeys ? 'selected' : ''}>ON</option>
                    <option value="0" \${!p.foreignKeys ? 'selected' : ''}>OFF</option>
                  </select>
                  <button class="btn pragma-apply" data-pragma="foreign_keys" data-input="pragmaFk" \${roDis}>Apply</button>
                </div>
              </div>
              <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn maint-btn" data-action="vacuum" \${roDis}>Run VACUUM</button>
                <button class="btn maint-btn" data-action="checkpoint" \${roDis}>WAL Checkpoint</button>
                <button class="btn maint-btn" data-action="integrity_check">Integrity Check</button>
                <a class="btn" href="\${authUrl('/api/settings/export')}" download>Export JSON</a>
              </div>
              <div style="margin-top:8px;color:var(--muted);font-size:11px;font-family:var(--mono);">
                Page size: \${p.pageSize} B • Pages: \${p.pageCount} • Freelist: \${p.freelistCount}
              </div>
            </div>

            <div class="card">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div class="label" style="margin:0;">KV Store Manager (_local_kv_store)</div>
                <div style="display:flex;gap:6px;">
                  <button class="btn maint-btn" data-action="prune_kv_expired" \${roDis}>Prune Expired</button>
                  <button id="addKvBtn" class="btn primary" \${roDis}>+ Set Key</button>
                </div>
              </div>
              \${kvEntries.length === 0 ? '<div style="color:var(--muted);">No keys stored in _local_kv_store.</div>' : \`
                <div class="grid-wrap" style="max-height:280px;">
                  <table>
                    <thead><tr><th>Key</th><th>Type</th><th>Value</th><th>Expires</th><th>Actions</th></tr></thead>
                    <tbody>
                      \${kvEntries.map(k => \`
                        <tr>
                          <td>\${esc(k.key)}</td>
                          <td><span class="badge">\${esc(k.type)}</span></td>
                          <td>\${esc(k.type === 'encrypted' ? '[encrypted]' : String(k.value ?? ''))}</td>
                          <td>\${k.expires_at ? new Date(Number(k.expires_at)).toLocaleString() : 'Never'}</td>
                          <td>
                            <button class="btn kv-edit" data-key="\${esc(k.key)}" \${roDis}>Edit</button>
                            <button class="btn danger kv-del" data-key="\${esc(k.key)}" \${roDis}>Del</button>
                          </td>
                        </tr>
                      \`).join('')}
                    </tbody>
                  </table>
                </div>
              \`}
            </div>

            <div class="card">
              <div class="label" style="margin-bottom:10px;">Sync, Outbox &amp; Scheduler</div>
              <div class="setting-row">
                <div class="setting-label"><strong>sync_outbox</strong><span>Total: \${sync.outboxTotal ?? 0} • Pending: \${sync.outboxPending ?? 0} • Failed: \${sync.outboxFailed ?? 0}</span></div>
                <span class="badge">\${sync.outboxExists ? 'Active' : 'Not initialized'}</span>
              </div>
              <div style="margin:10px 0 14px;display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn maint-btn" data-action="prune_outbox" \${roDis}>Prune Synced Outbox</button>
                <button class="btn danger maint-btn" data-action="clear_failed_outbox" \${roDis}>Clear Failed Mutations</button>
              </div>
              <div class="label" style="margin-bottom:6px;">Scheduled Jobs</div>
              \${!sync.schedulerJobs ? '<div style="color:var(--muted);">No scheduler table initialized.</div>' :
                sync.schedulerJobs.length === 0 ? '<div style="color:var(--muted);">0 scheduled jobs.</div>' :
                '<pre style="max-height:180px;overflow:auto;">' + esc(JSON.stringify(sync.schedulerJobs, null, 2)) + '</pre>'}
            </div>
          </div>
        \`;

        document.getElementById('themeSelect').onchange = (e) => {
          state.theme = e.target.value;
          localStorage.setItem('local_lite_theme', state.theme);
          document.documentElement.setAttribute('data-theme', state.theme);
        };
        document.getElementById('pageSizeSelect').onchange = (e) => {
          state.limit = Number(e.target.value);
          localStorage.setItem('local_lite_limit', String(state.limit));
          state.settingsMsg = 'Default page size updated to ' + state.limit + ' rows.';
          renderMain();
        };
        content.querySelectorAll('.pragma-apply').forEach(btn => {
          btn.onclick = async () => {
            state.error = null;
            state.settingsMsg = null;
            try {
              const inp = document.getElementById(btn.dataset.input);
              await api('/api/settings/pragma', {
                method: 'POST',
                body: JSON.stringify({ pragma: btn.dataset.pragma, value: inp.value }),
              });
              state.settingsMsg = 'Updated PRAGMA ' + btn.dataset.pragma + '.';
              state.settings = await api('/api/settings');
            } catch (err) { state.error = err.message; }
            renderMain();
          };
        });
        content.querySelectorAll('.maint-btn').forEach(btn => {
          btn.onclick = async () => {
            state.error = null;
            state.settingsMsg = null;
            try {
              const res = await api('/api/settings/maintenance', {
                method: 'POST',
                body: JSON.stringify({ action: btn.dataset.action }),
              });
              state.settingsMsg = res.message || 'Maintenance completed.';
              state.settings = await api('/api/settings');
            } catch (err) { state.error = err.message; }
            renderMain();
          };
        });

        const openKvModal = (existing) => {
          openModal(existing ? 'Edit KV Store Key' : 'Set KV Store Key', \`
            <div class="field-row">
              <label>Key</label>
              <input id="kvKeyInput" class="input" value="\${esc(existing ? existing.key : '')}" \${existing ? 'disabled' : ''} />
            </div>
            <div class="field-row">
              <label>Type</label>
              <select id="kvTypeInput" class="input" style="width:100%;">
                \${['string', 'number', 'boolean', 'json'].map(t => \`<option value="\${t}" \${existing && existing.type === t ? 'selected' : ''}>\${t}</option>\`).join('')}
              </select>
            </div>
            <div class="field-row">
              <label>Value</label>
              <input id="kvValInput" class="input" value="\${esc(existing ? existing.value : '')}" />
            </div>
            <div class="field-row">
              <label>TTL (ms, optional)</label>
              <input id="kvTtlInput" type="number" class="input" placeholder="Leave blank for no expiration" />
            </div>
            <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">
              <button id="saveKvBtn" class="btn primary">Save Key</button>
            </div>
          \`);
          document.getElementById('saveKvBtn').onclick = async () => {
            try {
              const ttlRaw = document.getElementById('kvTtlInput').value.trim();
              await api('/api/kv-store', {
                method: 'POST',
                body: JSON.stringify({
                  key: document.getElementById('kvKeyInput').value.trim(),
                  type: document.getElementById('kvTypeInput').value,
                  value: document.getElementById('kvValInput').value,
                  ttlMs: ttlRaw ? Number(ttlRaw) : null,
                }),
              });
              closeModal();
              state.settingsMsg = 'KV Store key saved.';
              state.settings = await api('/api/settings');
              renderMain();
            } catch (err) { alert(err.message); }
          };
        };

        const addKvBtn = document.getElementById('addKvBtn');
        if (addKvBtn) addKvBtn.onclick = () => openKvModal(null);
        content.querySelectorAll('.kv-edit').forEach(btn => {
          btn.onclick = () => {
            const entry = kvEntries.find(x => x.key === btn.dataset.key);
            if (entry) openKvModal(entry);
          };
        });
        content.querySelectorAll('.kv-del').forEach(btn => {
          btn.onclick = async () => {
            if (!confirm('Delete key "' + btn.dataset.key + '"?')) return;
            try {
              await api('/api/kv-store', {
                method: 'DELETE',
                body: JSON.stringify({ key: btn.dataset.key }),
              });
              state.settingsMsg = 'Deleted key "' + btn.dataset.key + '".';
              state.settings = await api('/api/settings');
              renderMain();
            } catch (err) { state.error = err.message; renderMain(); }
          };
        });
      }
    }

    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.onclick = () => {
        state.view = btn.dataset.view;
        updateNavButtons();
        refreshActiveView();
      };
    });
    document.getElementById('showSystemToggle').onchange = (e) => {
      state.showSystem = e.target.checked;
      renderTablesList();
    };
    document.getElementById('tableFilterInput').oninput = (e) => {
      state.tableFilter = e.target.value;
      renderTablesList();
    };
    document.getElementById('pollSelect').onchange = (e) => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      const ms = Number(e.target.value);
      if (ms > 0) pollTimer = setInterval(refreshActiveView, ms);
    };
    document.getElementById('refreshBtn').onclick = refreshActiveView;

    refreshActiveView();
    api('/api/overview').then(o => {
      state.overview = o;
      document.getElementById('dbBadge').textContent = 'SQLite ' + o.sqliteVersion;
    }).catch(() => {});
  </script>
</body>
</html>`;
}
