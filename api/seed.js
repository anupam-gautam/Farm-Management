// POST /api/seed — demo data load or factory reset (owner guard).
//
//   { action: 'demo' }  — replace all data with a realistic demo dataset
//   { action: 'reset' } — wipe everything and re-seed bootstrap accounts only

import seed from '../data/credentials.seed.json' with { type: 'json' };
import { getStore } from './_lib/store.js';
import { checkOwnerGuard } from './_lib/guard.js';
import { buildDemoBackup } from './_lib/demo.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const store = await getStore();
  const denied = await checkOwnerGuard(req, store);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  const { action } = req.body || {};

  if (action === 'demo') {
    const accounts = await store.listAccounts();
    const backup = buildDemoBackup(accounts);
    await store.importBackup(backup);
    return res.status(200).json({ ok: true, action: 'demo' });
  }

  if (action === 'reset') {
    await store.factoryReset(seed.accounts);
    return res.status(200).json({ ok: true, action: 'reset' });
  }

  return res.status(400).json({ error: 'unknown_action' });
}
