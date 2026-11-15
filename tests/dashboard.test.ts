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
    expect(html).toContain('/api/tables');
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
});
