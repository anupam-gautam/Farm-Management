// GET  /api/backup — full JSON export (owner guard)
// POST /api/backup — full overwrite import (owner guard)

import { getStore, SCHEMA_VERSION } from './_lib/store.js';
import { checkOwnerGuard } from './_lib/guard.js';

function validateBackup(body) {
  if (!body || typeof body !== 'object') return 'invalid_file';
  if (body.schemaVersion !== SCHEMA_VERSION) return 'version_mismatch';
  if (!Array.isArray(body.accounts) || body.accounts.length === 0) return 'invalid_file';
  if (!body.accounts.some((a) => a.role === 'owner')) return 'invalid_file';
  if (!Array.isArray(body.tasks)) return 'invalid_file';
  if (!Array.isArray(body.occurrences)) return 'invalid_file';
  if (!Array.isArray(body.completion_logs)) return 'invalid_file';
  if (!Array.isArray(body.alerts)) return 'invalid_file';
  for (const a of body.accounts) {
    if (!a.username || !a.hash || !a.salt || !a.role) return 'invalid_file';
  }
  return null;
}

export default async function handler(req, res) {
  const store = await getStore();

  if (req.method === 'GET') {
    const denied = await checkOwnerGuard(req, store);
    if (denied) return res.status(denied.status).json({ error: denied.error });
    const backup = await store.exportBackup();
    return res.status(200).json(backup);
  }

  if (req.method === 'POST') {
    const denied = await checkOwnerGuard(req, store);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    const err = validateBackup(req.body);
    if (err) return res.status(400).json({ error: err });

    await store.importBackup(req.body);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method_not_allowed' });
}
