// /api/tasks — task CRUD + occurrence feed.
//
//   GET  → { tasks, occurrences, serverTime }
//          Lazily expands recurring templates into the rolling window and
//          flips stale pending occurrences to 'missed' on every call.
//   POST { action: 'create', ...taskFields }   (owner guard)
//   POST { action: 'update', id, ...fields }   (owner guard) — future pending
//          occurrences are dropped and re-expanded from the updated template;
//          past/completed occurrences are never touched.
//   POST { action: 'delete', id }              (owner guard) — removes the
//          template and its occurrences; completion logs keep title snapshots.
//   POST { action: 'cancel_occurrence', occurrenceId } — skip one day of a series.
//   POST { action: 'fork_occurrence', occurrenceId, ...taskFields } — edit one
//          day only: creates a one-time task at that due time and cancels the
//          recurring slot so it is not re-expanded.

import { getStore } from './_lib/store.js';
import { checkOwnerGuard } from './_lib/guard.js';
import { expandTask } from './_lib/recurrence.js';
import { parseRangeQuery } from './_lib/range.js';
import { assigneeIdsFromBody, assigneeFieldsFromIds } from './_lib/assignees.js';

const MISSED_AFTER_MS = 24 * 60 * 60 * 1000; // pending → missed 24h past due
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // feed includes past 7 days

function validateTaskFields(body) {
  const errors = [];
  if (!body.title || !String(body.title).trim()) errors.push('title');
  if (!['normal', 'urgent'].includes(body.priority)) errors.push('priority');
  if (!assigneeIdsFromBody(body).length) errors.push('assignedAccountIds');
  if (!['none', 'daily', 'weekly'].includes(body.recurrence)) errors.push('recurrence');

  if (body.recurrence === 'none') {
    if (!body.scheduledAt || Number.isNaN(new Date(body.scheduledAt).getTime())) {
      errors.push('scheduledAt');
    }
  } else {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.recurrenceTime || '')) errors.push('recurrenceTime');
    if (body.recurrence === 'weekly') {
      const days = body.recurrenceWeekdays;
      if (!Array.isArray(days) || days.length === 0 ||
          !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
        errors.push('recurrenceWeekdays');
      }
    }
  }
  if (body.recurrenceEndsAt && Number.isNaN(new Date(body.recurrenceEndsAt).getTime())) {
    errors.push('recurrenceEndsAt');
  }
  return errors;
}

function taskFieldsFromBody(body) {
  return {
    title: String(body.title).trim().slice(0, 120),
    description: String(body.description ?? '').slice(0, 2000),
    scheduled_at: body.recurrence === 'none' ? new Date(body.scheduledAt).toISOString() : null,
    recurrence: body.recurrence,
    recurrence_weekdays: body.recurrence === 'weekly' ? body.recurrenceWeekdays : null,
    recurrence_time: body.recurrence === 'none' ? null : body.recurrenceTime,
    recurrence_ends_at: body.recurrenceEndsAt ? new Date(body.recurrenceEndsAt).toISOString() : null,
    priority: body.priority,
    photo_required: Boolean(body.photoRequired),
    ...assigneeFieldsFromIds(assigneeIdsFromBody(body)),
  };
}

async function validateAssignees(store, body) {
  const ids = assigneeIdsFromBody(body);
  const accounts = await store.listAccounts();
  const active = new Set(accounts.filter((a) => a.active).map((a) => a.id));
  return ids.length > 0 && ids.every((id) => active.has(id));
}

/** Expand all active recurring templates into the rolling window (idempotent). */
async function expandAll(store) {
  await store.migrateLegacyCancelledOccurrences();
  const tasks = await store.listTasks();
  const rows = [];
  for (const task of tasks) {
    if (!task.active) continue;
    const skipped = new Set(task.skipped_due_at || []);
    for (const dueIso of expandTask(task)) {
      if (skipped.has(dueIso)) continue;
      rows.push({ task_id: task.id, due_at: dueIso });
    }
  }
  if (rows.length) await store.insertOccurrencesIfMissing(rows);
  return tasks;
}

