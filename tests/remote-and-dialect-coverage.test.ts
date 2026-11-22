import { describe, expect, it, vi } from 'vitest';
import { SelfHostedRemoteAdapter } from '../src/adapters/remote/self-hosted.js';
import {
  adaptSqlForPostgres,
  buildUpsertSql,
  quoteIdent,
  rewriteSqlTokensForPostgres,
} from '../src/server/sqlDialect.js';

describe('SQL dialect & SelfHostedRemoteAdapter coverage', () => {
  it('handles MySQL and Postgres quoting, upsert SQL, token rewriting, and DDL adaptation', () => {
    expect(quoteIdent('users', 'mysql')).toBe('`users`');
    expect(quoteIdent('users', 'postgres')).toBe('"users"');

    expect(
      buildUpsertSql({
        table: 'todos',
        conflictCols: ['id'],
        insertCols: ['id', 'title'],
        updateCols: ['title'],
        dialect: 'mysql',
      }),
    ).toContain('ON DUPLICATE KEY UPDATE `title` = VALUES(`title`)');

    expect(
      buildUpsertSql({
        table: 'todos',
        conflictCols: ['id'],
        insertCols: ['id'],
        updateCols: [],
        dialect: 'mysql',
      }),
    ).toBe('INSERT IGNORE INTO `todos` (`id`) VALUES (?)');

    expect(
      buildUpsertSql({
        table: 'todos',
        conflictCols: ['id'],
        insertCols: ['id', 'title'],
        updateCols: ['title'],
        dialect: 'postgres',
      }),
    ).toContain('ON CONFLICT ("id") DO UPDATE SET "title" = EXCLUDED."title"');

    expect(
      buildUpsertSql({
        table: 'todos',
        conflictCols: ['id'],
        insertCols: ['id'],
        updateCols: [],
        dialect: 'postgres',
      }),
    ).toBe('INSERT INTO "todos" ("id") VALUES (?) ON CONFLICT ("id") DO NOTHING');

    expect(
      rewriteSqlTokensForPostgres("SELECT `id` FROM `t` WHERE a = '?' AND b = ?"),
    ).toBe('SELECT "id" FROM "t" WHERE a = \'?\' AND b = $1');

    expect(adaptSqlForPostgres('')).toEqual([]);
    expect(adaptSqlForPostgres('-- comment only')).toEqual([]);
    expect(
      adaptSqlForPostgres(
        'CREATE TABLE `t` (`id` INT AUTO_INCREMENT PRIMARY KEY, `ok` TINYINT(1), `body` LONGTEXT, `sub` MEDIUMTEXT, `score` DOUBLE, `st` ENUM(\'a\',\'b\')) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
      )[0],
    ).toContain('SERIAL PRIMARY KEY');
    expect(
      adaptSqlForPostgres('INSERT IGNORE INTO `t` (`id`) VALUES (1);')[0],
    ).toContain('ON CONFLICT DO NOTHING');
    expect(
      adaptSqlForPostgres('ALTER TABLE `t` ADD UNIQUE INDEX `idx_u` (`email`);')[0],
    ).toBe('CREATE UNIQUE INDEX IF NOT EXISTS "t_idx_u" ON "t" ("email")');
  });

  it('supports SelfHostedRemoteAdapter WebSocket, SSE, scope, and RPC calls', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('?tables=')) {
        return Response.json({
          cursor: 200,
          changes: {
            timestamp: 200,
            changes: [{ tableName: 'todos', rowId: '1', operation: 'INSERT', payload: { id: '1' }, timestamp: 200 }],
          },
        });
      }
      if (url.includes('/backups')) {
        return Response.json({ backups: [] });
      }
      if (url.includes('/fail')) {
        return new Response('Boom', { status: 500 });
      }
      return Response.json({ ok: true });
    });

    const sockets: MockWS[] = [];
    class MockWS {
      onmessage?: (ev: MessageEvent) => void;
      onclose?: () => void;
      closed = false;
      constructor(public url: string) {
        sockets.push(this);
      }
      close() {
        this.closed = true;
      }
    }

    const sources: MockES[] = [];
    class MockES {
      onmessage?: () => void;
      onerror?: () => void;
      closed = false;
      constructor(public url: string) {
        sources.push(this);
      }
      close() {
        this.closed = true;
      }
    }

    const wsAdapter = new SelfHostedRemoteAdapter({
      url: 'https://sync.example.com',
      token: 'tok_1',
      wsUrl: 'wss://sync.example.com/ws',
      fetch: fetchMock as unknown as typeof fetch,
      WebSocketImpl: MockWS as unknown as typeof WebSocket,
    });

    const wsEvents: unknown[] = [];
    const unsubWs = wsAdapter.subscribeToLiveChanges((d) => wsEvents.push(d));
    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        changes: { timestamp: 123, changes: [] },
      }),
    } as MessageEvent);
    expect(wsEvents).toHaveLength(1);
    sockets[0]?.onclose?.();
    unsubWs();

    const sseAdapter = new SelfHostedRemoteAdapter({
      url: 'https://sync.example.com',
      token: 'tok_1',
      sseUrl: 'https://sync.example.com/events',
      fetch: fetchMock as unknown as typeof fetch,
      EventSourceImpl: MockES as unknown as typeof EventSource,
    });

    const sseEvents: unknown[] = [];
    const unsubSse = sseAdapter.subscribeToLiveChanges((d) => sseEvents.push(d));
    sources[0]?.onmessage?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(sseEvents).toHaveLength(1);
    sources[0]?.onerror?.();
    unsubSse();

    wsAdapter.setSyncScope({ orgId: 'org_1' });
    expect(await wsAdapter.call('backups/list')).toEqual([]);
    expect(await wsAdapter.call('email:send', { to: 'a@b.com' })).toEqual({ ok: true });
    await expect(wsAdapter.call('fail')).rejects.toThrow();
  });
});
