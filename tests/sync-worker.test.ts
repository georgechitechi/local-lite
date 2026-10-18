import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';

describe('SyncWorker & Conflict Resolution', () => {
  let db: MockDB;
  let remote: MemoryDemoRemoteAdapter;
  let network: DefaultNetworkStatusProvider;
  let client: LocalFirstClient;

  beforeEach(async () => {
    db = new MockDB();
    remote = new MemoryDemoRemoteAdapter(50);
    network = new DefaultNetworkStatusProvider(true);

    client = new LocalFirstClient({
      local: db,
      remote,
      network,
      conflictResolver: 'last-write-wins',
      pushIntervalMs: 200,
      pullIntervalMs: 500,
    });

    await client.initialize();
  });

  afterEach(() => {
    client.stop();
  });

  it('applies remote deltas locally without echoing into sync_outbox', async () => {
    let remoteEventFired = false;
    client.events.on('posts', (e) => {
      if (e.source === 'remote') {
        remoteEventFired = true;
      }
    });

    await client.syncWorker.applyDeltasLocally({
      timestamp: Date.now(),
      changes: [
        {
          tableName: 'posts',
          operation: 'INSERT',
          rowId: 'post-remote-1',
          payload: { title: 'Downloaded from Cloud' },
          timestamp: Date.now(),
        },
      ],
    });

    // Check local table
    const post = await client.findById('posts', 'post-remote-1');
    expect(post?.title).toBe('Downloaded from Cloud');
    expect(remoteEventFired).toBe(true);

    // Verify outbox did not record this change (no infinite sync loop)
    const outboxItems = db.getAll('sync_outbox');
    expect(outboxItems).toHaveLength(0);
  });

  it('resolves conflicts using Last-Write-Wins (LWW)', async () => {
    const baseTime = 100000;

    // 1. Local has unpushed pending mutation at T = 2000
    await client.trackMutation(
      'notes',
      'note-1',
      'UPDATE',
      { content: 'Local Offline Edit' },
      { customTimestamp: baseTime + 2000 }
    );
    await db.execute('INSERT INTO notes (id, content) VALUES (?, ?)', [
      'note-1',
      'Local Offline Edit',
    ]);

    // 2. Older server change arrives (T = 1000) -> Local change wins (kept)
    await client.syncWorker.applyDeltasLocally({
      timestamp: baseTime + 1000,
      changes: [
        {
          tableName: 'notes',
          operation: 'UPDATE',
          rowId: 'note-1',
          payload: { content: 'Stale Cloud Edit' },
          timestamp: baseTime + 1000,
        },
      ],
    });

    let current = await client.findById('notes', 'note-1');
    expect(current?.content).toBe('Local Offline Edit');

    // 3. Newer server change arrives (T = 3000) -> Server change wins (applied)
    await client.syncWorker.applyDeltasLocally({
      timestamp: baseTime + 3000,
      changes: [
        {
          tableName: 'notes',
          operation: 'UPDATE',
          rowId: 'note-1',
          payload: { content: 'Winner Newer Cloud Edit' },
          timestamp: baseTime + 3000,
        },
      ],
    });

    current = await client.findById('notes', 'note-1');
    expect(current?.content).toBe('Winner Newer Cloud Edit');
  });

  it('defers push while offline and immediately flushes upon reconnecting', async () => {
    // 1. Go offline
    network.setOnline(false);

    await client.insert('todos', {
      id: 'offline-todo',
      title: 'Created on Plane',
    });

    // Wait a brief moment
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Should remain in outbox while offline
    let outbox = db.getAll('sync_outbox');
    expect(outbox).toHaveLength(1);
    expect(outbox[0].row_id).toBe('offline-todo');

    // 2. Reconnect online
    network.setOnline(true);

    // Wait for auto-flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Outbox should be drained now
    outbox = db.getAll('sync_outbox');
    expect(outbox).toHaveLength(0);
  });

  it('pauses sync timers when backgrounded and resumes on foreground', async () => {
    expect(client.syncWorker.isBackgroundPaused).toBe(false);

    client.syncWorker.pause();
    expect(client.syncWorker.isBackgroundPaused).toBe(true);

    // Mutations while paused stay in outbox without pushing
    await client.insert('notes', { id: 'paused-note', content: 'While backgrounded' });
    await new Promise((resolve) => setTimeout(resolve, 80));

    let outbox = db.getAll('sync_outbox');
    expect(outbox).toHaveLength(1);

    // Resume foreground
    client.syncWorker.resume();
    expect(client.syncWorker.isBackgroundPaused).toBe(false);

    // Wait for auto-flush on resume
    await new Promise((resolve) => setTimeout(resolve, 150));
    outbox = db.getAll('sync_outbox');
    expect(outbox).toHaveLength(0);
  });
});
