// GET /api/bootstrap — idempotent initialisation.
// Creates the schema if absent, seeds accounts from data/credentials.seed.json
// into an empty database, and reports what happened. Safe to call on every
// app start; only the first call against an empty DB actually seeds.

import { getStore } from './_lib/store.js';
import seed from '../data/credentials.seed.json' with { type: 'json' };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const store = await getStore();
    const schemaVersion = await store.ensureSchema();
    const seeded = await store.seedIfEmpty(seed.accounts);
    return res.status(200).json({
      ok: true,
      backend: store.kind,
      seeded,
      schemaVersion,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error('bootstrap failed:', err);
    return res.status(500).json({ error: 'bootstrap_failed' });
  }
}