function parseBody(req) {
  const raw = req.body;
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  if (typeof raw === 'string' && raw) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

export default async function handler(req, res) {
  const store = await getStore();

  // ---- GET: feed ------------------------------------------------------------
  if (req.method === 'GET') {
    const nowIso = new Date().toISOString();
    // Expansion + missed sweep always use the full rolling window — not the filter.
    const tasks = await expandAll(store);
    await store.markMissedOccurrences(new Date(Date.now() - MISSED_AFTER_MS).toISOString());

    const parsed = parseRangeQuery(req.query);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const defaultFrom = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
    const fromIso = parsed.useDefault ? defaultFrom : parsed.fromIso;
    const toIso = parsed.useDefault ? null : parsed.toIso;
    const occurrences = await store.listOccurrences({ fromIso, toIso });
    return res.status(200).json({ tasks, occurrences, serverTime: nowIso });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const denied = await checkOwnerGuard(req, store);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  const body = parseBody(req);
  const { action } = body;

  // ---- create ---------------------------------------------------------------
  if (action === 'create') {
    const errors = validateTaskFields(body);
    if (errors.length) return res.status(400).json({ error: 'invalid_input', fields: errors });

    if (!(await validateAssignees(store, body))) {
      return res.status(400).json({ error: 'invalid_assignee' });
    }

    const task = await store.insertTask({
      ...taskFieldsFromBody(body),
      active: true,
      created_by: req.headers['x-account-id'] || 'owner',
    });
    await expandAll(store);
    return res.status(201).json({ ok: true, id: task.id });
  }

  // ---- update ---------------------------------------------------------------
  if (action === 'update') {
    const errors = validateTaskFields({ ...body, recurrence: body.recurrence });
    if (errors.length) return res.status(400).json({ error: 'invalid_input', fields: errors });

    if (!(await validateAssignees(store, body))) {
      return res.status(400).json({ error: 'invalid_assignee' });
    }

    const updated = await store.updateTask(body.id, taskFieldsFromBody(body));
    if (!updated) return res.status(404).json({ error: 'not_found' });

    // Re-expand: future pending occurrences follow the updated template;
    // past and completed occurrences are untouched.
    await store.deleteFuturePendingOccurrences(body.id, new Date().toISOString());
    await expandAll(store);
    return res.status(200).json({ ok: true });
  }

  // ---- delete entire series -------------------------------------------------
  if (action === 'delete') {
    const tasks = await store.listTasks();
    if (!tasks.some((t) => t.id === body.id)) {
      return res.status(404).json({ error: 'not_found' });
    }
    await store.deleteTask(body.id);
    return res.status(200).json({ ok: true });
  }

  // ---- cancel one occurrence (skip this day) --------------------------------
  if (action === 'cancel_occurrence') {
    if (!body.occurrenceId) {
      return res.status(400).json({ error: 'invalid_input', fields: ['occurrenceId'] });
    }
    const occurrence = await store.getOccurrence(body.occurrenceId);
    if (!occurrence) return res.status(404).json({ error: 'not_found' });
    if (occurrence.status === 'completed') {
      return res.status(400).json({ error: 'occurrence_completed' });
    }
    if (!['pending', 'missed', 'cancelled'].includes(occurrence.status)) {
      return res.status(400).json({ error: 'occurrence_not_cancellable' });
    }
    const skipped = await store.skipOccurrence(body.occurrenceId);
    if (!skipped) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json({ ok: true });
  }

  // ---- fork one occurrence into a one-time task -----------------------------
  if (action === 'fork_occurrence') {
    const occurrence = await store.getOccurrence(body.occurrenceId);
    if (!occurrence) return res.status(404).json({ error: 'not_found' });
    if (!['pending', 'missed'].includes(occurrence.status)) {
      return res.status(400).json({ error: 'occurrence_not_cancellable' });
    }

    const tasks = await store.listTasks();
    const parent = tasks.find((t) => t.id === occurrence.task_id);
    if (!parent) return res.status(404).json({ error: 'not_found' });

    const dueAt = body.scheduledAt
      ? new Date(body.scheduledAt).toISOString()
      : occurrence.due_at;

    const errors = validateTaskFields({
      ...body,
      recurrence: 'none',
      scheduledAt: dueAt,
    });
    if (errors.length) return res.status(400).json({ error: 'invalid_input', fields: errors });

    if (!(await validateAssignees(store, body))) {
      return res.status(400).json({ error: 'invalid_assignee' });
    }

    const oneTime = await store.insertTask({
      ...taskFieldsFromBody({ ...body, recurrence: 'none', scheduledAt: dueAt }),
      scheduled_at: dueAt,
      recurrence: 'none',
      recurrence_weekdays: null,
      recurrence_time: null,
      recurrence_ends_at: null,
      active: true,
      created_by: req.headers['x-account-id'] || 'owner',
    });
    await store.skipOccurrence(body.occurrenceId);
    await expandAll(store);

    return res.status(201).json({ ok: true, id: oneTime.id });
  }

  return res.status(400).json({ error: 'unknown_action' });
}
