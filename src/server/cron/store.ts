import { quoteIdent, type SqlExecutor } from '../sqlDialect.js';
import type {
  CronJobPatch,
  CronJobRecord,
  CronRunRecord,
  CronStoreAdapter,
} from './types.js';

export interface SqlCronStoreOptions {
  schedulesTable?: string;
  runsTable?: string;
  maxHistoryPerJob?: number;
}

/**
 * SQL-backed `CronStoreAdapter` with crash-safe lease locks (`locked_until`)
 * and bounded per-job execution history (`_server_cron_runs`).
 */
export function createSqlCronStore(
  executor: SqlExecutor,
  options: SqlCronStoreOptions | string = {},
): CronStoreAdapter {
  const opts =
    typeof options === 'string' ? { schedulesTable: options } : options;
  const schedulesTable = opts.schedulesTable || '_server_cron_schedules';
  const runsTable = opts.runsTable || '_server_cron_runs';
  const maxHistoryPerJob = Math.max(opts.maxHistoryPerJob ?? 50, 1);

  const tbl = quoteIdent(schedulesTable, executor.dialect);
  const runsTbl = quoteIdent(runsTable, executor.dialect);
  let schemaEnsured = false;

  const mapRow = (r: any): Omit<CronJobRecord, 'nextRunAt'> => ({
    jobKey: String(r.job_key),
    label: String(r.label || r.job_key),
    description: String(r.description || ''),
    cron: r.cron_expr ? String(r.cron_expr) : null,
    intervalHours: Math.max(Number(r.interval_hours || 24), 1),
    runHour:
      r.run_hour === null || r.run_hour === undefined
        ? null
        : Number(r.run_hour),
    timezone: r.timezone ? String(r.timezone) : null,
    enabled: Boolean(Number(r.enabled ?? 1)),
    builtIn: Boolean(Number(r.built_in ?? 0)),
    lastRunAt: r.last_run_at ? Number(r.last_run_at) : null,
    lockedUntil: r.locked_until ? Number(r.locked_until) : null,
    consecutiveFailures: Number(r.consecutive_failures ?? 0),
    lastStatus: r.last_status ? String(r.last_status) : null,
    lastSummary: r.last_summary ? String(r.last_summary) : null,
    lastDurationMs:
      r.last_duration_ms != null ? Number(r.last_duration_ms) : null,
    updatedAt: Number(r.updated_at || 0),
  });

  const mapRun = (r: any): CronRunRecord => ({
    id: String(r.id),
    jobKey: String(r.job_key),
    startedAt: Number(r.started_at || 0),
    finishedAt: Number(r.finished_at || 0),
    durationMs: Number(r.duration_ms || 0),
    status: r.status === 'error' ? 'error' : 'success',
    summary: String(r.summary || ''),
    attempt: Number(r.attempt || 1),
    manual: Boolean(Number(r.manual ?? 0)),
  });

  return {
    async ensureSchema() {
      if (schemaEnsured) return;
      await executor.execute(
        `CREATE TABLE IF NOT EXISTS ${tbl} (
          job_key VARCHAR(128) PRIMARY KEY,
          label VARCHAR(255) NOT NULL,
          description TEXT,
          cron_expr VARCHAR(128) NULL,
          interval_hours INT NOT NULL DEFAULT 24,
          run_hour INT NULL,
          timezone VARCHAR(64) NULL,
          enabled TINYINT NOT NULL DEFAULT 1,
          built_in TINYINT NOT NULL DEFAULT 0,
          last_run_at BIGINT NULL,
          locked_until BIGINT NULL,
          consecutive_failures INT NOT NULL DEFAULT 0,
          last_status VARCHAR(32) NULL,
          last_summary TEXT NULL,
          last_duration_ms INT NULL,
          updated_at BIGINT NOT NULL
        )`,
      );
      await executor.execute(
        `CREATE TABLE IF NOT EXISTS ${runsTbl} (
          id VARCHAR(64) PRIMARY KEY,
          job_key VARCHAR(128) NOT NULL,
          started_at BIGINT NOT NULL,
          finished_at BIGINT NOT NULL,
          duration_ms INT NOT NULL,
          status VARCHAR(16) NOT NULL,
          summary TEXT,
          attempt INT NOT NULL DEFAULT 1,
          manual TINYINT NOT NULL DEFAULT 0
        )`,
      );
      schemaEnsured = true;
    },
    async list() {
      const rows = await executor.query(
        `SELECT * FROM ${tbl} ORDER BY built_in DESC, label ASC`,
      );
      return rows.map(mapRow);
    },
    async get(jobKey) {
      const rows = await executor.query(
        `SELECT * FROM ${tbl} WHERE job_key = ? LIMIT 1`,
        [jobKey],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    },
    async seedIfMissing(job) {
      const existing = await executor.query(
        `SELECT job_key FROM ${tbl} WHERE job_key = ? LIMIT 1`,
        [job.jobKey],
      );
      if (existing.length > 0) return;
      await executor.execute(
        `INSERT INTO ${tbl}
          (job_key, label, description, cron_expr, interval_hours, run_hour, timezone, enabled, built_in, last_run_at, locked_until, consecutive_failures, last_status, last_summary, last_duration_ms, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          job.jobKey,
          job.label,
          job.description,
          job.cron,
          job.intervalHours,
          job.runHour,
          job.timezone,
          job.enabled ? 1 : 0,
          job.builtIn ? 1 : 0,
          job.lastRunAt,
          job.lockedUntil,
          job.consecutiveFailures,
          job.lastStatus,
          job.lastSummary,
          job.lastDurationMs,
          job.updatedAt,
        ],
      );
    },
    async update(jobKey, patch: CronJobPatch) {
      const sets: string[] = [];
      const params: any[] = [];
      if (patch.label !== undefined) {
        sets.push('label = ?');
        params.push(patch.label);
      }
      if (patch.description !== undefined) {
        sets.push('description = ?');
        params.push(patch.description);
      }
      if (patch.cron !== undefined) {
        sets.push('cron_expr = ?');
        params.push(patch.cron);
      }
      if (patch.intervalHours !== undefined) {
        sets.push('interval_hours = ?');
        params.push(Math.max(Math.trunc(patch.intervalHours), 1));
      }
      if (patch.runHour !== undefined) {
        sets.push('run_hour = ?');
        params.push(
          patch.runHour === null
            ? null
            : Math.min(Math.max(Math.trunc(patch.runHour), 0), 23),
        );
      }
      if (patch.timezone !== undefined) {
        sets.push('timezone = ?');
        params.push(patch.timezone);
      }
      if (patch.enabled !== undefined) {
        sets.push('enabled = ?');
        params.push(patch.enabled ? 1 : 0);
      }
      if (!sets.length) return;
      sets.push('updated_at = ?');
      params.push(Date.now(), jobKey);
      await executor.execute(
        `UPDATE ${tbl} SET ${sets.join(', ')} WHERE job_key = ?`,
        params,
      );
    },
    async delete(jobKey) {
      await executor.execute(`DELETE FROM ${tbl} WHERE job_key = ?`, [jobKey]);
      await executor.execute(`DELETE FROM ${runsTbl} WHERE job_key = ?`, [
        jobKey,
      ]);
    },
    async claim(jobKey, now, lockTimeoutMs) {
      const lockedUntil = now + Math.max(lockTimeoutMs, 1000);
      const res = await executor.execute(
        `UPDATE ${tbl}
         SET locked_until = ?, last_status = 'running', updated_at = ?
         WHERE job_key = ? AND enabled = 1 AND (locked_until IS NULL OR locked_until <= ?)`,
        [lockedUntil, now, jobKey, now],
      );
      return res.affectedRows > 0;
    },
    async recordRun(jobKey, run) {
      await executor.execute(
        `UPDATE ${tbl}
         SET last_run_at = ?, locked_until = NULL,
             consecutive_failures = CASE WHEN ? = 'success' THEN 0 ELSE consecutive_failures + 1 END,
             last_status = ?, last_summary = ?, last_duration_ms = ?, updated_at = ?
         WHERE job_key = ?`,
        [
          run.finishedAt,
          run.status,
          run.status,
          run.summary,
          run.durationMs,
          Date.now(),
          jobKey,
        ],
      );
      await executor.execute(
        `INSERT INTO ${runsTbl}
          (id, job_key, started_at, finished_at, duration_ms, status, summary, attempt, manual)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          run.id,
          run.jobKey,
          run.startedAt,
          run.finishedAt,
          run.durationMs,
          run.status,
          run.summary,
          run.attempt,
          run.manual ? 1 : 0,
        ],
      );
      const existing = await executor.query(
        `SELECT id FROM ${runsTbl} WHERE job_key = ? ORDER BY started_at DESC`,
        [jobKey],
      );
      if (existing.length > maxHistoryPerJob) {
        const toRemove = existing.slice(maxHistoryPerJob);
        for (const row of toRemove) {
          await executor.execute(`DELETE FROM ${runsTbl} WHERE id = ?`, [
            row.id,
          ]);
        }
      }
    },
    async getHistory(jobKey, limit = 25) {
      const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
      const rows = jobKey
        ? await executor.query(
            `SELECT * FROM ${runsTbl} WHERE job_key = ? ORDER BY started_at DESC LIMIT ?`,
            [jobKey, safeLimit],
          )
        : await executor.query(
            `SELECT * FROM ${runsTbl} ORDER BY started_at DESC LIMIT ?`,
            [safeLimit],
          );
      return rows.map(mapRun);
    },
  };
}

