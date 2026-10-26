import { ScheduleType } from './types.js';

export function parseScheduleToIntervalMs(schedule: ScheduleType): number {
  if (typeof schedule === 'object' && schedule !== null && 'intervalMs' in schedule) {
    return Math.max(1000, Number(schedule.intervalMs) || 60000);
  }

  if (typeof schedule === 'number') {
    return Math.max(1000, schedule);
  }

  const str = String(schedule).trim().toLowerCase();

  if (str === 'hourly') return 60 * 60 * 1000;
  if (str === 'daily') return 24 * 60 * 60 * 1000;
  if (str === 'weekly') return 7 * 24 * 60 * 60 * 1000;

  // 'every X seconds/minutes/hours/days'
  const match = str.match(/^every\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?|d|days?)$/i);
  if (match) {
    const val = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit.startsWith('s')) return val * 1000;
    if (unit.startsWith('m')) return val * 60 * 1000;
    if (unit.startsWith('h')) return val * 60 * 60 * 1000;
    if (unit.startsWith('d')) return val * 24 * 60 * 60 * 1000;
  }

  // 5-field cron expression: min hour dom month dow
  const parts = str.split(/\s+/);
  if (parts.length === 5) {
    // If it's */n in minutes
    if (parts[0].startsWith('*/')) {
      const step = parseInt(parts[0].slice(2), 10);
      if (!isNaN(step) && step > 0) {
        return step * 60 * 1000;
      }
    }
    // If it's */n in hours (e.g. 0 */2 * * *)
    if (parts[1].startsWith('*/')) {
      const step = parseInt(parts[1].slice(2), 10);
      if (!isNaN(step) && step > 0) {
        return step * 60 * 60 * 1000;
      }
    }
    // Default fallback for daily cron like 0 9 * * * or 0 0 * * *
    return 24 * 60 * 60 * 1000;
  }

  // Default fallback: 1 hour
  return 60 * 60 * 1000;
}

/**
 * Calculates next run timestamp given schedule and last run (or current) timestamp.
 */
export function calculateNextRun(schedule: ScheduleType, fromTimestamp: number = Date.now()): number {
  const interval = parseScheduleToIntervalMs(schedule);
  return fromTimestamp + interval;
}
