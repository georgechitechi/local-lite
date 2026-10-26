import { describe, it, expect, beforeEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';
import { JobScheduler } from '../src/scheduler/index.js';

describe('JobScheduler & Background Cron', () => {
  let db: MockDB;
  let scheduler: JobScheduler;

  beforeEach(async () => {
    db = new MockDB();
    scheduler = new JobScheduler(db, { checkIntervalMs: 5000 });
    await scheduler.initialize();
  });

  it('registers scheduled jobs and calculates interval from human string and cron', async () => {
    const job1 = await scheduler.register({
      id: 'daily-backup',
      schedule: 'daily',
    });
    expect(job1.intervalMs).toBe(24 * 60 * 60 * 1000);

    const job2 = await scheduler.register({
      id: 'hourly-sync',
      schedule: 'every 1 hour',
    });
    expect(job2.intervalMs).toBe(60 * 60 * 1000);

    const job3 = await scheduler.register({
      id: 'cron-job',
      schedule: '*/15 * * * *',
    });
    expect(job3.intervalMs).toBe(15 * 60 * 1000);

    const jobs = await scheduler.getJobs();
    expect(jobs).toHaveLength(3);
  });

  it('manually triggers job and records SUCCESS run history', async () => {
    let executedCount = 0;
    await scheduler.register({
      id: 'prune-tokens',
      schedule: 'daily',
      handler: async () => {
        executedCount++;
      },
    });

    const run = await scheduler.trigger('prune-tokens');
    expect(run.status).toBe('SUCCESS');
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(executedCount).toBe(1);

    const history = await scheduler.getHistory('prune-tokens');
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('SUCCESS');
  });

  it('records FAILED run history when handler throws an error', async () => {
    await scheduler.register({
      id: 'failing-task',
      schedule: 'hourly',
      handler: async () => {
        throw new Error('Network timeout during scheduled task');
      },
    });

    const run = await scheduler.trigger('failing-task');
    expect(run.status).toBe('FAILED');
    expect(run.error).toContain('Network timeout');

    const history = await scheduler.getHistory('failing-task');
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('FAILED');
    expect(history[0].error).toContain('Network timeout');
  });

  it('executes due jobs during tick()', async () => {
    let ran = false;
    await scheduler.register({
      id: 'immediate-check',
      schedule: 'every 1 second',
      handler: () => {
        ran = true;
      },
    });

    // Artificially simulate next_run_at being in the past
    const jobs = await scheduler.getJobs();
    const target = jobs.find((j) => j.id === 'immediate-check')!;
    target.nextRunAt = Date.now() - 1000;
    db.getTable('_local_scheduled_jobs').set('immediate-check', target);

    const executed = await scheduler.tick();
    expect(executed).toBe(1);
    expect(ran).toBe(true);
  });

  it('integrates cleanly into LocalFirstClient via client.scheduler', async () => {
    const remote = new MemoryDemoRemoteAdapter(50);
    const network = new DefaultNetworkStatusProvider(true);

    const client = new LocalFirstClient({
      local: db,
      remote,
      network,
    });
    await client.initialize();

    let clientJobRan = false;
    await client.scheduler.register({
      id: 'client-cleanup',
      schedule: 'daily',
      handler: () => {
        clientJobRan = true;
      },
    });

    await client.scheduler.trigger('client-cleanup');
    expect(clientJobRan).toBe(true);

    client.stop();
  });
});
