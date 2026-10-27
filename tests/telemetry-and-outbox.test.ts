import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';
import { PushEvent, SyncStatusEvent } from '../src/core/types.js';

describe('Telemetry & Outbox Management', () => {
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
      pushIntervalMs: 500,
      pullIntervalMs: 1000,
      retry: {
        maxRetries: 3,
        jitter: true,
      },
    });

    await client.initialize();
  });

  afterEach(() => {
    client.stop();
  });

  it('client.getMetrics provides real-time telemetry metrics', async () => {
    // 1. Initially empty metrics
    const initialMetrics = await client.getMetrics();
    expect(initialMetrics.isOnline).toBe(true);
    expect(initialMetrics.outboxPendingCount).toBe(0);
    expect(initialMetrics.totalPushedOperations).toBe(0);

    // 2. Perform a write
    await client.insert('todos', { id: 'm-1', title: 'Metric task' });

    // Wait for push
    await new Promise((resolve) => setTimeout(resolve, 300));

    const metricsAfter = await client.getMetrics();
    expect(metricsAfter.totalPushedOperations).toBeGreaterThanOrEqual(1);
    expect(metricsAfter.totalPushCycles).toBeGreaterThanOrEqual(1);
    expect(metricsAfter.lastPushDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('emits sync:status and sync:push telemetry events', async () => {
    const statusEvents: SyncStatusEvent[] = [];
    const pushEvents: PushEvent[] = [];

    client.events.on('sync:status', (e) => statusEvents.push(e));
    client.events.on('sync:push', (e) => pushEvents.push(e));

    await client.insert('notes', { id: 'n-1', text: 'Telemetry note' });

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(pushEvents.length).toBeGreaterThan(0);
    expect(pushEvents[0].success).toBe(true);
    expect(pushEvents[0].count).toBeGreaterThanOrEqual(1);
  });

  it('provides outbox inspection, retry, and clear utilities', async () => {
    // Insert an item skipping outbox auto-push by simulating offline
    network.setOnline(false);

    await client.insert('tasks', { id: 't-1', title: 'Task 1' });
    await client.insert('tasks', { id: 't-2', title: 'Task 2' });

    const records = await client.getOutboxRecords();
    expect(records).toHaveLength(2);
    expect(records[0].status).toBe('PENDING');

    // Simulate marking one as FAILED
    const outboxTable = db.getTable('sync_outbox');
    const firstId = records[0].id;
    const item = outboxTable.get(firstId);
    item.status = 'FAILED';
    item.retry_count = 3;
    item.last_error = 'Simulated network drop';

    // Verify retryFailedMutations resets it
    const retriedCount = await client.retryFailedMutations([firstId]);
    expect(retriedCount).toBe(1);
    expect(outboxTable.get(firstId).status).toBe('PENDING');

    // Set one to FAILED and clear it
    item.status = 'FAILED';
    const cleared = await client.clearFailedMutations([firstId]);
    expect(cleared).toBe(1);
    expect(outboxTable.has(firstId)).toBe(false);
  });
});
