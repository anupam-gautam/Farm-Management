// Phase 7 test suite — run with: node tools/check-alerts.js
//
//   1. Alert store CRUD: insert, list active, acknowledge flips inactive.
//   2. API integration: raise requires owner guard (401), raise → active in
//      GET, acknowledge → gone from active list, unknown ids → 404,
//      raise for unknown task → 404.
//   3. Worker-side filtering logic (alertsForSession) — pure function test
//      with browser globals stubbed.
//
// The poll loop, chime and banner are browser-only — manual checklist in
// PHASE-7.md.

import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DB = path.join(root, 'data', 'test-alerts.json');
const PORT = 8796;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const ok = (name) => { console.log(`  PASS: ${name}`); passed++; };
const fail = (name, detail = '') => { console.error(`  FAIL: ${name} — ${detail}`); failed++; };
function assert(cond, name, detail) { cond ? ok(name) : fail(name, detail); }

process.env.FARM_LOCAL_DB = TEST_DB;

async function testStore() {
  console.log('\n[1] Alert store');
  const { getStore, resetStoreForTests } = await import('../api/_lib/store.js');
  resetStoreForTests();
  const store = await getStore();
  await store.ensureSchema();

  const a = await store.insertAlert({
    task_id: 'task_1', message: 'Water now', raised_at: new Date().toISOString(), raised_by: 'acc_owner',
  });
  assert(a.active === true, 'new alert is active');

  let active = await store.listAlerts({ activeOnly: true });
  assert(active.length === 1, 'active list contains the alert');

  const acked = await store.acknowledgeAlert(a.id, 'acc_worker');
  assert(acked.active === false && acked.acknowledged_by === 'acc_worker' && !!acked.acknowledged_at,
    'acknowledge flips inactive with worker + timestamp');

  active = await store.listAlerts({ activeOnly: true });
  assert(active.length === 0, 'acknowledged alert leaves the active list');

  const all = await store.listAlerts();
  assert(all.length === 1, 'acknowledged alert kept in full history');

  assert((await store.acknowledgeAlert('nope', 'acc_worker')) === null, 'acknowledge unknown id → null');
}

async function testFiltering() {
  console.log('\n[2] Worker-side alert filtering');
  // alerts.js touches localStorage at import time? No — only inside functions.
  // It imports i18n.js which reads localStorage at module level → stub it.
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.document = { documentElement: { lang: '' }, getElementById: () => null };
  const { alertsForSession } = await import('../src/alerts.js');

  const tasks = [
    { id: 'task_a', assigned_account_id: 'w1' },
    { id: 'task_b', assigned_account_id: 'w2' },
  ];
  const alerts = [
    { id: 'al1', task_id: 'task_a' },
    { id: 'al2', task_id: 'task_b' },
  ];

  const w1 = alertsForSession(alerts, tasks, { role: 'worker', accountId: 'w1' });
  assert(w1.length === 1 && w1[0].id === 'al1', 'worker sees only alerts for their tasks');

  const owner = alertsForSession(alerts, tasks, { role: 'owner', accountId: 'o1' });
  assert(owner.length === 2, 'owner sees all alerts');

  const nobody = alertsForSession(alerts, tasks, null);
  assert(nobody.length === 0, 'logged-out session sees no alerts');
}

async function testApi() {
  console.log('\n[3] Alerts API integration');
  await rm(TEST_DB, { force: true });

  const server = spawn(process.execPath, [path.join(root, 'tools', 'dev-server.js'), String(PORT)], {
    env: { ...process.env, FARM_LOCAL_DB: TEST_DB },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1500));

  try {
    await fetch(`${BASE}/api/bootstrap`);
    let res = await fetch(`${BASE}/api/accounts`);
    const { accounts } = await res.json();
    const owner = accounts.find((a) => a.role === 'owner');
    const worker = accounts.find((a) => a.role === 'worker');
    const guardKey = createHash('sha256').update(owner.hash + '|farm-guard').digest('hex');
    const ownerHeaders = { 'Content-Type': 'application/json', 'x-owner-key': guardKey, 'x-account-id': owner.id };

    // A task to attach alerts to
    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({
        action: 'create', title: 'Alertable task', priority: 'urgent', photoRequired: false,
        recurrence: 'none', scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
        assignedAccountId: worker.id,
      }),
    });
    const { id: taskId } = await res.json();

    // Raise without guard → 401
    res = await fetch(`${BASE}/api/alerts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'raise', taskId, message: 'x' }),
    });
    assert(res.status === 401, 'raise without owner key → 401');

    // Raise for unknown task → 404
    res = await fetch(`${BASE}/api/alerts`, {
      method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({ action: 'raise', taskId: 'task_nope', message: 'x' }),
    });
    assert(res.status === 404, 'raise for unknown task → 404');

    // Raise properly → 201, appears active
    res = await fetch(`${BASE}/api/alerts`, {
      method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({ action: 'raise', taskId, message: 'Do it now!' }),
    });
    assert(res.status === 201, 'raise with owner key → 201');
    const { id: alertId } = await res.json();

    res = await fetch(`${BASE}/api/alerts`);
    let { alerts } = await res.json();
    assert(alerts.some((a) => a.id === alertId && a.message === 'Do it now!'), 'active alert visible via GET');

    // Acknowledge without account → 401; with worker → 200, leaves active list
    res = await fetch(`${BASE}/api/alerts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'acknowledge', id: alertId }),
    });
    assert(res.status === 401, 'acknowledge without account → 401');

    res = await fetch(`${BASE}/api/alerts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-account-id': worker.id },
      body: JSON.stringify({ action: 'acknowledge', id: alertId }),
    });
    assert(res.status === 200, 'acknowledge with worker account → 200');

    res = await fetch(`${BASE}/api/alerts`);
    ({ alerts } = await res.json());
    assert(!alerts.some((a) => a.id === alertId), 'acknowledged alert gone from active feed');

    res = await fetch(`${BASE}/api/alerts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-account-id': worker.id },
      body: JSON.stringify({ action: 'acknowledge', id: 'alert_nope' }),
    });
    assert(res.status === 404, 'acknowledge unknown alert → 404');
  } finally {
    server.kill();
    await rm(TEST_DB, { force: true });
  }
}

await testStore();
await testFiltering();
await testApi();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
