import { describe, it, expect, beforeEach } from 'vitest';
import { createSyncClient } from '../src/config/index.js';
import { MockDB } from './helpers/mock-db.js';
import {
  createSyncEndpoint,
  MemoryServerSyncStorage,
} from '../src/server/sync.js';
import { createServer, defineServerConfig } from '../src/server/index.js';

describe('Turnkey Self-Hosted Sync Backend & Client Adapter', () => {
  let serverStorage: MemoryServerSyncStorage;
  let serverInstance: any;

  // Mock server fetch dispatcher
  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const req = new Request(url, init);
    return await serverInstance.fetch(req);
  };

  beforeEach(() => {
    serverStorage = new MemoryServerSyncStorage();

    const serverDef = defineServerConfig({
      config: {},
      endpoints: {
        '/api/sync': createSyncEndpoint({
          storage: serverStorage,
          secret: 'test-sync-secret-123',
        }),
      },
    });

    serverInstance = createServer(serverDef);
  });

  it('rejects unauthorized requests without valid secret token', async () => {
    const req = new Request('http://localhost:3000/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: [] }),
    });

    const res = await serverInstance.fetch(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain('Unauthorized');
  });

  it('synchronizes data across two independent clients via the self-hosted backend', async () => {
    const db1 = new MockDB();
    const db2 = new MockDB();

    const client1 = await createSyncClient({
      database: db1,
      tables: ['tasks'],
      server: {
        url: 'http://localhost:3000/api/sync',
        token: 'test-sync-secret-123',
      },
      autoStart: false,
    });
    // Override fetch to route to in-memory server
    (client1 as any).remote.fetchFn = mockFetch;

    const client2 = await createSyncClient({
      database: db2,
      tables: ['tasks'],
      server: {
        url: 'http://localhost:3000/api/sync',
        token: 'test-sync-secret-123',
      },
      autoStart: false,
    });
    (client2 as any).remote.fetchFn = mockFetch;

    // 1. Client 1 inserts a task locally (0ms offline write)
    await client1.insert('tasks', {
      id: 'task-100',
      title: 'Self-hosted Sync Rocks',
      done: false,
    });

    // 2. Client 1 pushes to self-hosted server
    await client1.syncWorker.pushLocalChanges();

    // 3. Client 2 pulls from self-hosted server
    await client2.syncWorker.pullRemoteChanges();

    // Verify task exists in Client 2's local SQLite database
    const client2Row = await db2.getTable('tasks').get('task-100');
    expect(client2Row).toBeDefined();
    expect(client2Row.title).toBe('Self-hosted Sync Rocks');

    client1.stop();
    client2.stop();
  });

  it('handles updates and soft deletes through the self-hosted backend', async () => {
    const db1 = new MockDB();
    const db2 = new MockDB();

    const client1 = await createSyncClient({
      database: db1,
      tables: ['notes'],
      server: {
        url: 'http://localhost:3000/api/sync',
        token: 'test-sync-secret-123',
      },
      autoStart: false,
    });
    (client1 as any).remote.fetchFn = mockFetch;

    const client2 = await createSyncClient({
      database: db2,
      tables: ['notes'],
      server: {
        url: 'http://localhost:3000/api/sync',
        token: 'test-sync-secret-123',
      },
      autoStart: false,
    });
    (client2 as any).remote.fetchFn = mockFetch;

    // Insert note
    await client1.insert('notes', { id: 'note-1', content: 'Initial note' });
    await client1.syncWorker.pushLocalChanges();
    await client2.syncWorker.pullRemoteChanges();

    // Update note on Client 1
    await client1.update('notes', 'note-1', { content: 'Updated note' });
    await client1.syncWorker.pushLocalChanges();
    await client2.syncWorker.pullRemoteChanges();

    let client2Row = await db2.getTable('notes').get('note-1');
    expect(client2Row).toBeDefined();
    expect(client2Row.content).toBe('Updated note');

    // Delete note on Client 1
    await client1.delete('notes', 'note-1');
    await client1.syncWorker.pushLocalChanges();
    await client2.syncWorker.pullRemoteChanges();

    client2Row = await db2.getTable('notes').get('note-1');
    expect(client2Row).toBeUndefined();

    client1.stop();
    client2.stop();
  });

  it('supports remote RPC function calls via adapter.call()', async () => {
    const serverDef = defineServerConfig({
      config: {},
      endpoints: {
        '/api/sync/email': {
          POST: async ({ request }) => {
            const body = await request.json();
            return Response.json({
              success: true,
              messageId: 'msg-123',
              to: body.to,
            });
          },
        },
      },
    });
    const rpcServer = createServer(serverDef);

    const client = await createSyncClient({
      database: new MockDB(),
      tables: ['tasks'],
      server: {
        url: 'http://localhost:3000/api/sync',
        token: 'test-token',
      },
      autoStart: false,
    });
    (client as any).remote.fetchFn = async (input: any, init: any) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const req = new Request(url, init);
      return await rpcServer.fetch(req);
    };

    const result = await client.call('email', { to: 'tenant@example.com' });
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-123');
    expect(result.to).toBe('tenant@example.com');

    client.stop();
  });

  it('supports custom async authHandler and onBeforePull on createSyncEndpoint', async () => {
    const authEndpoint = createSyncEndpoint({
      storage: serverStorage,
      authHandler: async (req) => {
        const auth = req.headers.get('authorization');
        if (auth === 'Bearer valid-jwt-token') {
          return { id: 'user-1', allowedTables: ['notes'] };
        }
        return false;
      },
      onBeforePull: async (tables, _since, _limit, _req, auth) => {
        return {
          tables: tables.filter((t) => auth?.allowedTables?.includes(t)),
        };
      },
    });

    const customServer = createServer(
      defineServerConfig({
        config: {},
        endpoints: {
          '/api/sync': authEndpoint,
        },
      }),
    );

    // 1. Unauthenticated request -> 401
    const unauthRes = await customServer.fetch(
      new Request('http://localhost:3000/api/sync?tables=notes', {
        headers: { Authorization: 'Bearer invalid-token' },
      }),
    );
    expect(unauthRes.status).toBe(401);

    // 2. Authenticated request -> 200 with scoped pull
    const authRes = await customServer.fetch(
      new Request('http://localhost:3000/api/sync?tables=notes,secrets', {
        headers: { Authorization: 'Bearer valid-jwt-token' },
      }),
    );
    expect(authRes.status).toBe(200);
    const data = await authRes.json();
    expect(data.success).toBe(true);
  });
});
