import { describe, expect, it, vi } from 'vitest';
import { createPaymentRegistry } from '../src/payments/registry.js';
import {
  createPaymentServerHandler,
  createSqlPaymentStore,
} from '../src/payments/server.js';
import {
  adaptSqlForPostgres,
  buildUpsertSql,
  claimScheduledJob,
  createServer,
  createServerCronRunner,
  createSyncEventBroker,
  createSyncEventsHandler,
  rewriteSqlTokensForPostgres,
  SqlServerSyncStorage,
  type SqlExecutor,
} from '../src/server/index.js';

describe('local-lite server SQL dialect, SSE events & scheduler', () => {
  it('builds MySQL and PostgreSQL upsert SQL and rewrites PG placeholders', () => {
    expect(
      buildUpsertSql({
        table: '_storage_files',
        conflictCols: ['storage_key'],
        insertCols: ['id', 'storage_key', 'name'],
        updateCols: ['name'],
        dialect: 'mysql',
      }),
    ).toBe(
      'INSERT INTO `_storage_files` (`id`, `storage_key`, `name`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)',
    );

    expect(
      buildUpsertSql({
        table: '_storage_files',
        conflictCols: ['storage_key'],
        insertCols: ['id', 'storage_key', 'name'],
        updateCols: ['name'],
        dialect: 'postgres',
      }),
    ).toBe(
      'INSERT INTO "_storage_files" ("id", "storage_key", "name") VALUES ($1, $2, $3)'.replace(
        '$1, $2, $3',
        '?, ?, ?',
      ) + ' ON CONFLICT ("storage_key") DO UPDATE SET "name" = EXCLUDED."name"',
    );

    expect(
      rewriteSqlTokensForPostgres(
        "SELECT * FROM `tenants` WHERE `id` = ? AND `note` = '?' AND `deleted` = ?",
      ),
    ).toBe(
      'SELECT * FROM "tenants" WHERE "id" = $1 AND "note" = \'?\' AND "deleted" = $2',
    );

    const adapted = adaptSqlForPostgres(
      'CREATE TABLE IF NOT EXISTS `items` (`id` BIGINT AUTO_INCREMENT PRIMARY KEY, `active` TINYINT(1), INDEX `idx_active` (`active`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    );
    expect(adapted[0]).toContain('BIGSERIAL PRIMARY KEY');
    expect(adapted[0]).toContain('SMALLINT');
    expect(adapted[1]).toBe(
      'CREATE INDEX IF NOT EXISTS "items_idx_active" ON "items" ("active")',
    );
  });

  it('publishes sync events and streams SSE responses', async () => {
    const broker = createSyncEventBroker();
    const handler = createSyncEventsHandler({
      broker,
      authenticate: async (req) =>
        req.headers.get('authorization') === 'Bearer ok',
    });

    const unauth = await handler(
      new Request('http://localhost/sync/events', { method: 'GET' }),
    );
    expect(unauth.status).toBe(401);

    const ac = new AbortController();
    const res = await handler(
      new Request('http://localhost/sync/events?scopeId=b1', {
        method: 'GET',
        headers: { Authorization: 'Bearer ok' },
        signal: ac.signal,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('event: connected');

    broker.publish({ scopeId: 'b2', tableName: 'tenants', checkpoint: 10 });
    broker.publish({ scopeId: 'b1', tableName: 'tenants', checkpoint: 11 });

    const second = await reader.read();
    const text = new TextDecoder().decode(second.value);
    expect(text).toContain('"scopeId":"b1"');
    expect(text).toContain('"checkpoint":11');
    ac.abort();
  });

  it('claims scheduled jobs atomically and manages cron runner lifecycle', async () => {
    const execute = vi.fn(async () => ({ affectedRows: 1 }));
    const executor: SqlExecutor = {
      dialect: 'mysql',
      query: async () => [],
      execute,
      withTransaction: async (fn) => fn(executor),
    };

    const claimed = await claimScheduledJob(
      executor,
      '_admin_cron_schedules',
      'daily_reports',
      10_000,
      3_600,
    );
    expect(claimed).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);

    const runner = createServerCronRunner({
      intervalMs: 1000,
      onTick: async () => {},
    });
    expect(runner.isRunning()).toBe(false);
    runner.start();
    expect(runner.isRunning()).toBe(true);
    runner.stop();
    expect(runner.isRunning()).toBe(false);
  });

  it('supports createServer ALL method, wildcard paths, and middleware on 404/OPTIONS', async () => {
    const server = createServer({
      config: {},
      middleware: [
        async ({ request }, next) => {
          if (request.method === 'OPTIONS') {
            return new Response(null, {
              status: 204,
              headers: { 'Access-Control-Allow-Origin': '*' },
            });
          }
          const res = await next();
          const h = new Headers(res.headers);
          h.set('Access-Control-Allow-Origin', '*');
          return new Response(res.body, { status: res.status, headers: h });
        },
      ],
      endpoints: {
        '/contracts/*': {
          ALL: ({ params }) => Response.json({ rest: params['*'] }),
        },
      },
    });

    const optRes = await server.fetch(
      new Request('http://localhost/contracts/123', { method: 'OPTIONS' }),
    );
    expect(optRes.status).toBe(204);
    expect(optRes.headers.get('access-control-allow-origin')).toBe('*');

    const wildRes = await server.fetch(
      new Request('http://localhost/contracts/123/sign', { method: 'POST' }),
    );
    expect(wildRes.status).toBe(200);
    expect(await wildRes.json()).toEqual({ rest: '123/sign' });

    const notFoundRes = await server.fetch(
      new Request('http://localhost/missing', { method: 'GET' }),
    );
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('supports SqlServerSyncStorage applyOperations and getDeltas with broker', async () => {
    const inserted: any[] = [];
    const executor: SqlExecutor = {
      dialect: 'mysql',
      async query<T = unknown>(sql: string): Promise<T[]> {
        if (sql.includes('_server_sync_clock')) return [{ checkpoint: 50 }] as T[];
        if (sql.includes('COALESCE(MAX')) return [{ checkpoint: 50 }] as T[];
        return inserted.map((row) => ({
          table_name: row[0],
          row_id: row[1],
          payload: row[4],
          operation: row[5],
          ts: row[6],
        })) as T[];
      },
      async execute(sql: string, params: any[] = []) {
        if (sql.includes('INSERT INTO')) inserted.push(params);
        return { affectedRows: 1 };
      },
      async withTransaction(fn) {
        return fn(executor);
      },
    };

    const broker = createSyncEventBroker();
    const events: any[] = [];
    broker.subscribe((e) => events.push(e));

    const storage = new SqlServerSyncStorage(executor, { broker });
    const pushRes = await storage.applyOperations(
      [
        {
          id: 'op1',
          tableName: 'tenants',
          rowId: 't1',
          operation: 'INSERT',
          payload: { scope_id: 'b1', name: 'Alice' },
          timestamp: 100,
        },
      ],
      100,
    );
    expect(pushRes.applied).toBe(1);
    expect(pushRes.cursor).toBe(101);
    expect(events).toEqual([
      {
        scopeId: 'b1',
        tableName: 'tenants',
        checkpoint: 101,
        rowId: 't1',
        op: 'insert',
        changedCols: ['scope_id', 'name'],
      },
    ]);

    const deltas = await storage.getDeltas(['tenants'], 50, 100);
    expect(deltas.changes.changes).toHaveLength(1);
    expect(deltas.cursor).toBe(101);
  });

  it('supports createSqlPaymentStore and /status, /options, /reconcile in createPaymentServerHandler', async () => {
    const rows = new Map<string, any>();
    const executor: SqlExecutor = {
      dialect: 'mysql',
      async query(sql: string, params: any[] = []) {
        if (sql.includes('WHERE action_id = ?')) {
          const r = rows.get(params[0]);
          return r ? [r] : [];
        }
        if (sql.includes('WHERE checkout_id = ?')) {
          for (const r of rows.values()) {
            if (r.checkout_id === params[0] || r.action_id === params[1]) {
              return [r];
            }
          }
          return [];
        }
        return [];
      },
      async execute(sql: string, params: any[] = []) {
        if (sql.startsWith('INSERT INTO')) {
          rows.set(params[0], {
            action_id: params[0],
            user_id: params[1],
            provider: params[2],
            currency: params[3],
            phone: params[4],
            email: params[5],
            amount: params[6],
            callback_hash: params[7],
            status: params[8],
          });
        } else if (sql.includes('SET status = ?, checkout_id = ?')) {
          const r = rows.get(params[3]);
          if (r) {
            r.status = params[0];
            r.checkout_id = params[1];
          }
        } else if (sql.includes('SET status = ?, error = ?')) {
          const r = rows.get(params[2]);
          if (r) {
            r.status = params[0];
            r.error = params[1];
          }
        }
        return { affectedRows: 1 };
      },
      async withTransaction(fn) {
        return fn(executor);
      },
    };

    const store = createSqlPaymentStore(executor);
    await store.reserve({
      actionId: 'a1',
      provider: 'stripe',
      amount: 500,
      currency: 'USD',
      userId: 'u1',
      callbackHash: 'h1',
      status: 'initializing',
    });
    await store.markPending('a1', { providerRef: 'chk_1' });

    const handler = createPaymentServerHandler({
      registry: createPaymentRegistry({ providers: [] }),
      store,
      onReconcile: async (res) =>
        Response.json({ reconciled: res.actionId, status: res.status }),
    });

    const optRes = await handler(
      new Request('http://localhost/payments/options', { method: 'GET' }),
    );
    expect(optRes.status).toBe(200);
    expect(await optRes.json()).toEqual({ options: [] });

    const statusRes = await handler(
      new Request('http://localhost/payments/status?checkoutRequestId=chk_1', {
        method: 'GET',
      }),
    );
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({ status: 'pending', amount: 500 });

    const recRes = await handler(
      new Request('http://localhost/payments/reconcile', {
        method: 'POST',
        body: JSON.stringify({ actionId: 'a1' }),
      }),
    );
    expect(recRes.status).toBe(200);
    expect(await recRes.json()).toEqual({
      reconciled: 'a1',
      status: 'pending',
    });
  });
});
