// Phase 4 test suite — run with: node tools/check-completion.js
//
//   1. canComplete unit tests (the client mirror of the rule).
//   2. API integration: the 30-minute rule enforced server-side —
//      early completion rejected with 422 + unlocksAt, in-window and overdue
//      completion accepted, double completion 409, wrong worker 403,
//      log written with title snapshot + worker note.

import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DB = path.join(root, 'data', 'test-completion.json');
const PORT = 8793;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const ok = (name) => { console.log(`  PASS: ${name}`); passed++; };
const fail = (name, detail = '') => { console.error(`  FAIL: ${name} — ${detail}`); failed++; };
function assert(cond, name, detail) { cond ? ok(name) : fail(name, detail); }

// ---------------------------------------------------------------------------
// 1. canComplete unit tests
// ---------------------------------------------------------------------------
async function testCanComplete() {
  console.log('\n[1] canComplete (client rule mirror)');
  const { canComplete } = await import('../src/tasks.js');

  const now = new Date('2026-09-09T12:00:00.000Z');
  const mk = (dueOffsetMin, status = 'pending') => ({
    due_at: new Date(now.getTime() + dueOffsetMin * 60000).toISOString(),
    status,
  });

  let r = canComplete(mk(120), now);
  assert(!r.allowed && r.unlocksAt instanceof Date, 'due in 2h → locked with unlocksAt');
  assert(r.unlocksAt.getTime() === now.getTime() + 90 * 60000, 'unlocks exactly 30 min before due');

  r = canComplete(mk(30), now);
  assert(r.allowed, 'due in exactly 30 min → allowed (boundary)');

  r = canComplete(mk(29), now);
  assert(r.allowed, 'due in 29 min → allowed');

  r = canComplete(mk(31), now);
  assert(!r.allowed, 'due in 31 min → locked');

  r = canComplete(mk(-10), now);
  assert(r.allowed, 'overdue → allowed immediately');

  r = canComplete(mk(-10, 'completed'), now);
  assert(!r.allowed && r.unlocksAt === null, 'already completed → not allowed');
}

// ---------------------------------------------------------------------------
// 2. API integration
// ---------------------------------------------------------------------------
async function testApi() {
  console.log('\n[2] Completion API integration');
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
    const ownerHeaders = { 'Content-Type': 'application/json', 'x-owner-key': guardKey };

    // Second worker to test the wrong-worker rejection
    res = await fetch(`${BASE}/api/accounts`, {
      method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({ action: 'create', username: 'other', displayName: 'Other', passwordHash: 'ab12', salt: 'cd34', iterations: 100000 }),
    });
    const { id: otherId } = await res.json();

    async function createTask(title, dueOffsetMin) {
      const r = await fetch(`${BASE}/api/tasks`, {
        method: 'POST', headers: ownerHeaders,
        body: JSON.stringify({
          action: 'create', title, priority: 'normal', photoRequired: false,
          recurrence: 'none', scheduledAt: new Date(Date.now() + dueOffsetMin * 60000).toISOString(),
          assignedAccountId: worker.id,
        }),
      });
      return (await r.json()).id;
    }

    async function feedOccurrence(taskId) {
      const r = await fetch(`${BASE}/api/tasks`);
      const feed = await r.json();
      return feed.occurrences.find((o) => o.task_id === taskId);
    }

    async function attemptComplete(occurrenceId, asAccount = worker.id, note = '') {
      return fetch(`${BASE}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-account-id': asAccount },
        body: JSON.stringify({ occurrenceId, note }),
      });
    }

    // --- too early: due in 2h → 422 with unlocksAt ---------------------------
    const futureId = await createTask('Future task', 120);
    const futureOcc = await feedOccurrence(futureId);
    res = await attemptComplete(futureOcc.id);
    assert(res.status === 422, 'task due in 2h → 422 too_early');
    const body = await res.json();
    const expectedUnlock = new Date(futureOcc.due_at).getTime() - 30 * 60000;
    assert(Math.abs(new Date(body.unlocksAt).getTime() - expectedUnlock) < 1000,
      'unlocksAt is exactly due − 30 min');

    // occurrence stays pending after rejection
    assert((await feedOccurrence(futureId)).status === 'pending', 'rejected completion leaves occurrence pending');

    // --- in-window: due in 20 min → 200 ---------------------------------------
    const soonId = await createTask('Soon task', 20);
    const soonOcc = await feedOccurrence(soonId);
    res = await attemptComplete(soonOcc.id, worker.id, 'All done, extra hay in the shed');
    assert(res.status === 200, 'task due in 20 min → completion accepted');
    const { logId } = await res.json();
    assert(!!logId, 'completion returns a log id');
    assert((await feedOccurrence(soonId)).status === 'completed', 'occurrence flips to completed');

    // --- double completion → 409 ----------------------------------------------
    res = await attemptComplete(soonOcc.id);
    assert(res.status === 409, 'second completion → 409 already_completed');

    // --- wrong worker → 403 ------------------------------------------------------
    const otherTaskId = await createTask('Another future task', 10);
    const otherOcc = await feedOccurrence(otherTaskId);
    res = await attemptComplete(otherOcc.id, otherId);
    assert(res.status === 403, 'unassigned worker → 403 wrong_worker');

    // --- overdue → allowed ------------------------------------------------------
    const overdueId = await createTask('Overdue task', -60);
    const overdueOcc = await feedOccurrence(overdueId);
    res = await attemptComplete(overdueOcc.id);
    assert(res.status === 200, 'overdue task → completion accepted');

    // --- unknown occurrence → 404 -------------------------------------------------
    res = await attemptComplete('occ_nonexistent');
    assert(res.status === 404, 'unknown occurrence → 404');

    // --- log contents: snapshot + note + worker name ------------------------------
    process.env.FARM_LOCAL_DB = TEST_DB; // point the in-process store at the test DB
    const { getStore, resetStoreForTests } = await import('../api/_lib/store.js');
    resetStoreForTests();
    const store = await getStore();
    const logs = await store.listCompletionLogs();
    const soonLog = logs.find((l) => l.occurrence_id === soonOcc.id);
    assert(soonLog?.task_title_snapshot === 'Soon task', 'log keeps title snapshot');
    assert(soonLog?.worker_note === 'All done, extra hay in the shed', 'log keeps worker note');
    assert(soonLog?.completed_by_name === 'Farm Worker', 'log keeps worker display name');
    assert(soonLog?.photo_status === 'none', 'log photo_status defaults to none');
    assert(logs.length === 2, 'exactly two logs written (soon + overdue)');
  } finally {
    server.kill();
    await rm(TEST_DB, { force: true });
  }
}

// ---------------------------------------------------------------------------
await testCanComplete();
await testApi();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
