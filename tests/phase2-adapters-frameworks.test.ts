import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { LocalFirstClient } from '../src/core/client.js';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { SqliteWasmAdapter } from '../src/adapters/local/sqlite-wasm.js';
import { PostgresRemoteAdapter } from '../src/adapters/remote/postgres.js';
import { SelfHostedRemoteAdapter } from '../src/adapters/remote/self-hosted.js';
import { liveQuery as svelteLiveQuery } from '../src/svelte/index.js';
import { useLiveQuery as vueUseLiveQuery } from '../src/vue/index.js';
import { createLiveQuery as solidCreateLiveQuery } from '../src/solid/index.js';

describe('Phase 2: Adapters & Framework Bindings', () => {
  it('SqliteWasmAdapter executes queries and serializes transactions', async () => {
    const calls: Array<{ sql: string; bind?: any[] }> = [];
    const mockWasmDb = {
      exec: (opts: any) => {
        calls.push({ sql: opts.sql, bind: opts.bind });
        if (opts.sql.startsWith('SELECT')) {
          return [{ id: '1', name: 'OPFS Row' }];
        }
        return [];
      },
      close: vi.fn(),
    };

    const adapter = new SqliteWasmAdapter(mockWasmDb as any);
    const rows = await adapter.execute('SELECT * FROM notes WHERE id = ?', ['1']);
    expect(rows).toEqual([{ id: '1', name: 'OPFS Row' }]);

    await adapter.transaction(async (tx) => {
      await tx.execute('INSERT INTO notes (id) VALUES (?)', ['2']);
    });

    expect(calls.map((c) => c.sql)).toEqual([
      'SELECT * FROM notes WHERE id = ?',
      'BEGIN IMMEDIATE',
      'INSERT INTO notes (id) VALUES (?)',
      'COMMIT',
    ]);

    adapter.close();
    expect(mockWasmDb.close).toHaveBeenCalledOnce();
  });

  it('PostgresRemoteAdapter pushes upserts/deletes and pulls scoped deltas', async () => {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const adapter = new PostgresRemoteAdapter({
      tables: ['todos'],
      executor: {
        async query(sql, params = []) {
          queries.push({ sql, params });
          if (sql.startsWith('SELECT')) {
            return { rows: [{ id: 't1', title: 'Remote Todo', updated_at: 200 }] };
          }
          return { rows: [] };
        },
      },
    });

    const pushRes = await adapter.pushChanges([
      {
        id: 'op1',
        tableName: 'todos',
        rowId: 't1',
        operation: 'INSERT',
        timestamp: 100,
        payload: { title: 'Hello' },
      },
      {
        id: 'op2',
        tableName: 'todos',
        rowId: 't2',
        operation: 'DELETE',
        timestamp: 150,
        payload: null,
      },
    ]);

    expect(pushRes.success).toBe(true);
    expect(pushRes.successfulIds).toEqual(['op1', 'op2']);
    expect(queries[0].sql).toContain('ON CONFLICT ("id") DO UPDATE SET');
    expect(queries[1].sql).toContain('SET "deleted" = true');

    const deltas = await adapter.fetchChanges(50, { workspace_id: 'ws-1' });
    expect(deltas.changes).toHaveLength(1);
    expect(deltas.changes[0].rowId).toBe('t1');
    expect(queries[2].sql).toContain('"updated_at" > $1 AND "workspace_id" = $2');
    expect(queries[2].params).toEqual([50, 'ws-1']);
  });

  it('SelfHostedRemoteAdapter uses WebSocket when wsUrl is provided', () => {
    const sockets: any[] = [];
    class MockWebSocket {
      url: string;
      onmessage: ((e: any) => void) | null = null;
      onclose: (() => void) | null = null;
      closed = false;
      constructor(url: string) {
        this.url = url;
        sockets.push(this);
      }
      close() {
        this.closed = true;
      }
    }

    const adapter = new SelfHostedRemoteAdapter({
      url: 'https://sync.example.com',
      wsUrl: 'wss://sync.example.com/ws',
      token: 'secret-tok',
      fetch: vi.fn() as any,
      WebSocketImpl: MockWebSocket as any,
    });

    const received: any[] = [];
    const unsub = adapter.subscribeToLiveChanges((changes) => {
      received.push(changes);
    });

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('wss://sync.example.com/ws?token=secret-tok');

    sockets[0].onmessage({ data: JSON.stringify({ todos: [{ id: '1' }] }) });
    expect(received).toEqual([{ todos: [{ id: '1' }] }]);

    unsub();
    expect(sockets[0].closed).toBe(true);
  });

  it('Svelte, Vue, and Solid bindings react to table mutations', async () => {
    const raw = new DatabaseSync(':memory:');
    const db = new NodeSQLiteAdapter(raw);
    const client = new LocalFirstClient({
      local: db,
      remote: new MemoryDemoRemoteAdapter(0),
      network: new DefaultNetworkStatusProvider(false),
      autoSchema: true,
      tables: ['notes'],
      autoStart: false,
      logger: false,
    });
    await client.initialize();
    await client.insert('notes', { id: 'n1', body: 'First' });

    // Svelte store
    const svelteSnapshots: any[] = [];
    const store = svelteLiveQuery(client, 'notes');
    const unsubSvelte = store.subscribe((val) => svelteSnapshots.push(val));

    // Vue composable
    const vueCleanups: Array<() => void> = [];
    const vueState = vueUseLiveQuery(client, 'notes', undefined, {
      ref: (v) => ({ value: v }),
      onUnmounted: (fn) => vueCleanups.push(fn),
    });

    // Solid signal
    const solidCleanups: Array<() => void> = [];
    const solidState = solidCreateLiveQuery(client, 'notes', undefined, {
      createSignal: <T,>(initial: T) => {
        let val = initial;
        return [() => val, (next: T) => { val = next; }];
      },
      onCleanup: (fn) => solidCleanups.push(fn),
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(svelteSnapshots.at(-1).data).toHaveLength(1);
    expect(vueState.data.value).toHaveLength(1);
    expect(solidState.data()).toHaveLength(1);

    await client.insert('notes', { id: 'n2', body: 'Second' });
    await new Promise((r) => setTimeout(r, 30));
    expect(svelteSnapshots.at(-1).data).toHaveLength(2);
    expect(vueState.data.value).toHaveLength(2);
    expect(solidState.data()).toHaveLength(2);

    unsubSvelte();
    vueCleanups.forEach((fn) => fn());
    solidCleanups.forEach((fn) => fn());
  });
});
