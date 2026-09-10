// Destructive-endpoint guard (PLAN §3 mitigation 3).
//
// The client derives a guard key from the owner's password hash and sends it as
// the x-owner-key header. The server recomputes and compares. This is a
// deterrent against drive-by scans, NOT a real security boundary — the account
// list (including hashes) is world-readable by design decision, so anyone can
// derive this key. Phase 10 replaces this with proper server-side sessions.

import { createHash, randomUUID } from 'node:crypto';

// Must match GUARD_SUFFIX in src/auth.js exactly.
export const GUARD_SUFFIX = '|farm-guard';

export function computeGuardKey(ownerHash) {
  return createHash('sha256').update(ownerHash + GUARD_SUFFIX).digest('hex');
}

/** Returns null if the guard passes, or a {status, error} object to send back. */
export async function checkOwnerGuard(req, store) {
  const accounts = await store.listAccounts();
  const owner = accounts.find((a) => a.role === 'owner');
  if (!owner) return { status: 500, error: 'no_owner_account' };
  const presented = req.headers['x-owner-key'];
  if (!presented || presented !== computeGuardKey(owner.hash)) {
    return { status: 401, error: 'unauthorized' };
  }
  return null;
}

/** Self-service guard: passes if the caller is the account owner OR holds the owner key. */
export async function checkSelfOrOwnerGuard(req, store, accountId) {
  const accounts = await store.listAccounts();
  const owner = accounts.find((a) => a.role === 'owner');
  const presented = req.headers['x-owner-key'];
  if (owner && presented === computeGuardKey(owner.hash)) return null;
  if (req.headers['x-account-id'] && req.headers['x-account-id'] === accountId) return null;
  return { status: 401, error: 'unauthorized' };
}

export function newId(prefix) {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