/** In-memory `CronStoreAdapter` with lease locks and bounded run history. */
export function createMemoryCronStore(maxHistoryPerJob = 50): CronStoreAdapter {
  const jobs = new Map<string, Omit<CronJobRecord, 'nextRunAt'>>();
  const runs: CronRunRecord[] = [];

  return {
    async list() {
      return [...jobs.values()];
    },
    async get(jobKey) {
      return jobs.get(jobKey) ?? null;
    },
    async seedIfMissing(job) {
      if (!jobs.has(job.jobKey)) jobs.set(job.jobKey, { ...job });
    },
    async update(jobKey, patch) {
      const existing = jobs.get(jobKey);
      if (!existing) return;
      jobs.set(jobKey, {
        ...existing,
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.cron !== undefined ? { cron: patch.cron } : {}),
        ...(patch.intervalHours !== undefined
          ? { intervalHours: Math.max(Math.trunc(patch.intervalHours), 1) }
          : {}),
        ...(patch.runHour !== undefined ? { runHour: patch.runHour } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        updatedAt: Date.now(),
      });
    },
    async delete(jobKey) {
      jobs.delete(jobKey);
      for (let i = runs.length - 1; i >= 0; i--) {
        if (runs[i].jobKey === jobKey) runs.splice(i, 1);
      }
    },
    async claim(jobKey, now, lockTimeoutMs) {
      const job = jobs.get(jobKey);
      if (!job || !job.enabled) return false;
      if (job.lockedUntil && job.lockedUntil > now) return false;
      job.lockedUntil = now + Math.max(lockTimeoutMs, 1000);
      job.lastStatus = 'running';
      job.updatedAt = now;
      return true;
    },
    async recordRun(jobKey, run) {
      const job = jobs.get(jobKey);
      if (job) {
        job.lastRunAt = run.finishedAt;
        job.lockedUntil = null;
        job.consecutiveFailures =
          run.status === 'success' ? 0 : job.consecutiveFailures + 1;
        job.lastStatus = run.status;
        job.lastSummary = run.summary;
        job.lastDurationMs = run.durationMs;
        job.updatedAt = Date.now();
      }
      runs.unshift(run);
      let count = 0;
      for (let i = 0; i < runs.length; i++) {
        if (runs[i].jobKey === jobKey) {
          count++;
          if (count > maxHistoryPerJob) {
            runs.splice(i, 1);
            i--;
          }
        }
      }
    },
    async getHistory(jobKey, limit = 25) {
      const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
      const filtered = jobKey
        ? runs.filter((r) => r.jobKey === jobKey)
        : runs;
      return filtered.slice(0, safeLimit);
    },
  };
}
