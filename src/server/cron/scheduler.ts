import crypto from 'node:crypto';
import { quoteIdent, type SqlExecutor } from '../sqlDialect.js';
import { computeNextCronRunAt, isCronJobDue } from './schedule.js';
import { createMemoryCronStore } from './store.js';
import type {
  CronEndpointOptions,
  CronJobDefinition,
  CronRunOutcome,
  CronSchedulerOptions,
  ServerCronScheduler,
} from './types.js';

export async function claimScheduledJob(
  executor: SqlExecutor,
  tableName: string,
  jobKey: string,
  now: number,
  intervalMs: number,
): Promise<boolean> {
  const tbl = quoteIdent(tableName, executor.dialect);
  const cutoff = now - Math.max(intervalMs, 1);
  const res = await executor.execute(
    `UPDATE ${tbl}
     SET last_run_at = ?, last_status = 'running', updated_at = ?
     WHERE job_key = ? AND enabled = 1 AND (last_run_at IS NULL OR last_run_at = 0 OR last_run_at <= ?)`,
    [now, now, jobKey, cutoff],
  );
  return res.affectedRows > 0;
}

export interface ServerCronRunnerOptions {
  intervalMs?: number;
  enabled?: boolean;
  onTick: () => Promise<void>;
  onError?: (error: unknown) => void;
}

