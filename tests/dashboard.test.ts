import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';
import { createDashboardHandler } from '../src/server/index.js';

describe('Dashboard Handler (src/server/dashboard.ts)', () => {
  let raw: DatabaseSync;
  let db: NodeSQLiteAdapter;

  beforeEach(async () => {
    raw = new DatabaseSync(':memory:');
    db = new NodeSQLiteAdapter(raw);
    await db.execute(
      `CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER DEFAULT 0);`,
    );
    await db.execute(
      `INSERT INTO todos (id, title, done) VALUES ('1', 'Write docs', 0), ('2', 'Ship dashboard', 1);`,
    );
    await db.execute(
      `CREATE TABLE _local_kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, type TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER);`,
    );
    await db.execute(
      `INSERT INTO _local_kv_store (key, value, type, created_at, updated_at, expires_at) VALUES ('theme', 'dark', 'string', 1000, 1000, NULL);`,
    );
  });

  afterEach(() => {
    raw.close();
  });

  it('serves the HTML dashboard UI on GET /', async () => {
    const handler = createDashboardHandler(db, { title: 'Test Dash' });
    const res = await handler(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Test Dash');
  });

  it('lists tables, overview, and system tables', async () => {
    const handler = createDashboardHandler(db);

    const overviewRes = await handler(
      new Request('http://localhost/api/overview'),
    );
    expect(overviewRes.status).toBe(200);
    const overview = await overviewRes.json();
    expect(overview.dataTableCount).toBe(1);
    expect(overview.systemTableCount).toBe(1);
    expect(overview.totalDataRows).toBe(2);

    const tablesRes = await handler(new Request('http://localhost/api/tables'));
    const tablesBody = await tablesRes.json();
    expect(tablesBody.tables.map((t: any) => t.name)).toEqual([
      '_local_kv_store',
      'todos',
    ]);

    const sysRes = await handler(new Request('http://localhost/api/system'));
    const sysBody = await sysRes.json();
    expect(sysBody.kvStore).toHaveLength(1);
    expect(sysBody.outbox).toBeNull();
  });

  it('supports querying, inserting, updating, and deleting table rows', async () => {
    const handler = createDashboardHandler(db);

    const searchRes = await handler(
      new Request('http://localhost/api/tables/todos/rows?search=Ship'),
    );
    const searchBody = await searchRes.json();
    expect(searchBody.total).toBe(1);
    expect(searchBody.rows[0].id).toBe('2');

    const insertRes = await handler(
      new Request('http://localhost/api/tables/todos/rows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: '3', title: 'Test CRUD', done: 0 }),
      }),
    );
    expect(insertRes.status).toBe(201);

    const patchRes = await handler(
      new Request('http://localhost/api/tables/todos/rows', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: { id: '3' }, updates: { done: 1 } }),
      }),
    );
    expect(patchRes.status).toBe(200);

    const queryRes = await handler(
      new Request('http://localhost/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: `SELECT done FROM todos WHERE id = ?`,
          params: ['3'],
        }),
      }),
    );
    const queryBody = await queryRes.json();
    expect(queryBody.rows[0].done).toBe(1);

    const delRes = await handler(
      new Request('http://localhost/api/tables/todos/rows', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: { id: '3' } }),
      }),
    );
    expect(delRes.status).toBe(200);

    const csvRes = await handler(
      new Request('http://localhost/api/tables/todos/export?format=csv'),
    );
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get('content-type')).toContain('text/csv');
    const csvText = await csvRes.text();
    expect(csvText).toContain('id,title,done');
    expect(csvText).toContain('Write docs');
  });

  it('enforces readOnly mode and authToken', async () => {
    const handler = createDashboardHandler(db, {
      readOnly: true,
      authToken: 'secret-123',
    });

    const unauth = await handler(new Request('http://localhost/api/overview'));
    expect(unauth.status).toBe(401);

    const authOk = await handler(
      new Request('http://localhost/api/overview', {
        headers: { Authorization: 'Bearer secret-123' },
      }),
    );
    expect(authOk.status).toBe(200);

    const blockedInsert = await handler(
      new Request('http://localhost/api/tables/todos/rows?token=secret-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: '9', title: 'Blocked' }),
      }),
    );
    expect(blockedInsert.status).toBe(403);

    const blockedSql = await handler(
      new Request('http://localhost/api/query?token=secret-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: `DELETE FROM todos;` }),
      }),
    );
    expect(blockedSql.status).toBe(403);
  });

  it('supports settings, pragmas, maintenance, export, and kv-store management', async () => {
    const handler = createDashboardHandler(db, { title: 'Settings Dash' });

    const settingsRes = await handler(new Request('http://localhost/api/settings'));
    expect(settingsRes.status).toBe(200);
    const settings = await settingsRes.json();
    expect(settings.dashboard.title).toBe('Settings Dash');
    expect(settings.pragmas.journalMode).toBeDefined();
    expect(settings.kvStore.exists).toBe(true);
    expect(settings.kvStore.entries).toHaveLength(1);

    const pragmaRes = await handler(
      new Request('http://localhost/api/settings/pragma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pragma: 'busy_timeout', value: 2500 }),
      }),
    );
    expect(pragmaRes.status).toBe(200);

    const integrityRes = await handler(
      new Request('http://localhost/api/settings/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'integrity_check' }),
      }),
    );
    expect(integrityRes.status).toBe(200);
    const integrity = await integrityRes.json();
    expect(integrity.ok).toBe(true);

    const kvSetRes = await handler(
      new Request('http://localhost/api/kv-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'maxRetries', type: 'number', value: '5' }),
      }),
    );
    expect(kvSetRes.status).toBe(200);

    const kvDelRes = await handler(
      new Request('http://localhost/api/kv-store', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'maxRetries' }),
      }),
    );
    expect(kvDelRes.status).toBe(200);

    const exportRes = await handler(
      new Request('http://localhost/api/settings/export'),
    );
    expect(exportRes.status).toBe(200);
    const exported = await exportRes.json();
    expect(exported.tables.todos).toHaveLength(2);
  });

  it('supports table DDL, JSON import, indexes, files, auth-admin, and jobs endpoints', async () => {
    const handler = createDashboardHandler(db);

    const createTableRes = await handler(
      new Request('http://localhost/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'projects',
          columns: [
            { name: 'id', type: 'TEXT', pk: true, notnull: true },
            { name: 'name', type: 'TEXT', pk: false, notnull: true },
          ],
        }),
      }),
    );
    expect(createTableRes.status).toBe(201);

    const importRes = await handler(
      new Request('http://localhost/api/tables/projects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: [
            { id: 'p1', name: 'Alpha' },
            { id: 'p2', name: 'Beta' },
          ],
        }),
      }),
    );
    expect(importRes.status).toBe(200);
    expect((await importRes.json()).imported).toBe(2);

    const createIdxRes = await handler(
      new Request('http://localhost/api/tables/projects/indexes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'idx_projects_name',
          columns: ['name'],
          unique: true,
        }),
      }),
    );
    expect(createIdxRes.status).toBe(201);

    const addColRes = await handler(
      new Request('http://localhost/api/tables/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addColumn: { name: 'status', type: 'TEXT', notnull: true, defaultValue: 'active' },
        }),
      }),
    );
    expect(addColRes.status).toBe(200);

    const renameRes = await handler(
      new Request('http://localhost/api/tables/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: 'projects_v2' }),
      }),
    );
    expect(renameRes.status).toBe(200);

    const renameBackRes = await handler(
      new Request('http://localhost/api/tables/projects_v2', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: 'projects' }),
      }),
    );
    expect(renameBackRes.status).toBe(200);

    const dropIdxRes = await handler(
      new Request(
        'http://localhost/api/tables/projects/indexes/idx_projects_name',
        { method: 'DELETE' },
      ),
    );
    expect(dropIdxRes.status).toBe(200);

    const clearRes = await handler(
      new Request('http://localhost/api/tables/projects/clear', {
        method: 'POST',
      }),
    );
    expect(clearRes.status).toBe(200);

    const dropRes = await handler(
      new Request('http://localhost/api/tables/projects', { method: 'DELETE' }),
    );
    expect(dropRes.status).toBe(200);

    expect((await handler(new Request('http://localhost/api/files'))).status).toBe(200);
    expect((await handler(new Request('http://localhost/api/auth-admin'))).status).toBe(200);
    expect((await handler(new Request('http://localhost/api/jobs'))).status).toBe(200);

    const sqlRes = await handler(
      new Request('http://localhost/api/schema/sql?dialect=postgres'),
    );
    expect(sqlRes.status).toBe(200);
    const sqlBody = await sqlRes.json();
    expect(sqlBody.sql).toContain('CREATE TABLE IF NOT EXISTS "todos"');
  });

  it('supports logs, seeding, schema diff, FTS5 search, encrypted backups, and outbox delete', async () => {
    raw.exec(`
      CREATE TABLE authors (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author_id TEXT REFERENCES authors(id)
      );
      INSERT INTO authors (id, name) VALUES ('a1', 'Ada Lovelace');
      INSERT INTO books (id, title, author_id) VALUES ('b1', 'Analytical Engine Notes', 'a1');
      CREATE TABLE sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT,
        operation TEXT,
        status TEXT,
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        payload TEXT
      );
      INSERT INTO sync_outbox (table_name, operation, status, payload)
      VALUES ('books', 'insert', 'failed', '{"after":{"id":"b1"}}');
    `);
    const handler = createDashboardHandler(db);

    // 1. Foreign keys in /api/tables
    const tablesRes = await handler(new Request('http://local.test/api/tables'));
    expect(tablesRes.status).toBe(200);
    const tablesBody = await tablesRes.json();
    const booksMeta = tablesBody.tables.find((t: any) => t.name === 'books');
    expect(booksMeta.foreignKeys).toEqual([
      { table: 'authors', from: 'author_id', to: 'id' },
    ]);

    // 2. Seed sample rows
    const seedRes = await handler(
      new Request('http://local.test/api/tables/books/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ count: 3 }),
      }),
    );
    expect(seedRes.status).toBe(200);
    const seedBody = await seedRes.json();
    expect(seedBody.inserted).toBe(3);

    // 3. Schema diff
    const diffRes = await handler(
      new Request('http://local.test/api/schema/diff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetSql: 'CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL, isbn TEXT);',
        }),
      }),
    );
    expect(diffRes.status).toBe(200);
    const diffBody = await diffRes.json();
    expect(diffBody.sql).toContain('ALTER TABLE "books" ADD COLUMN "isbn" TEXT;');

    // 4. FTS5 index + search
    const ftsCreateRes = await handler(
      new Request('http://local.test/api/search/index', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ table: 'books' }),
      }),
    );
    expect(ftsCreateRes.status).toBe(201);
    const ftsListRes = await handler(new Request('http://local.test/api/search/indexes'));
    const ftsListBody = await ftsListRes.json();
    expect(ftsListBody.indexes.length).toBe(1);
    const ftsSearchRes = await handler(
      new Request('http://local.test/api/search?table=books&q=Analytical'),
    );
    expect(ftsSearchRes.status).toBe(200);
    const ftsSearchBody = await ftsSearchRes.json();
    expect(ftsSearchBody.rows.length).toBeGreaterThanOrEqual(1);

    // 5. Encrypted backup & restore
    const exportRes = await handler(
      new Request('http://local.test/api/backups/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passphrase: 'secret-passphrase' }),
      }),
    );
    expect(exportRes.status).toBe(200);
    const exportBody = await exportRes.json();
    expect(exportBody.dataBase64).toBeTruthy();

    await db.execute('DELETE FROM books;');
    const restoreRes = await handler(
      new Request('http://local.test/api/backups/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          passphrase: 'secret-passphrase',
          dataBase64: exportBody.dataBase64,
        }),
      }),
    );
    expect(restoreRes.status).toBe(200);
    const restoreBody = await restoreRes.json();
    expect(restoreBody.restoredRows).toBeGreaterThanOrEqual(4);

    // 6. Outbox delete
    const outboxDelRes = await handler(
      new Request('http://local.test/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete_outbox', id: 1 }),
      }),
    );
    expect(outboxDelRes.status).toBe(200);

    // 7. Logs GET + DELETE (triggered by /api/query above or explicit /api/query)
    await handler(
      new Request('http://local.test/api/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT COUNT(*) AS cnt FROM books;' }),
      }),
    );
    const logsRes = await handler(new Request('http://local.test/api/logs'));
    expect(logsRes.status).toBe(200);
    const logsBody = await logsRes.json();
    expect(logsBody.logs.length).toBeGreaterThan(0);

    const clearLogsRes = await handler(
      new Request('http://local.test/api/logs', { method: 'DELETE' }),
    );
    expect(clearLogsRes.status).toBe(200);
  });
});
