import type { CronJobRecord } from './types.js';

interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export function getZonedParts(
  timestamp: number,
  timeZone?: string | null,
): ZonedParts {
  const date = new Date(timestamp);
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      dayOfWeek: date.getDay(),
    };
  }
  const parts = getFormatter(timeZone).formatToParts(date);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let dayOfWeek = 0;
  for (const p of parts) {
    if (p.type === 'year') year = Number(p.value);
    else if (p.type === 'month') month = Number(p.value);
    else if (p.type === 'day') day = Number(p.value);
    else if (p.type === 'hour') hour = Number(p.value) % 24;
    else if (p.type === 'minute') minute = Number(p.value);
    else if (p.type === 'weekday') dayOfWeek = WEEKDAY_MAP[p.value] ?? 0;
  }
  return { year, month, day, hour, minute, dayOfWeek };
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const rawPart of field.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Math.max(Number(stepPart), 1) : 1;
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`Invalid cron step "${part}"`);
    }
    let start = min;
    let end = max;
    if (rangePart !== '*') {
      if (rangePart.includes('-')) {
        const [a, b] = rangePart.split('-').map(Number);
        start = a;
        end = b;
      } else {
        start = Number(rangePart);
        end = stepPart ? max : start;
      }
    }
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      throw new Error(`Invalid cron field "${field}"`);
    }
    for (let v = start; v <= end; v += step) {
      values.add(v);
    }
  }
  if (values.size === 0) {
    throw new Error(`Empty cron field "${field}"`);
  }
  return values;
}

export function normalizeCronExpression(expr: string): string {
  const lower = expr.trim().toLowerCase();
  if (lower === 'hourly' || lower === '@hourly') return '0 * * * *';
  if (lower === 'daily' || lower === '@daily') return '0 0 * * *';
  if (lower === 'weekly' || lower === '@weekly') return '0 0 * * 0';
  const minMatch = /^every\s+(\d+)\s+minutes?$/.exec(lower);
  if (minMatch) return `*/${Math.max(Number(minMatch[1]), 1)} * * * *`;
  const hrMatch = /^every\s+(\d+)\s+hours?$/.exec(lower);
  if (hrMatch) return `0 */${Math.max(Number(hrMatch[1]), 1)} * * *`;
  return expr.trim();
}

export function parseCronExpression(expr: string): ParsedCron {
  const normalized = normalizeCronExpression(expr);
  const fields = normalized.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression "${expr}". Expected 5 fields (min hour dom month dow).`,
    );
  }
  return {
    minutes: parseField(fields[0], 0, 59),
    hours: parseField(fields[1], 0, 23),
    daysOfMonth: parseField(fields[2], 1, 31),
    months: parseField(fields[3], 1, 12),
    daysOfWeek: parseField(fields[4], 0, 6),
  };
}

function matchesCron(parsed: ParsedCron, parts: ZonedParts): boolean {
  return (
    parsed.minutes.has(parts.minute) &&
    parsed.hours.has(parts.hour) &&
    parsed.daysOfMonth.has(parts.day) &&
    parsed.months.has(parts.month) &&
    parsed.daysOfWeek.has(parts.dayOfWeek)
  );
}

/**
 * Finds the next timestamp (at minute precision, >= `afterMs`) matching a 5-field cron expression.
 */
export function nextCronExpressionTime(
  expr: string,
  afterMs: number,
  timeZone?: string | null,
): number {
  const parsed = parseCronExpression(expr);
  // Start at the next whole minute boundary
  let cursor = Math.ceil(afterMs / 60_000) * 60_000;
  // Search up to 366 days ahead (max ~527,040 minutes, skipping non-matching hours/days quickly)
  const limit = cursor + 366 * 24 * 60 * 60_000;
  while (cursor <= limit) {
    const parts = getZonedParts(cursor, timeZone);
    if (
      !parsed.months.has(parts.month) ||
      !parsed.daysOfMonth.has(parts.day) ||
      !parsed.daysOfWeek.has(parts.dayOfWeek)
    ) {
      // Jump forward by remaining minutes in the day (or 1 hour if near DST)
      cursor += (24 - parts.hour) * 60 * 60_000 - parts.minute * 60_000;
      continue;
    }
    if (!parsed.hours.has(parts.hour)) {
      cursor += (60 - parts.minute) * 60_000;
      continue;
    }
    if (matchesCron(parsed, parts)) {
      return cursor;
    }
    cursor += 60_000;
  }
  throw new Error(`Could not resolve next run time for cron "${expr}".`);
}

/**
 * Computes the next scheduled run timestamp for a cron job.
 */
export function computeNextCronRunAt(
  job: Pick<CronJobRecord, 'enabled' | 'cron' | 'timezone' | 'lastRunAt'>,
  now = Date.now(),
): number | null {
  if (!job.enabled) return null;
  const lastRunAt = job.lastRunAt ? Number(job.lastRunAt) : 0;
  const base = lastRunAt ? Math.max(now, lastRunAt + 60_000) : now;
  return nextCronExpressionTime(job.cron, base, job.timezone);
}

/**
 * Checks whether a job is due to execute at `now`.
 */
export function isCronJobDue(
  job: Pick<
    CronJobRecord,
    'enabled' | 'cron' | 'timezone' | 'lastRunAt' | 'lockedUntil'
  >,
  now = Date.now(),
): boolean {
  if (!job.enabled) return false;
  if (job.lockedUntil && job.lockedUntil > now) return false;
  const lastRunAt = job.lastRunAt ? Number(job.lastRunAt) : 0;
  if (!lastRunAt) {
    const parsed = parseCronExpression(job.cron);
    return matchesCron(parsed, getZonedParts(now, job.timezone));
  }
  const nextDue = nextCronExpressionTime(
    job.cron,
    lastRunAt + 60_000,
    job.timezone,
  );
  return nextDue <= now;
}
