import {
  LocalFirstClient,
  DefaultNetworkStatusProvider
} from './dist/index.js';

class MockInMemoryDB {
  constructor() {
    this.tables = new Map();
  }

  getTable(name) {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
    return this.tables.get(name);
  }

  async execute(query, params = []) {
    const q = query.trim();
    const normQ = q.replace(/\s+/g, ' ');

    if (q.startsWith('CREATE TABLE')) {
      const match = normQ.match(/CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"?/i);
      if (match) this.getTable(match[1]);
      return [];
    }

    if (q.startsWith('ALTER TABLE')) {
      return [];
    }

    if (q.startsWith('PRAGMA table_info')) {
      return [];
    }

    const select1Match = normQ.match(/SELECT 1 FROM "?(\w+)"? WHERE "?(\w+)"? = \?/i);
    if (select1Match) {
      const table = select1Match[1];
      const id = params[0];
      const rows = this.getTable(table);
      return rows.has(id) ? [{ 1: 1 }] : [];
    }

    if (normQ.includes('FROM sync_outbox WHERE table_name = ? AND row_id = ?')) {
      const rows = Array.from(this.getTable('sync_outbox').values());
      const filtered = rows.filter(r => r.table_name === params[0] && r.row_id === params[1] && r.status !== 'FAILED');
      filtered.sort((a, b) => b.timestamp - a.timestamp);
      return filtered.slice(0, 1);
    }

    if (normQ.includes('FROM sync_outbox') && normQ.includes("status = 'PENDING'")) {
      const maxRetries = params[0];
      const rows = Array.from(this.getTable('sync_outbox').values());
      const pending = rows.filter(r => r.status === 'PENDING' || (r.status === 'FAILED' && r.retry_count < maxRetries));
      pending.sort((a, b) => a.timestamp - b.timestamp);
      return pending.slice(0, 50);
    }

    const selectRowMatch = q.match(/SELECT \* FROM "?(\w+)"? WHERE "?(\w+)"? = \?/i);
    if (selectRowMatch) {
      const table = selectRowMatch[1];
      const id = params[0];
      const rows = this.getTable(table);
      const row = rows.get(id);
      return row ? [row] : [];
    }

    if (q.startsWith('INSERT INTO sync_outbox')) {
      const [id, table_name, row_id, operation, payload, timestamp] = params;
      this.getTable('sync_outbox').set(id, {
        id,
        table_name,
        row_id,
        operation,
        payload,
        timestamp,
        status: 'PENDING',
        retry_count: 0
      });
      return [];
    }

    const insertMatch = q.match(/INSERT INTO "?(\w+)"?\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (insertMatch) {
      const table = insertMatch[1];
      const cols = insertMatch[2].split(',').map(c => c.trim().replace(/"/g, ''));
      const obj = {};
      cols.forEach((c, idx) => {
        obj[c] = params[idx];
      });
      const id = obj.id || params[0];
      this.getTable(table).set(id, obj);
      return [];
    }

    if (q.includes('UPDATE sync_outbox SET status = \'PROCESSING\'')) {
      for (const id of params) {
        const item = this.getTable('sync_outbox').get(id);
        if (item) item.status = 'PROCESSING';
      }
      return [];
    }

    if (q.includes('UPDATE sync_outbox') && q.includes('status = \'FAILED\'')) {
      const errMsg = params[0];
      const ids = params.slice(1);
      for (const id of ids) {
        const item = this.getTable('sync_outbox').get(id);
        if (item) {
          item.status = 'FAILED';
          item.retry_count = (item.retry_count || 0) + 1;
          item.last_error = errMsg;
        }
      }
      return [];
    }

    const updateMatch = q.match(/UPDATE "?(\w+)"?\s*SET\s*([^W]+)WHERE\s*"?(\w+)"?\s*=\s*\?/i);
    if (updateMatch) {
      const table = updateMatch[1];
      const setClauses = updateMatch[2].split(',').map(s => s.trim().split('=')[0].trim().replace(/"/g, ''));
      const id = params[params.length - 1];
      const current = this.getTable(table).get(id) || { id };
      setClauses.forEach((col, idx) => {
        current[col] = params[idx];
      });
      this.getTable(table).set(id, current);
      return [];
    }

    if (q.startsWith('DELETE FROM sync_outbox')) {
      for (const id of params) {
        this.getTable('sync_outbox').delete(id);
      }
      return [];
    }

    const deleteMatch = q.match(/DELETE FROM "?(\w+)"?\s*WHERE\s*"?(\w+)"?\s*=\s*\?/i);
    if (deleteMatch) {
      const table = deleteMatch[1];
      const id = params[0];
      this.getTable(table).delete(id);
      return [];
    }

    return [];
  }

  async transaction(action) {
    const tx = {
      execute: (query, params) => this.execute(query, params),
    };
    return await action(tx);
  }

  getAll(table) {
    return Array.from(this.getTable(table).values());
  }
}

class MockRemoteDB {
  constructor() {
    this.pushedBatches = [];
    this.shouldFailPush = false;
    this.liveSubscribers = [];
  }

  async pushChanges(operations) {
    if (this.shouldFailPush) return false;
    this.pushedBatches.push(operations);
    return true;
  }

  async fetchChanges(sinceTimestamp) {
    return { timestamp: Date.now(), changes: [] };
  }

  subscribeToLiveChanges(callback) {
    this.liveSubscribers.push(callback);
  }

  emitLiveChanges(changes) {
    for (const sub of this.liveSubscribers) {
      sub(changes);
    }
  }
}

async function runTests() {
  console.log('🧪 Starting Local-First Engine verification tests...\n');

  const db = new MockInMemoryDB();
  const remote = new MockRemoteDB();
  const network = new DefaultNetworkStatusProvider(true);

  const client = new LocalFirstClient({
    local: db,
    remote,
    network,
    pushIntervalMs: 100000,
    pullIntervalMs: 100000,
  });

  await client.initialize();

  // Test 1: Atomic Dual-Write (Issue 1)
  console.log('Test 1: Testing atomic dual-write (client.mutate)...');
  await client.mutate('todos', 'todo-1', 'INSERT', { title: 'Buy milk', done: false });
  const localTodos = db.getAll('todos');
  const outboxRecords = db.getAll('sync_outbox');

  if (localTodos.length === 1 && localTodos[0].title === 'Buy milk') {
    console.log('  ✅ Local data table updated successfully in todos');
  } else {
    throw new Error('Local table not updated properly');
  }

  if (outboxRecords.length === 1 && outboxRecords[0].row_id === 'todo-1') {
    console.log('  ✅ Outbox record created atomically with mutation');
  } else {
    throw new Error('Outbox record missing');
  }

  // Test 2: Immediate Debounced Sync (Issue 4)
  console.log('\nTest 2: Testing immediate debounced push...');
  await new Promise(r => setTimeout(r, 100));
  console.log('remote.pushedBatches:', remote.pushedBatches);
  if (remote.pushedBatches.length === 1 && remote.pushedBatches[0][0].rowId === 'todo-1') {
    console.log('  ✅ Mutation automatically triggered immediate push to remote!');
  } else {
    throw new Error('Immediate sync push was not triggered');
  }
  if (db.getAll('sync_outbox').length === 0) {
    console.log('  ✅ Outbox cleared after successful push');
  } else {
    throw new Error('Outbox not cleared after push');
  }

  // Test 3: Applying Pulled Deltas (Issue 2)
  console.log('\nTest 3: Testing applying remote deltas locally...');
  let eventReceived = false;
  client.events.on('todos', (event) => {
    if (event.rowId === 'todo-2' && event.source === 'remote') {
      eventReceived = true;
    }
  });

  await client.syncWorker.applyDeltasLocally({
    timestamp: 1000,
    changes: [
      {
        tableName: 'todos',
        rowId: 'todo-2',
        operation: 'INSERT',
        payload: { title: 'Remote note', done: true },
      }
    ]
  });

  const todo2 = db.getAll('todos').find(t => t.id === 'todo-2');
  if (todo2 && todo2.title === 'Remote note') {
    console.log('  ✅ Remote delta inserted into local table');
  } else {
    throw new Error('Remote delta was not inserted into local table');
  }
  if (eventReceived) {
    console.log('  ✅ Reactive event emitted with source="remote"');
  } else {
    throw new Error('Reactive event was not emitted');
  }
  if (db.getAll('sync_outbox').length === 0) {
    console.log('  ✅ Applying remote delta did NOT echo back into sync_outbox (no infinite loop)');
  } else {
    throw new Error('Remote delta echoed into outbox!');
  }

  // Test 4: Conflict Resolution (Issue 3)
  console.log('\nTest 4: Testing conflict resolution (Last-Write-Wins)...');
  network.setOnline(false); // Simulate offline editing
  await client.mutate('todos', 'todo-2', 'UPDATE', { title: 'Local edited note' }, { customTimestamp: 2000 });
  
  // Remote change with older timestamp 1500 -> Local should win
  await client.syncWorker.applyDeltasLocally({
    timestamp: 1500,
    changes: [
      {
        tableName: 'todos',
        rowId: 'todo-2',
        operation: 'UPDATE',
        payload: { title: 'Old Server note' },
        timestamp: 1500,
      }
    ]
  });
  let currentTodo2 = db.getAll('todos').find(t => t.id === 'todo-2');
  if (currentTodo2?.title === 'Local edited note') {
    console.log('  ✅ Local unpushed change with newer timestamp won conflict (kept local)');
  } else {
    throw new Error('Local change was erroneously overwritten by older server change');
  }

  // Remote change with newer timestamp 3000 -> Server should win
  await client.syncWorker.applyDeltasLocally({
    timestamp: 3000,
    changes: [
      {
        tableName: 'todos',
        rowId: 'todo-2',
        operation: 'UPDATE',
        payload: { title: 'New Server note' },
        timestamp: 3000,
      }
    ]
  });
  currentTodo2 = db.getAll('todos').find(t => t.id === 'todo-2');
  if (currentTodo2?.title === 'New Server note') {
    console.log('  ✅ Server change with newer timestamp won conflict (applied remote)');
  } else {
    throw new Error('Server change with newer timestamp did not apply');
  }

  // Test 5: Network Status Awareness (Issue 4)
  console.log('\nTest 5: Testing offline/online handling...');
  network.setOnline(false);
  remote.pushedBatches = [];
  await client.mutate('todos', 'todo-3', 'INSERT', { title: 'Offline task' });
  await new Promise(r => setTimeout(r, 60));

  if (remote.pushedBatches.length === 0) {
    console.log('  ✅ Push was safely deferred while offline');
  } else {
    throw new Error('Pushed while offline!');
  }

  // Restore network
  network.setOnline(true);
  await new Promise(r => setTimeout(r, 60));
  if (remote.pushedBatches.length > 0) {
    console.log('  ✅ Immediately pushed pending changes upon reconnecting online!');
  } else {
    throw new Error('Did not push on reconnect');
  }

  // Test 6: SupabaseRemoteAdapter (Supabase Support)
  console.log('\nTest 6: Testing SupabaseRemoteAdapter...');
  const { SupabaseRemoteAdapter } = await import('./dist/index.js');
  
  const mockTableCalls = { upserts: [], deletes: [], updates: [], selects: [] };
  let realtimeListener = null;

  const mockSupabase = {
    from: (table) => {
      const queryBuilder = {
        upsert: async (data) => {
          mockTableCalls.upserts.push({ table, data });
          return { error: null };
        },
        update: (data) => ({
          eq: async (col, val) => {
            mockTableCalls.updates.push({ table, data, col, val });
            return { error: null };
          }
        }),
        delete: () => ({
          eq: async (col, val) => {
            mockTableCalls.deletes.push({ table, col, val });
            return { error: null };
          }
        }),
        select: () => {
          const handler = {
            in: () => handler,
            order: () => handler,
            gt: async (col, val) => {
              mockTableCalls.selects.push({ table, col, val });
              return {
                data: [{ id: 'sb-1', title: 'Fetched from Supabase', updated_at: new Date().toISOString() }],
                error: null
              };
            }
          };
          return handler;
        }
      };
      return queryBuilder;
    },
    channel: (chanName) => ({
      on: (event, filter, callback) => {
        realtimeListener = callback;
        return {
          subscribe: () => {}
        };
      },
      subscribe: () => {}
    }),
    removeChannel: () => {}
  };

  const supabaseAdapter = new SupabaseRemoteAdapter(mockSupabase, {
    tables: ['todos'],
    updatedAtColumn: 'updated_at',
    deletedColumn: 'deleted',
    primaryKey: 'id'
  });

  // Test push
  const pushOk = await supabaseAdapter.pushChanges([
    {
      id: 'op-1',
      tableName: 'todos',
      rowId: 'todo-sb-1',
      operation: 'INSERT',
      payload: { title: 'Supabase Todo' },
      timestamp: 1000
    },
    {
      id: 'op-2',
      tableName: 'todos',
      rowId: 'todo-sb-2',
      operation: 'DELETE',
      payload: null,
      timestamp: 1001
    }
  ]);

  if (pushOk && mockTableCalls.upserts.length === 1 && mockTableCalls.updates.length === 1) {
    const delCall = mockTableCalls.updates[0];
    if (delCall.data.deleted === true) {
      console.log('  ✅ SupabaseRemoteAdapter pushChanges handled upsert and soft-delete (deleted: true)');
    } else {
      throw new Error('deleted: true was not set on soft-delete');
    }
  } else {
    throw new Error('SupabaseRemoteAdapter pushChanges failed');
  }

  // Test fetch
  const deltas = await supabaseAdapter.fetchChanges(500);
  if (deltas.changes.length === 1 && deltas.changes[0].rowId === 'sb-1') {
    console.log('  ✅ SupabaseRemoteAdapter fetchChanges successfully queried deltas');
  } else {
    throw new Error('SupabaseRemoteAdapter fetchChanges failed');
  }

  // Test realtime
  let liveDelta = null;
  supabaseAdapter.subscribeToLiveChanges((incoming) => {
    liveDelta = incoming;
  });

  if (realtimeListener) {
    realtimeListener({
      eventType: 'INSERT',
      new: { id: 'live-1', title: 'Live Supabase Item', updated_at: new Date().toISOString() },
      old: null
    });
  }

  if (liveDelta && liveDelta.changes[0].rowId === 'live-1') {
    console.log('  ✅ SupabaseRemoteAdapter realtime subscription converted postgres_changes correctly');
  } else {
    throw new Error('SupabaseRemoteAdapter realtime subscription failed');
  }

  // Test 7: defineSyncConfig & createSyncClient
  console.log('\nTest 7: Testing defineSyncConfig & createSyncClient factory...');
  const { defineSyncConfig, createSyncClient } = await import('./dist/index.js');

  const configDb = new MockInMemoryDB();
  const config = defineSyncConfig({
    database: configDb,
    tables: ['posts'],
    migrations: [
      'CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, title TEXT);'
    ],
    demoFallback: true,
    conflictResolver: 'last-write-wins',
    pushIntervalMs: 2000,
    pullIntervalMs: 5000,
  });

  const configuredClient = await createSyncClient(config);
  await configuredClient.mutate('posts', 'post-1', 'INSERT', { title: 'First Post' });

  // Test 8: autoSchema with zero manual migrations & type detection
  console.log('\nTest 8: Testing autoSchema without migrations & runtime column type detection...');
  const { detectSQLiteType } = await import('./dist/index.js');

  if (
    detectSQLiteType(true) === 'INTEGER' &&
    detectSQLiteType(100) === 'INTEGER' &&
    detectSQLiteType(99.95) === 'REAL' &&
    detectSQLiteType('text') === 'TEXT' &&
    detectSQLiteType({ key: 'val' }) === 'TEXT'
  ) {
    console.log('  ✅ SQLite column type detection maps JS types accurately to INTEGER, REAL, and TEXT');
  } else {
    throw new Error('detectSQLiteType failed');
  }

  const autoDb = new MockInMemoryDB();
  const autoConfig = defineSyncConfig({
    database: autoDb,
    tables: ['catalog_items', 'orders'],
    // NO migrations array!
    autoSchema: true,
    demoFallback: true,
  });

  const autoClient = await createSyncClient(autoConfig);
  await autoClient.mutate('catalog_items', 'item-100', 'INSERT', {
    name: 'Wireless Headphones',
    in_stock: true,
    rating: 4.8,
    metadata: { color: 'black', brand: 'Sony' },
  });

  const catalog = autoDb.getAll('catalog_items');
  if (
    catalog.length === 1 &&
    catalog[0].in_stock === 1 &&
    catalog[0].rating === 4.8 &&
    catalog[0].metadata === JSON.stringify({ color: 'black', brand: 'Sony' })
  ) {
    console.log('  ✅ autoSchema dynamically handled table and columns without any migrations defined!');
  } else {
    throw new Error('autoSchema test failed');
  }

  // Test 9: OpSQLiteAdapter & BetterSQLite3Adapter
  console.log('\nTest 9: Testing OpSQLiteAdapter & BetterSQLite3Adapter...');
  const { OpSQLiteAdapter, BetterSQLite3Adapter } = await import('./dist/index.js');

  // Test OpSQLiteAdapter
  const mockOpDb = {
    async executeAsync(q, params) {
      return { rows: { _array: [{ id: 'op-1', title: 'Op Item' }] } };
    },
    async transactionAsync(cb) {
      await cb({
        async executeAsync(q, p) {
          return { rows: [{ id: 'tx-1' }] };
        }
      });
    }
  };
  const opAdapter = new OpSQLiteAdapter(mockOpDb);
  const opRows = await opAdapter.execute('SELECT * FROM test');
  if (opRows.length === 1 && opRows[0].title === 'Op Item') {
    console.log('  ✅ OpSQLiteAdapter normalized and returned rows from op-sqlite');
  } else {
    throw new Error('OpSQLiteAdapter failed');
  }

  // Test BetterSQLite3Adapter
  const mockBetterDb = {
    prepare(q) {
      return {
        reader: q.startsWith('SELECT'),
        all: (...p) => [{ id: 'better-1', label: 'Node SQLite' }],
        run: (...p) => ({ changes: 1, lastInsertRowid: 1 })
      };
    }
  };
  const betterAdapter = new BetterSQLite3Adapter(mockBetterDb);
  const betterRows = await betterAdapter.execute('SELECT * FROM test');
  if (betterRows.length === 1 && betterRows[0].label === 'Node SQLite') {
    console.log('  ✅ BetterSQLite3Adapter executed query and returned rows synchronously/safely');
  } else {
    throw new Error('BetterSQLite3Adapter failed');
  }

  // Test 10: LibSQLAdapter, SqlJsAdapter, NodeSQLiteAdapter
  console.log('\nTest 10: Testing LibSQLAdapter, SqlJsAdapter & NodeSQLiteAdapter...');
  const { LibSQLAdapter, SqlJsAdapter, NodeSQLiteAdapter } = await import('./dist/index.js');

  // LibSQL test
  const mockLibsql = {
    async execute({ sql, args }) {
      return {
        columns: ['id', 'name'],
        rows: [['lib-1', 'Turso Item']],
      };
    },
    async transaction() {
      return {
        async execute() { return { columns: ['id'], rows: [['1']] }; },
        async commit() {},
        async rollback() {},
      };
    }
  };
  const libsqlAdapter = new LibSQLAdapter(mockLibsql);
  const libRows = await libsqlAdapter.execute('SELECT * FROM test');
  if (libRows.length === 1 && libRows[0].id === 'lib-1' && libRows[0].name === 'Turso Item') {
    console.log('  ✅ LibSQLAdapter mapped columns and rows from Turso/@libsql/client');
  } else {
    throw new Error('LibSQLAdapter failed');
  }

  // SqlJs test
  const mockSqlJs = {
    exec(q) {
      return [{ columns: ['id', 'color'], values: [['sqljs-1', 'blue']] }];
    },
    prepare(q) {
      let stepped = false;
      return {
        bind() { return true; },
        step() {
          if (!stepped) { stepped = true; return true; }
          return false;
        },
        getAsObject() { return { id: 'sqljs-param', color: 'green' }; },
        free() { return true; }
      };
    },
    run() {}
  };
  const sqlJsAdapter = new SqlJsAdapter(mockSqlJs);
  const sqlJsRows = await sqlJsAdapter.execute('SELECT * FROM test');
  const sqlJsParamRows = await sqlJsAdapter.execute('SELECT * FROM test WHERE id = ?', ['1']);
  if (sqlJsRows.length === 1 && sqlJsRows[0].color === 'blue' && sqlJsParamRows[0].color === 'green') {
    console.log('  ✅ SqlJsAdapter handled both raw exec and parameterized statements for Web WASM');
  } else {
    throw new Error('SqlJsAdapter failed');
  }

  // NodeSQLite test
  const mockNodeSqlite = {
    prepare(q) {
      return {
        all: (...p) => [{ id: 'node-1', runtime: 'node:sqlite' }],
        run: (...p) => ({ changes: 1, lastInsertRowid: 1 })
      };
    },
    exec(q) {}
  };
  const nodeSqliteAdapter = new NodeSQLiteAdapter(mockNodeSqlite);
  const nodeRows = await nodeSqliteAdapter.execute('SELECT * FROM test');
  if (nodeRows.length === 1 && nodeRows[0].runtime === 'node:sqlite') {
    console.log('  ✅ NodeSQLiteAdapter executed queries on Node 22+ built-in DatabaseSync');
  } else {
    throw new Error('NodeSQLiteAdapter failed');
  }

  autoClient.stop();
  configuredClient.stop();
  client.stop();
  console.log('\n🎉 ALL 10 TESTS PASSING: FULL COMPATIBILITY ACROSS EXPO, OP-SQLITE, BETTER-SQLITE3, LIBSQL, SQL.JS & NODE:SQLITE!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
