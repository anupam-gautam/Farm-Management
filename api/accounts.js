// /api/accounts — account listing and management.
//
//   GET                     → list all accounts (incl. hashes — client-side auth
//                             compares them in the browser, per accepted design)
//   POST { action: 'create', username, displayName, passwordHash, salt, iterations }
//                         → create a worker account (owner guard)
//   POST { action: 'update', id, displayName?, active? }
//                         → rename / activate / deactivate (owner guard)
//   POST { action: 'setPassword', id, passwordHash, salt, iterations, mustChangePassword }
//                         → set a password (self-service or owner guard)
//
// The client always hashes — plaintext passwords never cross the wire.

import { getStore } from './_lib/store.js';
import { checkOwnerGuard, checkSelfOrOwnerGuard, newId } from './_lib/guard.js';

const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/i;
const HEX_RE = /^[0-9a-f]+$/i;

function validHashMaterial(body) {
  return (
    typeof body.passwordHash === 'string' && HEX_RE.test(body.passwordHash) &&
    typeof body.salt === 'string' && HEX_RE.test(body.salt) &&
    Number.isInteger(body.iterations) && body.iterations >= 10_000
  );
}

export default async function handler(req, res) {
  const store = await getStore();

  if (req.method === 'GET') {
    const accounts = await store.listAccounts();
    return res.status(200).json({ accounts, serverTime: new Date().toISOString() });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const { action } = body;

  // ---- create worker -------------------------------------------------------
  if (action === 'create') {
    const denied = await checkOwnerGuard(req, store);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    if (!USERNAME_RE.test(body.username || '')) {
      return res.status(400).json({ error: 'invalid_username' });
    }
    if (!body.displayName || !validHashMaterial(body)) {
      return res.status(400).json({ error: 'invalid_input' });
    }
    const existing = await store.listAccounts();
    if (existing.some((a) => a.username.toLowerCase() === body.username.toLowerCase())) {
      return res.status(409).json({ error: 'username_taken' });
    }
    const account = await store.insertAccount({
      username: body.username,
      role: 'worker',
      display_name: String(body.displayName).slice(0, 64),
      hash: body.passwordHash,
      salt: body.salt,
      iterations: body.iterations,
      must_change_password: true, // worker sets their own password at first login
      active: true,
    });
    return res.status(201).json({ ok: true, id: account.id });
  }

  // ---- update (rename / activate / deactivate) ------------------------------
  if (action === 'update') {
    const denied = await checkOwnerGuard(req, store);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    const fields = {};
    if (body.displayName !== undefined) fields.display_name = String(body.displayName).slice(0, 64);
    if (body.active !== undefined) fields.active = Boolean(body.active);
    const updated = await store.updateAccount(body.id, fields);
    if (!updated) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json({ ok: true });
  }

  // ---- setPassword (self-service change or owner reset) ---------------------
  if (action === 'setPassword') {
    const denied = await checkSelfOrOwnerGuard(req, store, body.id);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    if (!validHashMaterial(body)) {
      return res.status(400).json({ error: 'invalid_input' });
    }
    const updated = await store.updateAccount(body.id, {
      hash: body.passwordHash,
      salt: body.salt,
      iterations: body.iterations,
      must_change_password: Boolean(body.mustChangePassword),
    });
    if (!updated) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'unknown_action' });
}
