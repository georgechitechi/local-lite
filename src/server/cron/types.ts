export type CronJobResult =
  | { summary?: string; [key: string]: any }
  | string
  | void;

export interface CronJobContext {
  now: number;
  manual: boolean;
  jobKey: string;
  attempt: number;
}

export interface CronJobDefinition {
  key: string;
  label: string;
  description?: string;
  /** Standard 5-field cron expression (e.g. `'0 3 * * *'`, `'0,15,30,45 * * * *'`) or shortcut (`'hourly'`, `'daily'`, `'weekly'`). */
  cron?: string | null;
  /** Fallback interval in hours when `cron` is not set. Default: 24. */
  intervalHours?: number;
  /** Optional hour of day (0-23) when `cron` is not set. */
  runHour?: number | null;
  /** IANA timezone (e.g. `'Africa/Nairobi'`, `'UTC'`). Defaults to server local timezone. */
  timezone?: string | null;
  /** Per-attempt execution timeout in ms. Default: 60_000 (1 min). */
  timeoutMs?: number;
  /** Max automatic retries on failure (excluding initial attempt). Default: 0. */
  maxRetries?: number;
  /** Base retry delay in ms (exponential backoff). Default: 1000. */
  retryDelayMs?: number;
  /** Lease duration in ms to recover crashed jobs. Default: 5 * 60_000 (5 min). */
  lockTimeoutMs?: number;
  enabled?: boolean;
  builtIn?: boolean;
  handler: (context: CronJobContext) => Promise<CronJobResult> | CronJobResult;
}

export interface CronJobRecord {
  jobKey: string;
  label: string;
  description: string;
  cron: string | null;
  intervalHours: number;
  runHour: number | null;
  timezone: string | null;
  enabled: boolean;
  builtIn: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lockedUntil: number | null;
  consecutiveFailures: number;
  lastStatus: string | null;
  lastSummary: string | null;
  lastDurationMs: number | null;
  updatedAt: number;
}

export interface CronRunRecord {
  id: string;
  jobKey: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  status: 'success' | 'error';
  summary: string;
  attempt: number;
  manual: boolean;
}

export interface CronJobPatch {
  label?: string;
  description?: string;
  cron?: string | null;
  intervalHours?: number;
  runHour?: number | null;
  timezone?: string | null;
  enabled?: boolean;
}

export interface CronRunOutcome {
  ok: boolean;
  jobKey: string;
  status: 'success' | 'error';
  summary: string;
  durationMs: number;
  attempts: number;
  runAt: number;
  nextRunAt: number | null;
  result?: Record<string, any>;
}

export interface CronStoreAdapter {
  ensureSchema?(): Promise<void>;
  list(): Promise<Omit<CronJobRecord, 'nextRunAt'>[]>;
  get(jobKey: string): Promise<Omit<CronJobRecord, 'nextRunAt'> | null>;
  seedIfMissing(job: Omit<CronJobRecord, 'nextRunAt'>): Promise<void>;
  update(jobKey: string, patch: CronJobPatch): Promise<void>;
  delete(jobKey: string): Promise<void>;
  /** Atomically acquires a lease on `jobKey` until `now + lockTimeoutMs`. */
  claim(jobKey: string, now: number, lockTimeoutMs: number): Promise<boolean>;
  /** Records a completed run, releases the lease, and appends to run history. */
  recordRun(
    jobKey: string,
    run: CronRunRecord,
  ): Promise<void>;
  getHistory(jobKey?: string, limit?: number): Promise<CronRunRecord[]>;
}

export interface CronSchedulerOptions {
  store?: CronStoreAdapter;
  /** Default IANA timezone for jobs that don't specify one. */
  defaultTimezone?: string | null;
  /** Interval for the background ticker in ms. Default: 60_000 (1 minute). */
  tickIntervalMs?: number;
  /** Whether the background ticker is allowed to start. Default: true. */
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

export interface ServerCronScheduler {
  register(def: CronJobDefinition): ServerCronScheduler;
  ensureJobs(): Promise<void>;
  list(now?: number): Promise<CronJobRecord[]>;
  getHistory(jobKey?: string, limit?: number): Promise<CronRunRecord[]>;
  update(jobKey: string, patch: CronJobPatch): Promise<CronJobRecord | null>;
  delete(jobKey: string): Promise<void>;
  runNow(jobKey: string, now?: number): Promise<CronRunOutcome>;
  runDue(now?: number): Promise<string[]>;
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export interface CronEndpointOptions {
  scheduler: ServerCronScheduler;
  authenticate?: (request: Request) => Promise<boolean> | boolean;
}
