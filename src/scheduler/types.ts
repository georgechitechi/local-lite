export type ScheduleType = string | { intervalMs: number };

export interface JobDefinition {
  id: string;
  name?: string;
  /**
   * Schedule expression:
   * - Human string (e.g., 'every 10 minutes', 'every 1 hour', 'daily', 'hourly')
   * - Standard 5-field cron (e.g., '* / 15 * * * *', '0 9 * * *')
   * - Object with explicit millisecond interval: { intervalMs: 60000 }
   */
  schedule: ScheduleType;
  /**
   * Function to execute when the job triggers.
   */
  handler?: (job: JobRecord) => Promise<void> | void;
  payload?: any;
  enabled?: boolean;
}

export interface JobRecord {
  id: string;
  name: string;
  schedule: string;
  intervalMs: number;
  lastRunAt: number | null;
  nextRunAt: number;
  enabled: boolean;
  payload?: any;
  createdAt: number;
}

export interface JobRunRecord {
  id: string;
  jobId: string;
  status: 'SUCCESS' | 'FAILED' | 'RUNNING';
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  error?: string | null;
}

export interface JobSchedulerOptions {
  checkIntervalMs?: number;
  autoStart?: boolean;
}
