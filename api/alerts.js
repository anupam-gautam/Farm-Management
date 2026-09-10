// /api/alerts — urgent priority alerts.
//
//   GET  → { alerts } active alerts (workers filter to their tasks client-side)
//   POST { action: 'raise', taskId, message? }        (owner guard)
//   POST { action: 'acknowledge', id }                (x-account-id header)

import { getStore } from './_lib/store.js';
import { checkOwnerGuard } from './_lib/guard.js';

export default async function handler(req, res) {
  const store = await getStore();

  if (req.method === 'GET') {
    const alerts = await store.listAlerts({ activeOnly: true });
    return res.status(200).json({ alerts, serverTime: new Date().toISOString() });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = req.body || {};

  // ---- raise (owner) ---------------------------------------------------------
  if (body.action === 'raise') {
    const denied = await checkOwnerGuard(req, store);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    const tasks = await store.listTasks();
    if (!tasks.some((t) => t.id === body.taskId)) {
      return res.status(404).json({ error: 'not_found' });
    }
    const alert = await store.insertAlert({
      task_id: body.taskId,
      message: String(body.message ?? '').slice(0, 300),
      raised_at: new Date().toISOString(),
      raised_by: req.headers['x-account-id'] || 'owner',
    });
    return res.status(201).json({ ok: true, id: alert.id });
  }

  // ---- acknowledge (worker) ----------------------------------------------------
  if (body.action === 'acknowledge') {
    const accountId = req.headers['x-account-id'];
    if (!accountId) return res.status(401).json({ error: 'unauthorized' });
    const acked = await store.acknowledgeAlert(body.id, accountId);
    if (!acked) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'unknown_action' });
}
