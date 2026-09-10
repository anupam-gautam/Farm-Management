// Client-side task logic: feed fetching, status derivation, sorting, filtering.
// Recurrence expansion lives server-side (api/_lib/recurrence.js); this module
// only interprets the resulting occurrences.

import { api, serverNow } from './api.js';
import { CONFIG } from './config.js';

export async function fetchTaskFeed(range = null) {
  const qs = range ? buildRangeQuery(range) : '';
  const [taskData, alertData] = await Promise.all([
    api(`/api/tasks${qs ? `?${qs}` : ''}`),
    api('/api/alerts'),
  ]);
  return {
    tasks: taskData.tasks,
    occurrences: taskData.occurrences,
    alerts: alertData.alerts || [],
    fetchedRange: range,
  };
}

function buildRangeQuery(range) {
  const params = new URLSearchParams();
  if (range?.fromIso) params.set('from', range.fromIso);
  if (range?.toIso) params.set('to', range.toIso);
  return params.toString();
}

// ---------------------------------------------------------------------------
// The 30-minute completion rule (client mirror — server re-validates)
// ---------------------------------------------------------------------------

/**
 * Can this occurrence be completed right now?
 * Returns { allowed, unlocksAt } — unlocksAt is a Date when allowed is false.
 * Uses serverNow() (skew-corrected) so changing the phone clock doesn't help.
 */
export function canComplete(occurrence, now = serverNow()) {
  if (occurrence.status !== 'pending') return { allowed: false, unlocksAt: null };
  const unlocksAtMs =
    new Date(occurrence.due_at).getTime() - CONFIG.COMPLETION_WINDOW_MINUTES * 60_000;
  if (now.getTime() >= unlocksAtMs) return { allowed: true, unlocksAt: null };
  return { allowed: false, unlocksAt: new Date(unlocksAtMs) };
}

/** POST completion to the server (which re-validates the rule + photo gate). */
export async function completeOccurrence(occurrenceId, note, accountId, photoKey) {
  return api('/api/complete', {
    method: 'POST',
    headers: { 'x-account-id': accountId },
    body: { occurrenceId, note, photoKey },
  });
}

/**
 * Display status for an occurrence. Stored status is only pending/completed/
 * missed; 'dueSoon' and 'overdue' are derived from due_at vs server time.
 */
export function deriveStatus(occurrence, now = serverNow()) {
  if (occurrence.status === 'cancelled') return 'cancelled';
  if (occurrence.status === 'completed') return 'completed';
  if (occurrence.status === 'missed') return 'missed';
  const dueMs = new Date(occurrence.due_at).getTime();
  const nowMs = now.getTime();
  if (dueMs < nowMs) return 'overdue';
  if (dueMs - nowMs <= 60 * 60 * 1000) return 'dueSoon'; // within 1 hour
  return 'pending';
}

/**
 * Worker feed ordering: actionable items first (urgent before normal, then by
 * due time), finished items last (most recently due first).
 */
export function sortForWorkerFeed(pairs) {
  const rank = { overdue: 0, dueSoon: 1, pending: 2, completed: 3, missed: 4 };
  return [...pairs].sort((a, b) => {
    const sa = rank[deriveStatus(a.occurrence)];
    const sb = rank[deriveStatus(b.occurrence)];
    if (sa !== sb) return sa - sb;
    if (sa < 3) {
      // Actionable group: urgent first, then soonest due.
      const pa = a.task.priority === 'urgent' ? 0 : 1;
      const pb = b.task.priority === 'urgent' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return new Date(a.occurrence.due_at) - new Date(b.occurrence.due_at);
    }
    // Finished group: most recent first.
    return new Date(b.occurrence.due_at) - new Date(a.occurrence.due_at);
  });
}

/** Worker account ids assigned to a task (supports legacy single-id tasks). */
export function taskAssigneeIds(task) {
  if (task.assigned_account_ids?.length) return task.assigned_account_ids;
  return task.assigned_account_id ? [task.assigned_account_id] : [];
}

/** Whether a worker is assigned to this task. */
export function isAssignedTo(task, accountId) {
  return taskAssigneeIds(task).includes(accountId);
}

/** Join occurrences with their parent task; drops orphans defensively. */
export function joinTasks(occurrences, tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return occurrences
    .map((occurrence) => ({ occurrence, task: byId.get(occurrence.task_id) }))
    .filter((p) => p.task && p.occurrence.status !== 'cancelled');
}

/** Overview counters for the owner dashboard. */
export function countByStatus(occurrences) {
  const counts = { total: 0, pending: 0, dueSoon: 0, overdue: 0, completed: 0, missed: 0 };
  for (const o of occurrences) {
    if (o.status === 'cancelled') continue;
    counts[deriveStatus(o)]++;
    counts.total++;
  }
  return counts;
}

/** Cancel a single occurrence (skip this day of a recurring series). */
export async function cancelOccurrence(occurrenceId) {
  const { ownerGuardHeaders } = await import('./auth.js');
  return api('/api/tasks', {
    method: 'POST',
    headers: await ownerGuardHeaders(),
    body: { action: 'cancel_occurrence', occurrenceId },
  });
}
