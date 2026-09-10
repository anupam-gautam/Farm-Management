// POST /api/complete — mark an occurrence completed.
//
// THE 30-MINUTE RULE, enforced server-side (PLAN §2.2):
// an occurrence cannot be completed while its due time is more than 30
// minutes in the future. The server clock is authoritative — the client's
// skew-corrected check is only a UX convenience.
//
// Body: { occurrenceId, note?, photoKey? }
// Headers: x-account-id (must be the worker the task is assigned to)
//
// Responses:
//   200 { ok, logId }                 — completed; append-only log written
//   422 { error: 'too_early', unlocksAt } — outside the window
//   422 { error: 'photo_required' }   — task demands photo proof, none given
//   403 / 404 / 409                   — wrong worker / unknown / already done

import { getStore } from './_lib/store.js';
import { isAssignedTo } from './_lib/assignees.js';

const WINDOW_MS = 30 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const store = await getStore();
  const { occurrenceId, note, photoKey } = req.body || {};
  const accountId = req.headers['x-account-id'];

  if (!accountId) return res.status(401).json({ error: 'unauthorized' });
  if (!occurrenceId) return res.status(400).json({ error: 'invalid_input' });

  const occurrence = await store.getOccurrence(occurrenceId);
  if (!occurrence) return res.status(404).json({ error: 'not_found' });

  const tasks = await store.listTasks();
  const task = tasks.find((t) => t.id === occurrence.task_id);
  if (!task) return res.status(404).json({ error: 'not_found' });

  // Only an assigned worker may complete it.
  if (!isAssignedTo(task, accountId)) {
    return res.status(403).json({ error: 'wrong_worker' });
  }

  if (occurrence.status !== 'pending') {
    return res.status(409).json({ error: 'already_completed' });
  }

  // --- the rule -------------------------------------------------------------
  const nowMs = Date.now(); // server clock — authoritative
  const dueMs = new Date(occurrence.due_at).getTime();
  const unlocksAtMs = dueMs - WINDOW_MS;
  if (nowMs < unlocksAtMs) {
    return res.status(422).json({
      error: 'too_early',
      unlocksAt: new Date(unlocksAtMs).toISOString(),
    });
  }

  // --- mandatory photo proof ----------------------------------------------------
  if (task.photo_required && !photoKey) {
    return res.status(422).json({ error: 'photo_required' });
  }

  // --- complete ---------------------------------------------------------------
  const accounts = await store.listAccounts();
  const worker = accounts.find((a) => a.id === accountId);

  const log = await store.insertCompletionLog({
    occurrence_id: occurrence.id,
    task_id: task.id,
    task_title_snapshot: task.title, // history survives task edits/deletes
    completed_at: new Date(nowMs).toISOString(),
    completed_by: accountId,
    completed_by_name: worker?.display_name ?? accountId,
    worker_note: String(note ?? '').slice(0, 1000),
    photo_blob_key: photoKey || null,
    photo_status: photoKey ? 'stored' : 'none',
  });

  await store.setOccurrenceStatus(occurrence.id, 'completed');

  return res.status(200).json({ ok: true, logId: log.id });
}
