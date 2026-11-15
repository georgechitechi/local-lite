import type { LocalDBAdapter } from '../adapters/local/index.js';
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
        const [outbox, kv, scheduler, actions, users, sessions, migrations] =
          await Promise.all([
            readRowsIfTableExists(db, 'sync_outbox', 200),
            readRowsIfTableExists(db, '_local_kv', 200),
            readRowsIfTableExists(db, '_local_scheduler', 100),
            readRowsIfTableExists(db, '_local_actions', 100),
            readRowsIfTableExists(db, '_local_users', 100),
            readRowsIfTableExists(db, '_local_sessions', 100),
            readRowsIfTableExists(db, 'schema_migrations', 100),
          ]);
        return jsonResponse({
          outbox,
          kv,
          scheduler,
          actions,
          users,
          sessions,
          migrations,
        });
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
      limit: 50,
      offset: 0,
      search: '',
      filterCol: '',
      filterVal: '',
      orderBy: '',
      orderDir: 'ASC',
      overview: null,
      system: null,
      sqlText: 'SELECT name, type FROM sqlite_master ORDER BY name;',
      sqlResult: null,
      sqlHistory: JSON.parse(localStorage.getItem('local_lite_sql_history') || '[]'),
      error: null,
    };

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
          ['KV Store (_local_kv)', sys.kv],
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
