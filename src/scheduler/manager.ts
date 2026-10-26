import { DBExecutable } from '../core/schema-manager.js';
import { generateUUID } from '../utils/uuid.js';
import { JobDefinition, JobRecord, JobRunRecord, JobSchedulerOptions } from './types.js';
import { calculateNextRun, parseScheduleToIntervalMs } from './cron.js';
import { JobStore } from './store.js';

export class JobScheduler {
  private handlers: Map<string, (job: JobRecord) => Promise<void> | void> = new Map();
  private timer: any = null;
  private isTicking: boolean = false;
  private checkIntervalMs: number;

  constructor(
    private db: DBExecutable,
    options: JobSchedulerOptions = {}
  ) {
    this.checkIntervalMs = options.checkIntervalMs ?? 30000;
  }

  async initialize(): Promise<void> {
    await JobStore.ensureSchema(this.db);
  }

  /**
   * Registers a background recurring job and stores its schedule in SQLite.
   */
  async register(job: JobDefinition): Promise<JobRecord> {
    const intervalMs = parseScheduleToIntervalMs(job.schedule);
    const now = Date.now();
    const nextRunAt = calculateNextRun(job.schedule, now);

    const record: JobRecord = {
      id: job.id,
      name: job.name || job.id,
      schedule: typeof job.schedule === 'string' ? job.schedule : `${intervalMs}ms`,
      intervalMs,
      lastRunAt: null,
      nextRunAt,
      enabled: job.enabled !== false,
      payload: job.payload,
      createdAt: now,
    };

    if (job.handler) {
      this.handlers.set(job.id, job.handler);
    }

    await JobStore.upsertJob(this.db, undefined, record);
    return record;
  }

  /**
   * Attaches or updates a handler function for an already registered job id.
   */
  setHandler(jobId: string, handler: (job: JobRecord) => Promise<void> | void): void {
    this.handlers.set(jobId, handler);
  }

  /**
   * Removes a job from schedule and handlers.
   */
  async unregister(jobId: string): Promise<void> {
    this.handlers.delete(jobId);
    await JobStore.deleteJob(this.db, undefined, jobId);
  }

  /**
   * Enables a paused job.
   */
  async enable(jobId: string): Promise<void> {
    await JobStore.setJobEnabled(this.db, undefined, jobId, true);
  }

  /**
   * Disables/pauses a job.
   */
  async disable(jobId: string): Promise<void> {
    await JobStore.setJobEnabled(this.db, undefined, jobId, false);
  }

  /**
   * Manually triggers a job immediately, logging execution in run history.
   */
  async trigger(jobId: string): Promise<JobRunRecord> {
    const job = await JobStore.getJob(this.db, undefined, jobId);
    if (!job) {
      throw new Error(`Job "${jobId}" not found.`);
    }

    const runId = generateUUID();
    const startedAt = Date.now();

    const runRecord: JobRunRecord = {
      id: runId,
      jobId,
      status: 'RUNNING',
      startedAt,
      finishedAt: null,
      durationMs: null,
    };

    await JobStore.recordRunStart(this.db, undefined, runRecord);

    const handler = this.handlers.get(jobId);
    let runStatus: 'SUCCESS' | 'FAILED' = 'SUCCESS';
    let runError: string | null = null;

    try {
      if (handler) {
        await handler(job);
      }
    } catch (err: any) {
      runStatus = 'FAILED';
      runError = err?.message || String(err);
    }

    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;

    await JobStore.recordRunFinish(
      this.db,
      undefined,
      runId,
      runStatus,
      finishedAt,
      durationMs,
      runError
    );

    const nextRunAt = calculateNextRun(job.schedule, finishedAt);
    await JobStore.updateJobSchedule(this.db, undefined, jobId, finishedAt, nextRunAt);

    return {
      id: runId,
      jobId,
      status: runStatus,
      startedAt,
      finishedAt,
      durationMs,
      error: runError,
    };
  }

  /**
   * Checks for due jobs and executes them. Safe against reentrant concurrent ticks.
   */
  async tick(): Promise<number> {
    if (this.isTicking) return 0;
    this.isTicking = true;

    try {
      const now = Date.now();
      const dueJobs = await JobStore.getDueJobs(this.db, undefined, now);
      if (dueJobs.length === 0) return 0;

      let executed = 0;
      for (const job of dueJobs) {
        try {
          await this.trigger(job.id);
          executed++;
        } catch {
          // Failure logged in trigger; continue next job
        }
      }
      return executed;
    } finally {
      this.isTicking = false;
    }
  }

  /**
   * Starts periodic background ticker.
   */
  start(intervalMs?: number): void {
    if (this.timer) return;
    const interval = intervalMs ?? this.checkIntervalMs;
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, interval);
    if (typeof this.timer?.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Stops the background periodic ticker.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Returns all scheduled jobs.
   */
  async getJobs(): Promise<JobRecord[]> {
    return await JobStore.getAllJobs(this.db);
  }

  /**
   * Returns run history for a specific job or all jobs.
   */
  async getHistory(jobId?: string, limit: number = 50): Promise<JobRunRecord[]> {
    return await JobStore.getRuns(this.db, undefined, jobId, limit);
  }

  /**
   * Prunes historical run logs older than the given age in milliseconds (default: 30 days).
   */
  async pruneHistory(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
    const cutoff = Date.now() - maxAgeMs;
    await JobStore.pruneRuns(this.db, undefined, cutoff);
  }
}
