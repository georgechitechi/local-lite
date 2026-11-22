import { describe, expect, it } from 'vitest';
import {
  computeNextCronRunAt,
  createCronEndpoint,
  createCronScheduler,
  createMemoryCronStore,
  nextCronExpressionTime,
} from '../src/server/cron/index.js';

describe('createCronScheduler & createCronEndpoint', () => {
  it('supports 5-field cron expressions with IANA timezones', async () => {
    let runs = 0;
    const scheduler = createCronScheduler({ store: createMemoryCronStore() });

    // 3:00 AM Africa/Nairobi (UTC+3) === 00:00 UTC
    scheduler.register({
      key: 'nairobi_backup',
      label: 'Nairobi 3 AM Backup',
      cron: '0 3 * * *',
      timezone: 'Africa/Nairobi',
      handler: () => {
        runs++;
        return { summary: `Backup #${runs}` };
      },
    });

    // 00:00 UTC is 03:00 in Africa/Nairobi -> due!
    const at3amNairobi = Date.UTC(2026, 10, 23, 0, 0, 0);
    expect(await scheduler.runDue(at3amNairobi)).toEqual(['nairobi_backup']);
    expect(runs).toBe(1);

    // 00:10 UTC (03:10 Nairobi) -> not due again today
    const at310amNairobi = Date.UTC(2026, 10, 23, 0, 10, 0);
    expect(await scheduler.runDue(at310amNairobi)).toEqual([]);

    const next = nextCronExpressionTime(
      '0 3 * * *',
      at310amNairobi,
      'Africa/Nairobi',
    );
    expect(next).toBe(Date.UTC(2026, 10, 24, 0, 0, 0));
  });

  it('retries transient failures with backoff and records run history', async () => {
    let attemptsSeen = 0;
    const scheduler = createCronScheduler({ store: createMemoryCronStore() });

    scheduler.register({
      key: 'flaky_job',
      label: 'Flaky Job',
      cron: 'hourly',
      maxRetries: 2,
      retryDelayMs: 10,
      handler: ({ attempt }) => {
        attemptsSeen = attempt;
        if (attempt < 3) throw new Error('Transient SMTP error');
        return { summary: 'Succeeded on attempt 3' };
      },
    });

    const outcome = await scheduler.runNow('flaky_job');
    expect(outcome.ok).toBe(true);
    expect(outcome.attempts).toBe(3);
    expect(attemptsSeen).toBe(3);
    expect(outcome.summary).toBe('Succeeded on attempt 3');

    const history = await scheduler.getHistory('flaky_job');
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('success');
    expect(history[0].attempt).toBe(3);
  });

  it('enforces per-job timeoutMs', async () => {
    const scheduler = createCronScheduler({ store: createMemoryCronStore() });
    scheduler.register({
      key: 'slow_job',
      label: 'Slow Job',
      cron: 'hourly',
      timeoutMs: 25,
      handler: () => new Promise((resolve) => setTimeout(resolve, 200)),
    });

    const outcome = await scheduler.runNow('slow_job');
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe('error');
    expect(outcome.summary).toContain('timed out');
  });

  it('reclaims crashed jobs once lockTimeoutMs lease expires', async () => {
    const store = createMemoryCronStore();
    const scheduler = createCronScheduler({ store });
    let runs = 0;

    scheduler.register({
      key: 'lease_job',
      label: 'Lease Job',
      cron: '0 * * * *',
      timezone: 'UTC',
      lockTimeoutMs: 5_000,
      handler: () => {
        runs++;
        return { summary: 'Recovered' };
      },
    });

    await scheduler.ensureJobs();
    const t0 = Date.UTC(2026, 10, 23, 1, 0, 0);
    // Simulate a crashed worker holding a lease until t0 + 5000
    expect(await store.claim('lease_job', t0, 5_000)).toBe(true);

    // Before lease expires: skipped
    expect(await scheduler.runDue(t0 + 2_000)).toEqual([]);
    expect(runs).toBe(0);

    // After lease expires: reclaimed and executed!
    expect(await scheduler.runDue(t0 + 6_000)).toEqual(['lease_job']);
    expect(runs).toBe(1);
  });

  it('computes nextRunAt accurately for cron jobs', () => {
    const at2pm = Date.UTC(2026, 10, 22, 14, 0, 0);
    const next3am = computeNextCronRunAt(
      {
        enabled: true,
        cron: '0 3 * * *',
        timezone: 'UTC',
        lastRunAt: null,
      },
      at2pm,
    );
    expect(next3am).toBe(Date.UTC(2026, 10, 23, 3, 0, 0));
  });

  it('exposes GET (jobs & history), POST (runNow), PATCH, and DELETE via createCronEndpoint', async () => {
    const scheduler = createCronScheduler({ store: createMemoryCronStore() });
    scheduler.register({
      key: 'cleanup',
      label: 'Cleanup',
      cron: '*/15 * * * *',
      builtIn: false,
      handler: () => ({ summary: 'Cleaned 3 items' }),
    });

    const endpoint = createCronEndpoint({
      scheduler,
      authenticate: (req) => req.headers.get('authorization') === 'Bearer ok',
    });

    const unauthed = await endpoint(new Request('http://localhost/crons'));
    expect(unauthed.status).toBe(401);

    const runRes = await endpoint(
      new Request('http://localhost/crons?job=cleanup', {
        method: 'POST',
        headers: { Authorization: 'Bearer ok' },
      }),
    );
    expect(runRes.status).toBe(200);
    expect((await runRes.json()).summary).toBe('Cleaned 3 items');

    const histRes = await endpoint(
      new Request('http://localhost/crons?history=1&job=cleanup', {
        headers: { Authorization: 'Bearer ok' },
      }),
    );
    expect(histRes.status).toBe(200);
    const histData = await histRes.json();
    expect(histData.history).toHaveLength(1);
    expect(histData.history[0].manual).toBe(true);

    const patchRes = await endpoint(
      new Request('http://localhost/crons?job=cleanup', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ok',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: false,
          cron: '0 4 * * *',
          timezone: 'Africa/Nairobi',
        }),
      }),
    );
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.job.cron).toBe('0 4 * * *');
    expect(patched.job.timezone).toBe('Africa/Nairobi');

    const delRes = await endpoint(
      new Request('http://localhost/crons?job=cleanup', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ok' },
      }),
    );
    expect(delRes.status).toBe(200);
  });
});
