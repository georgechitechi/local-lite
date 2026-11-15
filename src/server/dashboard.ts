import type { LocalDBAdapter } from '../adapters/local/index.js';
import { generateCryptoToken, LocalAuthEngine } from '../auth/local.js';
import { decryptBackupData, encryptBackupData } from '../backups/encryption.js';
import { DEFAULT_KV_STORE_TABLE, KVStore } from '../kv-store/store.js';
import { escapeIdentifier, isInternalTable, isReadQuery } from '../utils/sql.js';

export interface DashboardHandlerOptions {
  /** Display title in the dashboard header. */
  title?: string;
  /** Disable mutations and mutating SQL queries. Defaults to false. */
  readOnly?: boolean;
  /** Optional bearer/query token required to access the dashboard and its APIs. */
  authToken?: string;
  /** Require local-lite user login to access dashboard APIs. Defaults to true. */
  requireAuth?: boolean;
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

interface TableForeignKeyInfo {
  table: string;
  from: string;
  to: string;
}

interface TableSummary {
  name: string;
  internal: boolean;
  rowCount: number;
  columns: TableColumnInfo[];
  indexes: TableIndexInfo[];
  foreignKeys: TableForeignKeyInfo[];
}

interface DashboardLogEntry {
  id: number;
  timestamp: number;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  detail?: string;
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

function extractSessionToken(request: Request, url: URL): string | null {
  const header = request.headers.get('authorization');
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      if (k === 'local_lite_session') {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
  }
  return null;
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

    const fkRows = await db
      .execute(`PRAGMA foreign_key_list(${quoted});`)
      .catch(() => [] as any[]);
    const foreignKeys: TableForeignKeyInfo[] = (fkRows ?? [])
      .map((fk: any) => ({
        table: String(fk.table ?? ''),
        from: String(fk.from ?? ''),
        to: String(fk.to ?? ''),
      }))
      .filter((fk) => fk.table && fk.from && fk.to);

    const rowCount = Number(countRows?.[0]?.cnt ?? 0);
    summaries.push({
      name,
      internal: isInternalTable(name),
      rowCount,
      columns,
      indexes,
      foreignKeys,
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
  const requireAuth = options.requireAuth !== false;
  const basePath = (options.basePath ?? '').replace(/\/+$/, '');
  const authEngine = new LocalAuthEngine(db);
  let authInitPromise: Promise<void> | null = null;
  const ensureAuth = () => (authInitPromise ??= authEngine.initialize());

  const countUsers = async (): Promise<number> => {
    await ensureAuth();
    const rows = (await db.execute(`SELECT COUNT(*) AS cnt FROM _local_users;`)) ?? [];
    return Number(rows[0]?.cnt ?? 0);
  };

  const verifyLocalSession = async (
    request: Request,
    url: URL,
  ): Promise<{ id: string; email?: string; username?: string; name?: string; role?: string } | null> => {
    const token = extractSessionToken(request, url);
    if (!token) return null;
    await ensureAuth();
    const rows =
      (await db.execute(
        `SELECT s.id AS session_id, s.user_id, s.expires_at, u.email, u.username, u.display_name, u.role
         FROM _local_sessions s
         INNER JOIN _local_users u ON u.id = s.user_id
         WHERE s.token = ?
         LIMIT 1;`,
        [token],
      )) ?? [];
    const row = rows[0];
    if (!row) return null;
    if (row.expires_at !== null && row.expires_at !== undefined && Number(row.expires_at) <= Date.now()) {
      return null;
    }
    return {
      id: String(row.user_id),
      email: row.email ? String(row.email) : undefined,
      username: row.username ? String(row.username) : undefined,
      name: row.display_name ? String(row.display_name) : undefined,
      role: row.role ? String(row.role) : undefined,
    };
  };

  const withSessionCookie = (res: Response, token: string, maxAgeSeconds = 60 * 60 * 24 * 7) => {
    const headers = new Headers(res.headers);
    headers.append(
      'Set-Cookie',
      `local_lite_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`,
    );
    return new Response(res.body, { status: res.status, headers });
  };

  const logs: DashboardLogEntry[] = [];
  let nextLogId = 1;
  const recordLog = (
    method: string,
    path: string,
    status: number,
    startedAt: number,
    detail?: string,
  ) => {
    if (path === '/api/logs') return;
    logs.unshift({
      id: nextLogId++,
      timestamp: Date.now(),
      method,
      path,
      status,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      detail,
    });
    if (logs.length > 200) logs.length = 200;
  };

  return async (request: Request): Promise<Response> => {
    const startedAt = performance.now();
    const url = new URL(request.url);
    let pathname = url.pathname;
    if (basePath && pathname.startsWith(basePath)) {
      pathname = pathname.slice(basePath.length) || '/';
    }

    if (options.authToken && !isAuthorized(request, url, options.authToken)) {
      recordLog(request.method, pathname, 401, startedAt, 'Unauthorized');
      return errorResponse('Unauthorized.', 401);
    }

    // ── Local Auth endpoints (accessible before login) ──────────────────
    if (pathname === '/api/dashboard-auth/status' && request.method === 'GET') {
      try {
        const userCount = await countUsers();
        const sessionUser = requireAuth ? await verifyLocalSession(request, url) : null;
        return jsonResponse({
          requireAuth,
          authenticated: !requireAuth || Boolean(options.authToken && isAuthorized(request, url, options.authToken)) || Boolean(sessionUser),
          userCount,
          user: sessionUser,
        });
      } catch (err: any) {
        return errorResponse(err?.message ?? 'Auth status failed.', 500);
      }
    }

    if (pathname === '/api/dashboard-auth/setup' && request.method === 'POST') {
      try {
        const userCount = await countUsers();
        if (userCount > 0) {
          return errorResponse('Admin account already exists. Please sign in.', 403);
        }
        const body = (await request.json().catch(() => null)) as {
          email?: string;
          username?: string;
          password?: string;
          name?: string;
        } | null;
        const result = await authEngine.signUp({
          email: String(body?.email ?? ''),
          username: body?.username ? String(body.username) : undefined,
          password: String(body?.password ?? ''),
          displayName: body?.name ? String(body.name) : undefined,
          role: 'admin',
        });
        let token = result.session?.token ?? '';
        if (!token && result.session?.id) {
          token = generateCryptoToken(32).token;
          await db.execute(`UPDATE _local_sessions SET token = ? WHERE id = ?;`, [
            token,
            result.session.id,
          ]);
        }
        const res = jsonResponse({
          user: result.user,
          token,
          expiresAt: result.session?.expiresAt ?? null,
        }, 201);
        return token ? withSessionCookie(res, token) : res;
      } catch (err: any) {
        return errorResponse(err?.message ?? 'Setup failed.', 400);
      }
    }

    if (pathname === '/api/dashboard-auth/login' && request.method === 'POST') {
      try {
        await ensureAuth();
        const body = (await request.json().catch(() => null)) as {
          identifier?: string;
          password?: string;
        } | null;
        const result = await authEngine.signIn({
          identifier: String(body?.identifier ?? ''),
          password: String(body?.password ?? ''),
        });
        let token = result.session?.token ?? '';
        if (!token && result.session?.id) {
          token = generateCryptoToken(32).token;
          await db.execute(`UPDATE _local_sessions SET token = ? WHERE id = ?;`, [
            token,
            result.session.id,
          ]);
        }
        const res = jsonResponse({
          user: result.user,
          token,
          expiresAt: result.session?.expiresAt ?? null,
        });
        return token ? withSessionCookie(res, token) : res;
      } catch (err: any) {
        return errorResponse(err?.message ?? 'Invalid credentials.', 401);
      }
    }

    if (pathname === '/api/dashboard-auth/logout' && request.method === 'POST') {
      try {
        const token = extractSessionToken(request, url);
        if (token) {
          await ensureAuth();
          await db.execute(`DELETE FROM _local_sessions WHERE token = ?;`, [token]);
        }
        return withSessionCookie(jsonResponse({ ok: true }), '', 0);
      } catch (err: any) {
        return errorResponse(err?.message ?? 'Logout failed.', 500);
      }
    }

    // Gate all other /api/* requests behind local-lite session auth when requireAuth is enabled
    if (requireAuth && pathname.startsWith('/api/')) {
      const staticTokenOk = Boolean(options.authToken && isAuthorized(request, url, options.authToken));
      const sessionUser = staticTokenOk ? { id: 'token' } : await verifyLocalSession(request, url);
      if (!sessionUser) {
        recordLog(request.method, pathname, 401, startedAt, 'Unauthorized');
        return errorResponse('Authentication required.', 401);
      }
    }

    let loggedThisRequest = false;
    const reply = (res: Response, detail?: string) => {
      if (pathname.startsWith('/api/')) {
        loggedThisRequest = true;
        recordLog(request.method, pathname, res.status, startedAt, detail);
      }
      return res;
    };

    const res = await (async (): Promise<Response> => {
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
        return reply(
          jsonResponse({
            columns,
            rows,
            rowsAffected: 0,
            durationMs,
          }),
          sql.slice(0, 160),
        );
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
          if (action === 'delete_outbox' && id) {
            await db.execute(`DELETE FROM sync_outbox WHERE id = ?;`, [id]);
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

      // ── Live Logs & Query Telemetry ────────────────────────────────────
      if (pathname === '/api/logs') {
        if (request.method === 'GET') {
          const level = url.searchParams.get('level')?.trim() || '';
          const search = url.searchParams.get('q')?.trim().toLowerCase() || '';
          const filtered = logs.filter((entry) => {
            if (level === 'error' && entry.status < 400) return false;
            if (level === 'ok' && entry.status >= 400) return false;
            if (search) {
              const hay = `${entry.method} ${entry.path} ${entry.detail ?? ''}`.toLowerCase();
              if (!hay.includes(search)) return false;
            }
            return true;
          });
          return jsonResponse({ logs: filtered });
        }
        if (request.method === 'DELETE') {
          logs.length = 0;
          return jsonResponse({ ok: true });
        }
      }

      // ── Sample Row Seeder ──────────────────────────────────────────────
      const seedMatch = pathname.match(/^\/api\/tables\/([^/]+)\/seed$/);
      if (seedMatch && request.method === 'POST') {
        if (readOnly) return reply(errorResponse('Dashboard is in read-only mode.', 403));
        const tableName = decodeURIComponent(seedMatch[1]);
        const quoted = escapeIdentifier(tableName);
        const colRows = (await db.execute(`PRAGMA table_info(${quoted});`)) ?? [];
        if (colRows.length === 0) {
          return reply(errorResponse(`Table "${tableName}" not found.`, 404));
        }
        const body = (await request.json().catch(() => null)) as { count?: number } | null;
        const count = Math.min(100, Math.max(1, Number(body?.count ?? 10) || 10));
        const cols = colRows.map((r) => ({
          name: String(r.name),
          type: String(r.type ?? 'TEXT').toUpperCase(),
          notnull: Boolean(r.notnull),
          pk: Number(r.pk) > 0,
        }));

        const fkRows = (await db.execute(`PRAGMA foreign_key_list(${quoted});`)) ?? [];
        const fkValues = new Map<string, unknown[]>();
        for (const fk of fkRows) {
          const fromCol = String(fk.from ?? '');
          const refTable = String(fk.table ?? '');
          const refCol = String(fk.to ?? '');
          if (!fromCol || !refTable || !refCol) continue;
          try {
            const refRows =
              (await db.execute(
                `SELECT ${escapeIdentifier(refCol)} AS val FROM ${escapeIdentifier(refTable)} LIMIT 20;`,
              )) ?? [];
            fkValues.set(
              fromCol.toLowerCase(),
              refRows.map((r) => r.val),
            );
          } catch {
            // ignore
          }
        }

        const now = Date.now();
        let inserted = 0;
        for (let i = 0; i < count; i++) {
          const insertCols: string[] = [];
          const placeholders: string[] = [];
          const params: unknown[] = [];
          for (const col of cols) {
            const lower = col.name.toLowerCase();
            if (col.pk && col.type.includes('INT')) {
              continue;
            }
            insertCols.push(escapeIdentifier(col.name));
            placeholders.push('?');
            const n = i + 1;
            const suffix = `${now.toString(36)}_${n}`;
            const fkCandidates = fkValues.get(lower);
            if (fkCandidates !== undefined) {
              params.push(
                fkCandidates.length > 0
                  ? fkCandidates[i % fkCandidates.length]
                  : col.notnull
                    ? `${tableName.slice(0, 4)}_${suffix}`
                    : null,
              );
            } else if (col.pk || lower === 'id' || lower.endsWith('_id')) {
              params.push(`${tableName.slice(0, 4)}_${suffix}`);
            } else if (lower.includes('email')) {
              params.push(`user${n}_${now.toString(36)}@example.com`);
            } else if (lower.includes('name') || lower.includes('title')) {
              params.push(`Sample ${col.name} ${n}`);
            } else if (lower.includes('created') || lower.includes('updated') || lower.includes('date') || lower.includes('time')) {
              params.push(col.type.includes('INT') ? now + i : new Date(now + i * 1000).toISOString());
            } else if (lower.includes('active') || lower.includes('enabled') || lower.startsWith('is_') || col.type.includes('BOOL')) {
              params.push(i % 2 === 0 ? 1 : 0);
            } else if (col.type.includes('INT')) {
              params.push(n * 10);
            } else if (col.type.includes('REAL') || col.type.includes('FLOAT') || col.type.includes('NUM') || col.type.includes('DEC')) {
              params.push(Number((n * 12.5).toFixed(2)));
            } else {
              params.push(`${col.name}_${n}`);
            }
          }
          if (insertCols.length === 0) {
            await db.execute(`INSERT INTO ${quoted} DEFAULT VALUES;`);
          } else {
            await db.execute(
              `INSERT INTO ${quoted} (${insertCols.join(', ')}) VALUES (${placeholders.join(', ')});`,
              params,
            );
          }
          inserted++;
        }
        return reply(jsonResponse({ ok: true, inserted }), `Seeded ${inserted} rows into ${tableName}`);
      }

      // ── Migration & Schema Diff Generator ──────────────────────────────
      if (pathname === '/api/schema/diff' && request.method === 'POST') {
        const body = (await request.json().catch(() => null)) as {
          targetSql?: string;
          tables?: { name: string; columns: { name: string; type: string; notnull?: boolean; pk?: boolean; dflt_value?: string | null }[] }[];
        } | null;
        const targetSql = typeof body?.targetSql === 'string' ? body.targetSql : '';
        const targetTablesInput = Array.isArray(body?.tables) ? body.tables : null;
        const liveTables = (await listTables(db)).filter((t) => !isInternalTable(t.name));

        interface TargetCol { name: string; type: string; notnull?: boolean; pk?: boolean; dflt_value?: string | null }
        interface TargetTable { name: string; columns: TargetCol[] }

        const parseTargetSql = (sqlText: string): TargetTable[] => {
          const parsed: TargetTable[] = [];
          const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s*\(([\s\S]*?)\)\s*;/gi;
          let match: RegExpExecArray | null;
          while ((match = regex.exec(sqlText)) !== null) {
            const tName = match[1];
            const bodyStr = match[2];
            const cols: TargetCol[] = [];
            for (const rawLine of bodyStr.split(',')) {
              const line = rawLine.trim();
              if (!line || /^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)) continue;
              const colMatch = line.match(/^["`[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s+([A-Za-z0-9_()]+)?([\s\S]*)$/i);
              if (!colMatch) continue;
              const colName = colMatch[1];
              const colType = (colMatch[2] || 'TEXT').toUpperCase();
              const rest = (colMatch[3] || '').toUpperCase();
              cols.push({
                name: colName,
                type: colType,
                notnull: rest.includes('NOT NULL'),
                pk: rest.includes('PRIMARY KEY'),
              });
            }
            parsed.push({ name: tName, columns: cols });
          }
          return parsed;
        };

        const targetTables: TargetTable[] = targetTablesInput
          ? targetTablesInput
          : targetSql.trim()
            ? parseTargetSql(targetSql)
            : [];

        const statements: string[] = [];
        const summary: { type: string; table: string; detail: string }[] = [];

        if (targetTables.length === 0) {
          for (const t of liveTables) {
            const colDefs = t.columns.map((c) => {
              const parts = [escapeIdentifier(c.name), c.type || 'TEXT'];
              if (c.pk) parts.push('PRIMARY KEY');
              if (c.notnull && !c.pk) parts.push('NOT NULL');
              if (c.dflt_value !== null && c.dflt_value !== undefined) parts.push(`DEFAULT ${c.dflt_value}`);
              return `  ${parts.join(' ')}`;
            });
            statements.push(`CREATE TABLE IF NOT EXISTS ${escapeIdentifier(t.name)} (\n${colDefs.join(',\n')}\n);`);
            summary.push({ type: 'baseline', table: t.name, detail: `${t.columns.length} columns` });
          }
        } else {
          const liveMap = new Map(liveTables.map((t) => [t.name.toLowerCase(), t]));
          const targetMap = new Map(targetTables.map((t) => [t.name.toLowerCase(), t]));

          for (const target of targetTables) {
            const live = liveMap.get(target.name.toLowerCase());
            if (!live) {
              const colDefs = target.columns.map((c) => {
                const parts = [escapeIdentifier(c.name), c.type || 'TEXT'];
                if (c.pk) parts.push('PRIMARY KEY');
                if (c.notnull && !c.pk) parts.push('NOT NULL');
                if (c.dflt_value !== null && c.dflt_value !== undefined) parts.push(`DEFAULT ${c.dflt_value}`);
                return `  ${parts.join(' ')}`;
              });
              statements.push(`CREATE TABLE IF NOT EXISTS ${escapeIdentifier(target.name)} (\n${colDefs.join(',\n')}\n);`);
              summary.push({ type: 'create_table', table: target.name, detail: `New table (${target.columns.length} columns)` });
            } else {
              const liveCols = new Set(live.columns.map((c) => c.name.toLowerCase()));
              for (const tc of target.columns) {
                if (!liveCols.has(tc.name.toLowerCase())) {
                  const def = `${escapeIdentifier(tc.name)} ${tc.type || 'TEXT'}${tc.notnull ? " NOT NULL DEFAULT ''" : ''}`;
                  statements.push(`ALTER TABLE ${escapeIdentifier(target.name)} ADD COLUMN ${def};`);
                  summary.push({ type: 'add_column', table: target.name, detail: `Add column ${tc.name} (${tc.type || 'TEXT'})` });
                }
              }
            }
          }

          for (const live of liveTables) {
            if (!targetMap.has(live.name.toLowerCase())) {
              statements.push(`-- Table "${live.name}" exists in DB but not in target schema`);
              statements.push(`-- DROP TABLE IF EXISTS ${escapeIdentifier(live.name)};`);
              summary.push({ type: 'extra_table', table: live.name, detail: 'Exists in DB only (commented DROP)' });
            }
          }
        }

        return reply(jsonResponse({
          sql: statements.join('\n\n'),
          changes: summary,
        }));
      }

      // ── FTS5 Full-Text Search Explorer ─────────────────────────────────
      if (pathname === '/api/search/indexes' && request.method === 'GET') {
        const ftsRows = (await db.execute(
          `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name LIKE '_fts_%' AND sql LIKE 'CREATE VIRTUAL TABLE%' ORDER BY name;`,
        )) ?? [];
        const indexes = [];
        for (const row of ftsRows) {
          const ftsName = String(row.name);
          const sourceTable = ftsName.replace(/^_fts_/, '');
          let count = 0;
          try {
            const cnt = (await db.execute(`SELECT COUNT(*) AS count FROM ${escapeIdentifier(ftsName)};`)) ?? [];
            count = Number(cnt[0]?.count ?? 0);
          } catch {
            // ignore
          }
          indexes.push({
            ftsTable: ftsName,
            sourceTable,
            rowCount: count,
            sql: row.sql ? String(row.sql) : null,
          });
        }
        return reply(jsonResponse({ indexes }));
      }

      if (pathname === '/api/search/index' && request.method === 'POST') {
        if (readOnly) return reply(errorResponse('Dashboard is in read-only mode.', 403));
        const body = (await request.json().catch(() => null)) as { table?: string; columns?: string[] } | null;
        const tableName = typeof body?.table === 'string' ? body.table.trim() : '';
        if (!tableName) return reply(errorResponse('Table name is required.', 400));
        const quotedSource = escapeIdentifier(tableName);
        const info = (await db.execute(`PRAGMA table_info(${quotedSource});`)) ?? [];
        if (info.length === 0) return reply(errorResponse(`Table "${tableName}" not found.`, 404));

        const requestedCols: string[] = Array.isArray(body?.columns)
          ? body.columns.map(String).filter(Boolean)
          : info
              .filter((r) => !String(r.type ?? '').toUpperCase().includes('BLOB'))
              .map((r) => String(r.name));
        if (requestedCols.length === 0) {
          return reply(errorResponse('No searchable columns found.', 400));
        }

        const ftsName = `_fts_${tableName}`;
        const quotedFts = escapeIdentifier(ftsName);
        const colList = requestedCols.map((c) => escapeIdentifier(c)).join(', ');
        const newColList = requestedCols.map((c) => `new.${escapeIdentifier(c)}`).join(', ');
        await db.execute(`DROP TABLE IF EXISTS ${quotedFts};`);
        await db.execute(`CREATE VIRTUAL TABLE ${quotedFts} USING fts5(${colList});`);
        await db.execute(
          `INSERT INTO ${quotedFts}(rowid, ${colList}) SELECT rowid, ${colList} FROM ${quotedSource};`,
        );

        const aiTrig = escapeIdentifier(`_fts_${tableName}_ai`);
        const auTrig = escapeIdentifier(`_fts_${tableName}_au`);
        const adTrig = escapeIdentifier(`_fts_${tableName}_ad`);
        await db.execute(`DROP TRIGGER IF EXISTS ${aiTrig};`);
        await db.execute(`DROP TRIGGER IF EXISTS ${auTrig};`);
        await db.execute(`DROP TRIGGER IF EXISTS ${adTrig};`);
        await db.execute(
          `CREATE TRIGGER ${aiTrig} AFTER INSERT ON ${quotedSource} BEGIN
            INSERT INTO ${quotedFts}(rowid, ${colList}) VALUES (new.rowid, ${newColList});
          END;`,
        );
        await db.execute(
          `CREATE TRIGGER ${adTrig} AFTER DELETE ON ${quotedSource} BEGIN
            DELETE FROM ${quotedFts} WHERE rowid = old.rowid;
          END;`,
        );
        await db.execute(
          `CREATE TRIGGER ${auTrig} AFTER UPDATE ON ${quotedSource} BEGIN
            DELETE FROM ${quotedFts} WHERE rowid = old.rowid;
            INSERT INTO ${quotedFts}(rowid, ${colList}) VALUES (new.rowid, ${newColList});
          END;`,
        );

        const cnt = (await db.execute(`SELECT COUNT(*) AS count FROM ${quotedFts};`)) ?? [];
        return reply(
          jsonResponse(
            {
              ok: true,
              ftsTable: ftsName,
              sourceTable: tableName,
              columns: requestedCols,
              rowCount: Number(cnt[0]?.count ?? 0),
            },
            201,
          ),
          `Indexed ${tableName} into ${ftsName}`,
        );
      }

      if (pathname === '/api/search' && request.method === 'GET') {
        const tableName = url.searchParams.get('table')?.trim() || '';
        const q = url.searchParams.get('q')?.trim() || '';
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 25) || 25));
        if (!tableName) return reply(errorResponse('Query parameter "table" is required.', 400));
        const ftsName = tableName.startsWith('_fts_') ? tableName : `_fts_${tableName}`;
        const quotedFts = escapeIdentifier(ftsName);
        if (!q) {
          const rows = (await db.execute(`SELECT rowid, * FROM ${quotedFts} LIMIT ?;`, [limit])) ?? [];
          const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
          return reply(jsonResponse({ rows, columns }));
        }
        const safeQuery = q.includes('"') ? q : `"${q.replace(/"/g, '""')}"*`;
        const info = (await db.execute(`PRAGMA table_info(${quotedFts});`)) ?? [];
        const snippetExpr = info.length > 0
          ? `snippet(${quotedFts}, 0, '<mark>', '</mark>', '...', 24) AS _snippet,`
          : '';
        const rows =
          (await db.execute(
            `SELECT rowid, bm25(${quotedFts}) AS _rank, ${snippetExpr} * FROM ${quotedFts} WHERE ${quotedFts} MATCH ? ORDER BY _rank LIMIT ?;`,
            [safeQuery, limit],
          )) ?? [];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return reply(jsonResponse({ rows, columns }), `FTS5 "${q}" on ${ftsName}`);
      }

      // ── Encrypted Backup & Restore ─────────────────────────────────────
      if (pathname === '/api/backups/export' && request.method === 'POST') {
        const body = (await request.json().catch(() => null)) as { passphrase?: string } | null;
        const passphrase = typeof body?.passphrase === 'string' ? body.passphrase : '';
        if (passphrase.length < 4) {
          return reply(errorResponse('Passphrase must be at least 4 characters.', 400));
        }
        const allTables = (await listTables(db)).filter((t) => !t.name.startsWith('_fts_') && !t.name.startsWith('sqlite_'));
        const tablesData: Record<string, { sql: string | null; rows: Record<string, unknown>[] }> = {};
        for (const t of allTables) {
          const dataRows = (await db.execute(`SELECT * FROM ${escapeIdentifier(t.name)};`)) ?? [];
          const sqlRow = (await db.execute(
            `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?;`,
            [t.name],
          )) ?? [];
          tablesData[t.name] = {
            sql: sqlRow[0]?.sql ? String(sqlRow[0].sql) : null,
            rows: dataRows,
          };
        }
        const payload = JSON.stringify({
          version: 1,
          exportedAt: new Date().toISOString(),
          tables: tablesData,
        });
        const encrypted = await encryptBackupData(new TextEncoder().encode(payload), passphrase);
        return reply(
          jsonResponse({
            filename: `local-lite-backup-${new Date().toISOString().slice(0, 10)}.localbackup`,
            sizeBytes: encrypted.byteLength,
            tableCount: Object.keys(tablesData).length,
            dataBase64: Buffer.from(encrypted).toString('base64'),
          }),
          `Exported ${Object.keys(tablesData).length} tables`,
        );
      }

      if (pathname === '/api/backups/restore' && request.method === 'POST') {
        if (readOnly) return reply(errorResponse('Dashboard is in read-only mode.', 403));
        const body = (await request.json().catch(() => null)) as {
          passphrase?: string;
          dataBase64?: string;
        } | null;
        const passphrase = typeof body?.passphrase === 'string' ? body.passphrase : '';
        const dataBase64 = typeof body?.dataBase64 === 'string' ? body.dataBase64 : '';
        if (!passphrase || !dataBase64) {
          return reply(errorResponse('Passphrase and backup data are required.', 400));
        }
        const encryptedBytes = new Uint8Array(Buffer.from(dataBase64, 'base64'));
        let decryptedBytes: Uint8Array;
        try {
          decryptedBytes = await decryptBackupData(encryptedBytes, passphrase);
        } catch {
          return reply(errorResponse('Failed to decrypt backup. Check passphrase or file integrity.', 400));
        }
        const snapshot = JSON.parse(new TextDecoder().decode(decryptedBytes)) as {
          version: number;
          tables: Record<string, { sql: string | null; rows: Record<string, unknown>[] }>;
        };
        if (!snapshot?.tables || typeof snapshot.tables !== 'object') {
          return reply(errorResponse('Invalid backup payload.', 400));
        }
        let restoredTables = 0;
        let restoredRows = 0;
        const fkRes = (await db.execute(`PRAGMA foreign_keys;`)) ?? [];
        const prevFk = Number(fkRes[0]?.foreign_keys ?? 0) === 1;
        if (prevFk) {
          await db.execute(`PRAGMA foreign_keys = OFF;`);
        }
        await db.execute(`BEGIN IMMEDIATE;`);
        try {
          for (const [tableName, tableEntry] of Object.entries(snapshot.tables)) {
            if (tableEntry.sql) {
              const createSql = tableEntry.sql.replace(/^CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
              await db.execute(createSql);
            }
            const quoted = escapeIdentifier(tableName);
            await db.execute(`DELETE FROM ${quoted};`);
            for (const row of tableEntry.rows ?? []) {
              const keys = Object.keys(row);
              if (keys.length === 0) continue;
              const colsSql = keys.map((k) => escapeIdentifier(k)).join(', ');
              const placeholders = keys.map(() => '?').join(', ');
              await db.execute(
                `INSERT INTO ${quoted} (${colsSql}) VALUES (${placeholders});`,
                keys.map((k) => row[k]),
              );
              restoredRows++;
            }
            restoredTables++;
          }
          await db.execute(`COMMIT;`);
        } catch (restoreErr) {
          try {
            await db.execute(`ROLLBACK;`);
          } catch {
            // ignore rollback error
          }
          throw restoreErr;
        } finally {
          if (prevFk) {
            await db.execute(`PRAGMA foreign_keys = ON;`);
          }
        }
        return reply(
          jsonResponse({ ok: true, restoredTables, restoredRows }),
          `Restored ${restoredTables} tables (${restoredRows} rows)`,
        );
      }

      return reply(errorResponse('Not found.', 404));
    } catch (err: any) {
      return reply(errorResponse(err?.message ?? 'Internal server error.', 500), err?.message);
    }
    })();

    if (!loggedThisRequest && pathname.startsWith('/api/')) {
      recordLog(request.method, pathname, res.status, startedAt);
    }
    return res;
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
