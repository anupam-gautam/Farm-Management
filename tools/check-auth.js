// Phase 2 test suite — run with: node tools/check-auth.js
//
//   1. Hash cross-validation: node:crypto PBKDF2 (seed generator) vs WebCrypto
//      PBKDF2 (browser algorithm) must produce identical output for the seed
//      credentials — proves the browser can verify seeded passwords.
//   2. Store CRUD round-trip against the local JSON-file backend.
//   3. Endpoint integration: boots the dev server on a throwaway DB and
//      exercises bootstrap, accounts list, guard enforcement, worker creation,
//      password reset, and a full simulated client login.
//
// Uses a temp DB file (data/test-auth.json), deleted afterwards.

import { pbkdf2Sync, createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DB = path.join(root, 'data', 'test-auth.json');
const PORT = 8791;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const ok = (name) => { console.log(`  PASS: ${name}`); passed++; };
const fail = (name, detail) => { console.error(`  FAIL: ${name} — ${detail}`); failed++; };
function assert(cond, name, detail = '') { cond ? ok(name) : fail(name, detail); }

// ---------------------------------------------------------------------------
// 1. Hash cross-validation
// ---------------------------------------------------------------------------
async function testHashing() {
  console.log('\n[1] Hash cross-validation');
  const seed = (await import('../data/credentials.seed.json', { with: { type: 'json' } })).default;

  const enc = new TextEncoder();
  async function webcryptoHash(password, saltHex, iterations) {
    const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256
    );
    return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  for (const [username, password] of [['admin', 'farm123'], ['worker', 'field123']]) {
    const acct = seed.accounts.find((a) => a.username === username);
    assert(!!acct, `seed contains ${username}`);
    if (!acct) continue;

    const nodeHash = pbkdf2Sync(password, Buffer.from(acct.salt, 'hex'), acct.iterations, 32, 'sha256').toString('hex');
    assert(nodeHash === acct.hash, `${username}: node:crypto reproduces seed hash`);

    const webHash = await webcryptoHash(password, acct.salt, acct.iterations);
    assert(webHash === acct.hash, `${username}: WebCrypto (browser algorithm) reproduces seed hash`);

    const wrong = await webcryptoHash('wrongpassword', acct.salt, acct.iterations);
    assert(wrong !== acct.hash, `${username}: wrong password rejected`);
  }
}

// ---------------------------------------------------------------------------
// 2. Store CRUD round-trip
// ---------------------------------------------------------------------------
async function testStore() {
  console.log('\n[2] Store CRUD (file backend)');
  process.env.FARM_LOCAL_DB = TEST_DB;
  const { getStore, resetStoreForTests } = await import('../api/_lib/store.js');
  resetStoreForTests();
  const store = await getStore();
  assert(store.kind === 'file', 'file backend selected when POSTGRES_URL absent', store.kind);

  await store.ensureSchema();
  const seeded = await store.seedIfEmpty([
    { username: 'testowner', role: 'owner', display_name: 'T', hash: 'ab', salt: 'cd', iterations: 100000, must_change_password: true, active: true },
  ]);
  assert(seeded === true, 'seeds an empty database');
  const seededAgain = await store.seedIfEmpty([]);
  assert(seededAgain === false, 'does not re-seed a populated database');

  const accounts = await store.listAccounts();
  assert(accounts.length === 1 && accounts[0].username === 'testowner', 'listAccounts returns seeded row');

  const updated = await store.updateAccount(accounts[0].id, { active: false, display_name: 'Renamed' });
  assert(updated.active === false && updated.display_name === 'Renamed', 'updateAccount applies fields');

  const missing = await store.updateAccount('nope', { active: true });
  assert(missing === null, 'updateAccount returns null for unknown id');

  await store.setMeta('testKey', { v: 1 });
  assert((await store.getMeta('testKey')).v === 1, 'meta round-trip');
}

// ---------------------------------------------------------------------------
// 3. Endpoint integration via dev server
// ---------------------------------------------------------------------------
async function testEndpoints() {
  console.log('\n[3] Endpoint integration (dev server + throwaway DB)');
  await rm(TEST_DB, { force: true });

  const server = spawn(process.execPath, [path.join(root, 'tools', 'dev-server.js'), String(PORT)], {
    env: { ...process.env, FARM_LOCAL_DB: TEST_DB },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1500));

  try {
    // bootstrap
    let res = await fetch(`${BASE}/api/bootstrap`);
    let data = await res.json();
    assert(res.status === 200 && data.ok && data.seeded === true, 'bootstrap seeds empty DB');
    assert(typeof data.serverTime === 'string', 'bootstrap returns serverTime');

    res = await fetch(`${BASE}/api/bootstrap`);
    data = await res.json();
    assert(data.seeded === false, 'second bootstrap does not re-seed');

    // accounts list
    res = await fetch(`${BASE}/api/accounts`);
    data = await res.json();
    assert(data.accounts.length === 2, 'accounts list has admin + worker');
    const owner = data.accounts.find((a) => a.role === 'owner');
    const worker = data.accounts.find((a) => a.role === 'worker');
    assert(!!owner && !!worker, 'owner and worker accounts present');

    // guard: create without key → 401
    res = await fetch(`${BASE}/api/accounts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', username: 'bad', displayName: 'Bad', passwordHash: 'ab', salt: 'cd', iterations: 100000 }),
    });
    assert(res.status === 401, 'create without owner key rejected (401)');

    // guard: create with correct key → 201
    const guardKey = createHash('sha256').update(owner.hash + '|farm-guard').digest('hex');
    res = await fetch(`${BASE}/api/accounts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-owner-key': guardKey },
      body: JSON.stringify({ action: 'create', username: 'sita', displayName: 'Sita', passwordHash: 'ab12', salt: 'cd34', iterations: 100000 }),
    });
    assert(res.status === 201, 'create with owner key succeeds (201)');

    // duplicate username → 409
    res = await fetch(`${BASE}/api/accounts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-owner-key': guardKey },
      body: JSON.stringify({ action: 'create', username: 'sita', displayName: 'Sita2', passwordHash: 'ab12', salt: 'cd34', iterations: 100000 }),
    });
    assert(res.status === 409, 'duplicate username rejected (409)');

    // self-service password change with x-account-id
    res = await fetch(`${BASE}/api/accounts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-account-id': worker.id },
      body: JSON.stringify({ action: 'setPassword', id: worker.id, passwordHash: 'ff'.repeat(32), salt: 'ee'.repeat(16), iterations: 100000, mustChangePassword: false }),
    });
    assert(res.status === 200, 'worker self-service password change allowed');

    // setPassword on someone else without owner key → 401
    res = await fetch(`${BASE}/api/accounts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-account-id': worker.id },
      body: JSON.stringify({ action: 'setPassword', id: owner.id, passwordHash: 'ff'.repeat(32), salt: 'ee'.repeat(16), iterations: 100000, mustChangePassword: false }),
    });
    assert(res.status === 401, 'worker cannot change owner password (401)');

    // simulated full client login: fetch accounts, PBKDF2 via WebCrypto, compare
    res = await fetch(`${BASE}/api/accounts`);
    data = await res.json();
    const admin = data.accounts.find((a) => a.username === 'admin');
    const salt = new Uint8Array(admin.salt.match(/../g).map((h) => parseInt(h, 16)));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('farm123'), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: admin.iterations }, key, 256);
    const hash = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
    assert(hash === admin.hash, 'full client-side login flow verifies admin/farm123 end-to-end');
  } finally {
    server.kill();
    await rm(TEST_DB, { force: true });
  }
}

// ---------------------------------------------------------------------------
await testHashing();
await testStore();
await testEndpoints();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
