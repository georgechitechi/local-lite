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
  
  const mockTableCalls = { upserts: [], deletes: [], selects: [] };
  let realtimeListener = null;

  const mockSupabase = {
    from: (table) => {
      const queryBuilder = {
        upsert: async (data) => {
          mockTableCalls.upserts.push({ table, data });
          return { error: null };
        },
        delete: () => ({
          eq: async (col, val) => {
            mockTableCalls.deletes.push({ table, col, val });
            return { error: null };
          }
        }),
        select: () => ({
          gt: async (col, val) => {
            mockTableCalls.selects.push({ table, col, val });
            return {
              data: [
                { id: 'sb-1', title: 'Fetched from Supabase', updated_at: new Date().toISOString() }
              ],
              error: null
            };
          }
        })
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

  if (pushOk && mockTableCalls.upserts.length === 1 && mockTableCalls.deletes.length === 1) {
    console.log('  ✅ SupabaseRemoteAdapter pushChanges handled upsert and delete');
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

  client.stop();
  console.log('\n🎉 ALL TESTS INCLUDING SUPABASE ADAPTER PASSING SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
