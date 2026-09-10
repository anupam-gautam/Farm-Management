// Client-side authentication (per accepted design — PLAN §3).
//
// The account list (including PBKDF2 hashes) is fetched from the API and the
// comparison happens here in the browser. This module is deliberately the ONLY
// place that touches credentials, sessions, and the guard key, so Phase 10 can
// swap the internals for server-side sessions without changing any view.

import { api } from './api.js';
import { storageKey } from './config.js';

// Must match tools/seed-credentials.js and api/_lib/guard.js exactly.
const ITERATIONS = 100_000;
const KEY_BITS = 256;
const GUARD_SUFFIX = '|farm-guard';

const SESSION_KEY = storageKey('session');
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes inactivity

// ---------------------------------------------------------------------------
// Hashing (WebCrypto PBKDF2-SHA256 — same parameters as the seed generator)
// ---------------------------------------------------------------------------

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function hashPassword(password, saltHex, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations },
    key, KEY_BITS
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function generateHashMaterial(password) {
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPassword(password, salt, ITERATIONS);
  return { passwordHash: hash, salt, iterations: ITERATIONS };
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// Account fetching + guard key
// ---------------------------------------------------------------------------

let cachedAccounts = null;

export async function fetchAccounts(force = false) {
  if (!cachedAccounts || force) {
    const data = await api('/api/accounts');
    cachedAccounts = data.accounts;
  }
  return cachedAccounts;
}

/** Guard header for destructive endpoints, derived from the owner hash. */
export async function ownerGuardHeaders() {
  const accounts = await fetchAccounts();
  const owner = accounts.find((a) => a.role === 'owner');
  if (!owner) throw new Error('no_owner_account');
  return { 'x-owner-key': await sha256Hex(owner.hash + GUARD_SUFFIX) };
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

let session = null;
let expiryTimer = null;
const expiryListeners = new Set();

export function onSessionExpired(fn) {
  expiryListeners.add(fn);
}

function readStoredSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function writeSession(value) {
  session = value;
  if (value) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    scheduleExpiryCheck();
  } else {
    sessionStorage.removeItem(SESSION_KEY);
    clearTimeout(expiryTimer);
  }
}

function scheduleExpiryCheck() {
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => {
    if (!getSession()) { // getSession returns null + clears when stale
      expiryListeners.forEach((fn) => fn());
    }
  }, SESSION_TIMEOUT_MS + 1000);
}

/** Current session, or null. Updates the inactivity clock on every call. */
export function getSession() {
  if (!session) session = readStoredSession();
  if (!session) return null;
  if (Date.now() - session.lastActive > SESSION_TIMEOUT_MS) {
    writeSession(null);
    return null;
  }
  session.lastActive = Date.now();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

// Any user interaction counts as activity.
['click', 'keydown', 'touchstart'].forEach((evt) =>
  window.addEventListener(evt, () => { if (session) session.lastActive = Date.now(); }, { passive: true })
);

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------

/**
 * Attempt login. Returns the session on success.
 * Throws Error with .code: 'invalid_credentials' | 'account_inactive' | 'network'
 */
export async function login(username, password) {
  const accounts = await fetchAccounts(true);
  const account = accounts.find(
    (a) => a.username.toLowerCase() === String(username).trim().toLowerCase()
  );
  if (!account) throw Object.assign(new Error('invalid_credentials'), { code: 'invalid_credentials' });
  if (!account.active) throw Object.assign(new Error('account_inactive'), { code: 'account_inactive' });

  const hash = await hashPassword(password, account.salt, account.iterations);
  if (hash !== account.hash) {
    throw Object.assign(new Error('invalid_credentials'), { code: 'invalid_credentials' });
  }

  writeSession({
    accountId: account.id,
    username: account.username,
    role: account.role,
    displayName: account.display_name,
    mustChangePassword: account.must_change_password,
    loginAt: Date.now(),
    lastActive: Date.now(),
  });
  return session;
}

export function logout() {
  writeSession(null);
  cachedAccounts = null;
}

// ---------------------------------------------------------------------------
// Password changes
// ---------------------------------------------------------------------------

/** Forced or voluntary self-service password change. */
export async function changeOwnPassword(newPassword) {
  const s = getSession();
  if (!s) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
  const material = await generateHashMaterial(newPassword);
  await api('/api/accounts', {
    method: 'POST',
    headers: { 'x-account-id': s.accountId },
    body: { action: 'setPassword', id: s.accountId, mustChangePassword: false, ...material },
  });
  cachedAccounts = null;
  session.mustChangePassword = false;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

// ---------------------------------------------------------------------------
// Owner: worker account management
// ---------------------------------------------------------------------------

export async function createWorker(username, displayName, password) {
  const material = await generateHashMaterial(password);
  const result = await api('/api/accounts', {
    method: 'POST',
    headers: await ownerGuardHeaders(),
    body: { action: 'create', username, displayName, ...material },
  });
  cachedAccounts = null;
  return result;
}

export async function updateWorker(id, fields) {
  await api('/api/accounts', {
    method: 'POST',
    headers: await ownerGuardHeaders(),
    body: { action: 'update', id, ...fields },
  });
  cachedAccounts = null;
}

export async function resetWorkerPassword(id, newPassword) {
  const material = await generateHashMaterial(newPassword);
  await api('/api/accounts', {
    method: 'POST',
    headers: await ownerGuardHeaders(),
    body: { action: 'setPassword', id, mustChangePassword: true, ...material },
  });
  cachedAccounts = null;
}
