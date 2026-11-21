import { describe, expect, it, vi } from 'vitest';
import {
  adaptSqlForPostgres,
  buildUpsertSql,
  claimScheduledJob,
  createServerCronRunner,
  createSyncEventBroker,
  createSyncEventsHandler,
  rewriteSqlTokensForPostgres,
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
      new Request('http://localhost/sync/events?businessId=b1', {
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
});
