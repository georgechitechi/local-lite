import { DBExecutable } from '../core/schema-manager.js';
import { JobRecord, JobRunRecord } from './types.js';

export const DEFAULT_JOBS_TABLE = '_local_scheduled_jobs';
export const DEFAULT_JOB_RUNS_TABLE = '_local_job_runs';

export function mapJobRow(r: any): JobRecord {
  let payload: any = undefined;
  if (r.payload) {
    try {
      payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
    } catch {
      payload = r.payload;
    }
  }

  return {
    id: r.id,
    name: r.name,
    schedule: r.schedule,
    intervalMs: Number(r.interval_ms || 0),
    lastRunAt: r.last_run_at != null ? Number(r.last_run_at) : null,
    nextRunAt: Number(r.next_run_at || 0),
    enabled: r.enabled === 1 || r.enabled === '1' || r.enabled === true,
    payload,
    createdAt: Number(r.created_at || 0),
  };
}

export function mapJobRunRow(r: any): JobRunRecord {
  return {
    id: r.id,
    jobId: r.job_id,
    status: r.status,
    startedAt: Number(r.started_at || 0),
    finishedAt: r.finished_at != null ? Number(r.finished_at) : null,
    durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
    error: r.error || null,
  };
}

export class JobStore {
  static async ensureSchema(
    db: DBExecutable,
    jobsTable: string = DEFAULT_JOBS_TABLE,
    runsTable: string = DEFAULT_JOB_RUNS_TABLE
  ): Promise<void> {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS ${jobsTable} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        schedule TEXT NOT NULL,
        interval_ms INTEGER NOT NULL,
        last_run_at INTEGER,
        next_run_at INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        payload TEXT,
        created_at INTEGER NOT NULL
      );`
    );

    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_${jobsTable}_next ON ${jobsTable} (next_run_at);`
    );

    await db.execute(
      `CREATE TABLE IF NOT EXISTS ${runsTable} (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        duration_ms INTEGER,
        error TEXT
      );`
    );

    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_${runsTable}_job ON ${runsTable} (job_id, started_at);`
    );
  }

  static async upsertJob(
    db: DBExecutable,
    jobsTable: string = DEFAULT_JOBS_TABLE,
    job: JobRecord
  ): Promise<void> {
    const payloadStr = job.payload !== undefined ? JSON.stringify(job.payload) : null;
    await db.execute(
      `INSERT INTO ${jobsTable} (id, name, schedule, interval_ms, last_run_at, next_run_at, enabled, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         schedule = excluded.schedule,
         interval_ms = excluded.interval_ms,
         last_run_at = excluded.last_run_at,
         next_run_at = excluded.next_run_at,
         enabled = excluded.enabled,
         payload = excluded.payload;`,
      [
        job.id,
        job.name,
        job.schedule,
        job.intervalMs,
        job.lastRunAt ?? null,
        job.nextRunAt,
        job.enabled ? 1 : 0,
        payloadStr,
        job.createdAt,
      ]
    );
  }

  static async getJob(
    db: DBExecutable,
    jobsTable: string = DEFAULT_JOBS_TABLE,
    id: string
  ): Promise<JobRecord | null> {
    const rows = await db.execute(`SELECT * FROM ${jobsTable} WHERE id = ? LIMIT 1;`, [id]);
    if (!rows || rows.length === 0) return null;
    return mapJobRow(rows[0]);
  }

  static async getAllJobs(
    db: DBExecutable,
    jobsTable: string = DEFAULT_JOBS_TABLE
  ): Promise<JobRecord[]> {
    const rows = await db.execute(`SELECT * FROM ${jobsTable} ORDER BY next_run_at ASC;`);
    return (rows || []).map(mapJobRow);
  }

  static async getDueJobs(
    db: DBExecutable,
    jobsTable: string = DEFAULT_JOBS_TABLE,
    now: number = Date.now()
  ): Promise<JobRecord[]> {
    const rows = await db.execute(
      `SELECT * FROM ${jobsTable} WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC;`,
      [now]
    );
    return (rows || []).map(mapJobRow);
  }

  static async updateJobSchedule(
    db: DBExecutable,
    jobsTable: string = DEFAULT_JOBS_TABLE,
    id: string,
    lastRunAt: number,
    nextRunAt: number
  ): Promise<void> {
    await db.execute(
      `UPDATE ${jobsTable} SET last_run_at = ?, next_run_at = ? WHERE id = ?;`,
      [lastRunAt, nextRunAt, id]
    );
  }

  static async setJobEnabled(
    db: DBExecutable,
    jobsTable: string = DEFAULT_JOBS_TABLE,
    id: string,
    enabled: boolean
  ): Promise<void> {
    await db.execute(`UPDATE ${jobsTable} SET enabled = ? WHERE id = ?;`, [enabled ? 1 : 0, id]);
  }

  static async deleteJob(
    db: DBExecutable,
    jobsTable: string = DEFAULT_JOBS_TABLE,
    id: string
  ): Promise<void> {
    await db.execute(`DELETE FROM ${jobsTable} WHERE id = ?;`, [id]);
  }

  // --- Run History ---

  static async recordRunStart(
    db: DBExecutable,
    runsTable: string = DEFAULT_JOB_RUNS_TABLE,
    run: JobRunRecord
  ): Promise<void> {
    await db.execute(
      `INSERT INTO ${runsTable} (id, job_id, status, started_at, finished_at, duration_ms, error)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [run.id, run.jobId, run.status, run.startedAt, null, null, null]
    );
  }

  static async recordRunFinish(
    db: DBExecutable,
    runsTable: string = DEFAULT_JOB_RUNS_TABLE,
    id: string,
    status: 'SUCCESS' | 'FAILED',
    finishedAt: number,
    durationMs: number,
    error?: string | null
  ): Promise<void> {
    await db.execute(
      `UPDATE ${runsTable} SET status = ?, finished_at = ?, duration_ms = ?, error = ? WHERE id = ?;`,
      [status, finishedAt, durationMs, error ?? null, id]
    );
  }

  static async getRuns(
    db: DBExecutable,
    runsTable: string = DEFAULT_JOB_RUNS_TABLE,
    jobId?: string,
    limit: number = 50
  ): Promise<JobRunRecord[]> {
    let rows: any[];
    if (jobId) {
      rows = await db.execute(
        `SELECT * FROM ${runsTable} WHERE job_id = ? ORDER BY started_at DESC LIMIT ?;`,
        [jobId, limit]
      );
    } else {
      rows = await db.execute(
        `SELECT * FROM ${runsTable} ORDER BY started_at DESC LIMIT ?;`,
        [limit]
      );
    }
    return (rows || []).map(mapJobRunRow);
  }

  static async pruneRuns(
    db: DBExecutable,
    runsTable: string = DEFAULT_JOB_RUNS_TABLE,
    cutoffTimestamp: number
  ): Promise<void> {
    await db.execute(`DELETE FROM ${runsTable} WHERE started_at < ?;`, [cutoffTimestamp]);
  }
}
