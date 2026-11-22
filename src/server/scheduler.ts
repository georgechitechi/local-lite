import { quoteIdent, type SqlExecutor } from './sqlDialect.js';

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
