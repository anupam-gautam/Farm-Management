// GET /api/logs — completion logs, newest first.
// Powers the owner photo gallery (Phase 5), history and analytics (Phase 8).
// Read-only; logs are append-only and never deleted.

import { getStore } from './_lib/store.js';
import { parseRangeQuery } from './_lib/range.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const parsed = parseRangeQuery(req.query);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const store = await getStore();
  const opts = parsed.useDefault ? {} : { fromIso: parsed.fromIso, toIso: parsed.toIso };
  let logs = await store.listCompletionLogs(opts);

  const worker = req.query?.worker;
  if (worker) {
    logs = logs.filter((l) => l.completed_by_name === worker || l.completed_by === worker);
  }

  // File backend returns insertion order; normalise to newest-first.
  logs.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
  return res.status(200).json({ logs, serverTime: new Date().toISOString() });
}
