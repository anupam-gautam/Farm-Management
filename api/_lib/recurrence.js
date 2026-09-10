// Recurrence expansion: turns task templates into concrete occurrences.
//
// Pure functions, server-side, UTC-safe (via the farm wall-clock helper).
// Idempotent by design: the caller dedupes on (task_id, due_at), so expanding
// the same window twice never creates duplicates.

import { farmNow, farmWallTimeToUtc } from './time.js';

/**
 * Expand one task template into occurrence due-times (UTC ISO strings) over
 * the rolling window. One-time tasks return their single scheduled_at.
 */
export function expandTask(task) {
  if (task.recurrence === 'none') {
    return task.scheduled_at ? [task.scheduled_at] : [];
  }

  const now = farmNow(); // shifted clock: UTC fields of this date ARE farm-local fields
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const DAYS = 9; // yesterday through +7 days
  const out = [];

  const endsAt = task.recurrence_ends_at ? new Date(task.recurrence_ends_at) : null;

  for (let i = 0; i < DAYS; i++) {
    const day = new Date(start.getTime() + i * 86_400_000);
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth();
    const d = day.getUTCDate();
    const weekday = day.getUTCDay();

    if (task.recurrence === 'weekly') {
      const weekdays = Array.isArray(task.recurrence_weekdays) ? task.recurrence_weekdays : [];
      if (!weekdays.includes(weekday)) continue;
    }
    // 'daily' → every day in the window

    const dueUtc = farmWallTimeToUtc(y, m, d, task.recurrence_time);
    if (endsAt && dueUtc.getTime() > endsAt.getTime()) continue;
    // Don't expand occurrences before the task existed.
    if (task.created_at && dueUtc.getTime() < new Date(task.created_at).getTime() - 86_400_000) continue;

    out.push(dueUtc.toISOString());
  }
  return out;
}