export function createServerCronRunner(options: ServerCronRunnerOptions) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  const intervalMs = Math.max(options.intervalMs ?? 15 * 60 * 1000, 1000);

  return {
    start(): void {
      if (options.enabled === false || timer) return;
      timer = setInterval(() => {
        if (ticking) return;
        ticking = true;
        void options
          .onTick()
          .catch((err) => {
            options.onError?.(err);
          })
          .finally(() => {
            ticking = false;
          });
      }, intervalMs);
      timer.unref?.();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    isRunning(): boolean {
      return timer !== null;
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Cron job timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

/**
 * Production-grade server cron scheduler with:
 * - 5-field cron expressions + human shortcuts + IANA timezone support
 * - Crash-safe lease locking (`lockTimeoutMs`)
 * - Per-job execution timeout (`timeoutMs`)
 * - Exponential backoff retries (`maxRetries`, `retryDelayMs`)
 * - Bounded run history (`getHistory`)
 */
export function createCronScheduler(
  options: CronSchedulerOptions = {},
): ServerCronScheduler {
  const store = options.store ?? createMemoryCronStore();
  const registry = new Map<string, CronJobDefinition>();
  let seeded = false;

  async function ensureJobs(): Promise<void> {
    if (store.ensureSchema) await store.ensureSchema();
    if (seeded) return;
    const now = Date.now();
    for (const def of registry.values()) {
      await store.seedIfMissing({
        jobKey: def.key,
        label: def.label,
        description: def.description ?? '',
        cron: def.cron ?? null,
        intervalHours: Math.max(Math.trunc(def.intervalHours ?? 24), 1),
        runHour: def.runHour ?? null,
        timezone: def.timezone ?? options.defaultTimezone ?? null,
        enabled: def.enabled !== false,
        builtIn: def.builtIn !== false,
        lastRunAt: null,
        lockedUntil: null,
        consecutiveFailures: 0,
        lastStatus: null,
        lastSummary: null,
        lastDurationMs: null,
        updatedAt: now,
      });
    }
    seeded = true;
  }

  async function executeWithRetries(
    jobKey: string,
    now: number,
    manual: boolean,
  ): Promise<CronRunOutcome> {
    const def = registry.get(jobKey);
    if (!def) {
      throw new Error(`Cron job "${jobKey}" is not registered.`);
    }
    const maxRetries = Math.max(Math.trunc(def.maxRetries ?? 0), 0);
    const retryDelayMs = Math.max(def.retryDelayMs ?? 1000, 10);
    const timeoutMs = def.timeoutMs ?? 60_000;
    const startedAt = now;
    const wallStart = Date.now();
    let lastError: any = null;
    let attempts = 0;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      attempts = attempt;
      try {
        const raw = await withTimeout(
          Promise.resolve(def.handler({ now, manual, jobKey, attempt })),
          timeoutMs,
        );
        const durationMs = Math.max(Date.now() - wallStart, 0);
        const finishedAt = now + durationMs;
        const summary =
          typeof raw === 'string'
            ? raw
            : raw && typeof raw === 'object' && typeof raw.summary === 'string'
              ? raw.summary
              : `Completed ${def.label}`;

        await store.recordRun(jobKey, {
          id: crypto.randomUUID(),
          jobKey,
          startedAt,
          finishedAt,
          durationMs,
          status: 'success',
          summary,
          attempt,
          manual,
        });
        const updated = await store.get(jobKey);
        return {
          ok: true,
          jobKey,
          status: 'success',
          summary,
          durationMs,
          attempts,
          runAt: finishedAt,
          nextRunAt: updated ? computeNextCronRunAt(updated, finishedAt) : null,
          result: raw && typeof raw === 'object' ? raw : undefined,
        };
      } catch (err: any) {
        lastError = err;
        if (attempt <= maxRetries) {
          await delay(retryDelayMs * 2 ** (attempt - 1));
        }
      }
    }

    const durationMs = Math.max(Date.now() - wallStart, 0);
    const finishedAt = now + durationMs;
    const summary = lastError?.message
      ? String(lastError.message)
      : 'Cron job failed.';
    await store.recordRun(jobKey, {
      id: crypto.randomUUID(),
      jobKey,
      startedAt,
      finishedAt,
      durationMs,
      status: 'error',
      summary,
      attempt: attempts,
      manual,
    });
    const updated = await store.get(jobKey);
    return {
      ok: false,
      jobKey,
      status: 'error',
      summary,
      durationMs,
      attempts,
      runAt: finishedAt,
      nextRunAt: updated ? computeNextCronRunAt(updated, finishedAt) : null,
    };
  }

  const scheduler: ServerCronScheduler = {
    register(def) {
      registry.set(def.key, def);
      seeded = false;
      return scheduler;
    },
    ensureJobs,
    async list(now = Date.now()) {
      await ensureJobs();
      const rows = await store.list();
      return rows.map((row) => ({
        ...row,
        nextRunAt: computeNextCronRunAt(row, now),
      }));
    },
    async getHistory(jobKey, limit = 25) {
      await ensureJobs();
      return store.getHistory(jobKey, limit);
    },
    async update(jobKey, patch) {
      await ensureJobs();
      await store.update(jobKey, patch);
      const updated = await store.get(jobKey);
      return updated
        ? { ...updated, nextRunAt: computeNextCronRunAt(updated) }
        : null;
    },
    async delete(jobKey) {
      await ensureJobs();
      const existing = await store.get(jobKey);
      if (existing?.builtIn) {
        throw new Error(`Built-in cron job "${jobKey}" cannot be deleted.`);
      }
      await store.delete(jobKey);
      registry.delete(jobKey);
    },
    async runNow(jobKey, now = Date.now()) {
      await ensureJobs();
      return executeWithRetries(jobKey, now, true);
    },
    async runDue(now = Date.now()) {
      await ensureJobs();
      const rows = await store.list();
      const executed: string[] = [];

      for (const row of rows) {
        const def = registry.get(row.jobKey);
        if (!def || !isCronJobDue(row, now)) continue;
        const lockTimeoutMs = def.lockTimeoutMs ?? 5 * 60_000;
        const claimed = await store.claim(row.jobKey, now, lockTimeoutMs);
        if (!claimed) continue;

        await executeWithRetries(row.jobKey, now, false);
        executed.push(row.jobKey);
      }
      return executed;
    },
    start() {
      runner.start();
    },
    stop() {
      runner.stop();
    },
    isRunning() {
      return runner.isRunning();
    },
  };

  const runner = createServerCronRunner({
    intervalMs: options.tickIntervalMs ?? 60_000,
    enabled: options.enabled,
    onTick: async () => {
      await scheduler.runDue();
    },
    onError: options.onError,
  });

  return scheduler;
}

const CRON_JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Standard HTTP handler for cron jobs:
 * - `GET`: list jobs with `nextRunAt` (or `GET ?history=1&job=<key>&limit=25` for run history)
 * - `POST ?job=<key>`: trigger `runNow`
 * - `PUT` / `PATCH`: update `label`, `description`, `cron`, `intervalHours`, `runHour`, `timezone`, `enabled`
 * - `DELETE ?job=<key>`: delete a non-built-in job
 */
export function createCronEndpoint(
  options: CronEndpointOptions,
): (request: Request) => Promise<Response> {
  return async function handleCronRequest(request: Request): Promise<Response> {
    if (options.authenticate) {
      const ok = await options.authenticate(request);
      if (!ok) {
        return Response.json(
          { error: 'Unauthorized' },
          { status: 401, headers: CRON_JSON_HEADERS },
        );
      }
    }

    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === 'GET') {
      if (url.searchParams.get('history') === '1') {
        const jobKey = url.searchParams.get('job')?.trim() || undefined;
        const limit = Number(url.searchParams.get('limit') || 25);
        const history = await options.scheduler.getHistory(jobKey, limit);
        return Response.json({ history }, { headers: CRON_JSON_HEADERS });
      }
      const jobs = await options.scheduler.list();
      return Response.json({ jobs }, { headers: CRON_JSON_HEADERS });
    }

    if (method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<
        string,
        any
      >;
      const jobKey =
        url.searchParams.get('job')?.trim() ||
        (typeof body.jobKey === 'string' ? body.jobKey.trim() : '');
      if (!jobKey) {
        return Response.json(
          { error: 'job query parameter or jobKey is required.' },
          { status: 400, headers: CRON_JSON_HEADERS },
        );
      }
      try {
        const outcome = await options.scheduler.runNow(jobKey);
        return Response.json(outcome, {
          status: outcome.ok ? 200 : 500,
          headers: CRON_JSON_HEADERS,
        });
      } catch (err: any) {
        return Response.json(
          { error: err?.message || 'Cron job execution failed.' },
          { status: 404, headers: CRON_JSON_HEADERS },
        );
      }
    }

    if (method === 'PUT' || method === 'PATCH') {
      const body = (await request.json().catch(() => ({}))) as Record<
        string,
        any
      >;
      const jobKey =
        url.searchParams.get('job')?.trim() ||
        (typeof body.jobKey === 'string' ? body.jobKey.trim() : '');
      if (!jobKey) {
        return Response.json(
          { error: 'jobKey is required.' },
          { status: 400, headers: CRON_JSON_HEADERS },
        );
      }
      const updated = await options.scheduler.update(jobKey, {
        label: typeof body.label === 'string' ? body.label : undefined,
        description:
          typeof body.description === 'string' ? body.description : undefined,
        cron:
          body.cron === null
            ? null
            : typeof body.cron === 'string'
              ? body.cron
              : undefined,
        intervalHours:
          body.intervalHours !== undefined
            ? Number(body.intervalHours)
            : undefined,
        runHour:
          body.runHour === null
            ? null
            : body.runHour !== undefined
              ? Number(body.runHour)
              : undefined,
        timezone:
          body.timezone === null
            ? null
            : typeof body.timezone === 'string'
              ? body.timezone
              : undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      });
      if (!updated) {
        return Response.json(
          { error: `Cron job "${jobKey}" not found.` },
          { status: 404, headers: CRON_JSON_HEADERS },
        );
      }
      return Response.json(
        { ok: true, job: updated },
        { headers: CRON_JSON_HEADERS },
      );
    }

    if (method === 'DELETE') {
      const jobKey = url.searchParams.get('job')?.trim() || '';
      if (!jobKey) {
        return Response.json(
          { error: 'job query parameter is required.' },
          { status: 400, headers: CRON_JSON_HEADERS },
        );
      }
      try {
        await options.scheduler.delete(jobKey);
        return Response.json(
          { deleted: true, jobKey },
          { headers: CRON_JSON_HEADERS },
        );
      } catch (err: any) {
        return Response.json(
          { error: err?.message || 'Could not delete cron job.' },
          { status: 400, headers: CRON_JSON_HEADERS },
        );
      }
    }

    return Response.json(
      { error: 'Method Not Allowed' },
      { status: 405, headers: CRON_JSON_HEADERS },
    );
  };
}
