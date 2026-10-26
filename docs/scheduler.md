# Offline Job Scheduler & Background Cron (`client.scheduler`)

Local-first applications need to run background maintenance, compute recurring reminders, check rent due dates, and prune expired tokens even when completely offline. `client.scheduler` provides a persistent, offline-first cron and periodic task runner.

---

## Features

- **Persistent Job Registry**: Registered tasks and next-run timestamps survive app restarts in `_local_scheduled_jobs`.
- **Run History & Telemetry**: Logs each execution in `_local_job_runs` with start/finish timestamps, durations, and error traces.
- **Human & Standard Cron Schedules**: Supports `'daily'`, `'hourly'`, `'every 15 minutes'`, standard 5-part cron expressions (`*/15 * * * *`), or millisecond intervals.
- **Automatic Ticker**: Background interval runs tasks as they become due without blocking the main event loop.

---

## Registering Jobs

```typescript
// Register a daily database maintenance task
await client.scheduler.register({
  id: 'daily-maintenance',
  name: 'Database Vacuum & Pruning',
  schedule: 'daily',
  handler: async (job) => {
    await client.maintenance.vacuum();
    await client.kv.pruneExpired();
  },
});

// Register an hourly backup job
await client.scheduler.register({
  id: 'hourly-backup',
  schedule: 'every 1 hour',
  handler: async () => {
    console.log('Running hourly client backup...');
  },
});

// Standard 5-field cron: every 15 minutes
await client.scheduler.register({
  id: 'sync-audit',
  schedule: '*/15 * * * *',
  handler: async () => {
    await client.sync();
  },
});
```

---

## Starting the Scheduler

```typescript
// Start the scheduler loop (checks every 30 seconds by default)
client.scheduler.start();

// Or configure explicit check interval
client.scheduler.start(10000); // 10 seconds

// Stop scheduler when closing or unmounting
client.scheduler.stop();
```

---

## Manual Execution & History

```typescript
// Force trigger a job immediately
const run = await client.scheduler.trigger('daily-maintenance');
console.log(`Status: ${run.status}, Duration: ${run.durationMs}ms`);

// Inspect execution history
const history = await client.scheduler.getHistory('daily-maintenance', 20);
for (const entry of history) {
  console.log(`[${new Date(entry.startedAt).toISOString()}] ${entry.status} (${entry.durationMs}ms)`);
}

// Prune old history logs older than 7 days
await client.scheduler.pruneHistory(7 * 24 * 60 * 60 * 1000);
```
