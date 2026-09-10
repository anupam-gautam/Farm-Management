// /api/cron/purge-photos — 7-day photo lifecycle.
//
//   GET  — invoked daily by Vercel Cron (see vercel.json). Authenticated via
//          the Authorization: Bearer <CRON_SECRET> header Vercel attaches.
//   POST — manual "purge now" from owner settings, authenticated via the
//          owner guard key instead.

import { getStore } from '../_lib/store.js';
import { checkOwnerGuard } from '../_lib/guard.js';
import { purgeExpiredPhotos } from '../_lib/purge.js';

export default async function handler(req, res) {
  const store = await getStore();

  if (req.method === 'GET') {
    // Vercel Cron path.
    const secret = process.env.CRON_SECRET;
    const presented = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    if (!secret || presented !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  } else if (req.method === 'POST') {
    // Manual trigger from owner settings.
    const denied = await checkOwnerGuard(req, store);
    if (denied) return res.status(denied.status).json({ error: denied.error });
  } else {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const result = await purgeExpiredPhotos(store);
  return res.status(200).json({ ok: true, ...result });
}
