// Phase 3 test suite — run with: node tools/check-tasks.js
//
//   1. Recurrence expansion unit tests (daily, weekly, ends_at, one-time,
//      no-past-expansion, farm-timezone correctness).
//   2. Status derivation + worker-feed sorting unit tests.
//   3. API integration: create one-time + recurring tasks, idempotent
//      expansion, update re-expands future occurrences, delete cascades,
//      missed marking, owner-guard enforcement.

import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DB = path.join(root, 'data', 'test-tasks.json');
const PORT = 8792;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const ok = (name) => { console.log(`  PASS: ${name}`); passed++; };
const fail = (name, detail = '') => { console.error(`  FAIL: ${name} — ${detail}`); failed++; };
function assert(cond, name, detail) { cond ? ok(name) : fail(name, detail); }

// ---------------------------------------------------------------------------
// 1. Recurrence expansion
// ---------------------------------------------------------------------------
async function testRecurrence() {
  console.log('\n[1] Recurrence expansion');
  const { expandTask } = await import('../api/_lib/recurrence.js');
  const { FARM_TZ_OFFSET_MINUTES, farmWallTimeToUtc } = await import('../api/_lib/time.js');

  assert(FARM_TZ_OFFSET_MINUTES === 345, 'farm timezone defaults to UTC+5:45 (Nepal)');

  // Wall-clock correctness: 08:00 farm time = 02:15 UTC.
  const due = farmWallTimeToUtc(2026, 8, 9, '08:00');
  assert(due.toISOString() === '2026-09-09T02:15:00.000Z', '08:00 farm time → 02:15 UTC', due.toISOString());

  const created = new Date(Date.now() - 2 * 86_400_000).toISOString(); // created 2 days ago

  const daily = {
    recurrence: 'daily', recurrence_time: '08:00', recurrence_weekdays: null,
    recurrence_ends_at: null, scheduled_at: null, created_at: created,
  };
  const dailyDates = expandTask(daily);
  assert(dailyDates.length === 9, `daily expands to 9 occurrences (yesterday → +7d), got ${dailyDates.length}`);
  assert(new Set(dailyDates).size === dailyDates.length, 'daily expansion has no duplicates');
  const hours = dailyDates.map((iso) => new Date(iso).getUTCHours() * 60 + new Date(iso).getUTCMinutes());
  assert(hours.every((m) => m === 135), 'every daily occurrence is 08:00 farm time (02:15 UTC)');

  const weekly = { ...daily, recurrence: 'weekly', recurrence_weekdays: [1, 4] }; // Mon + Thu
  const weeklyDates = expandTask(weekly);
  const weekdays = weeklyDates.map((iso) => {
    const shifted = new Date(new Date(iso).getTime() + 345 * 60000);
    return shifted.getUTCDay();
  });
  assert(weeklyDates.length >= 2 && weeklyDates.length <= 3, `weekly Mon/Thu → 2–3 per 9-day window, got ${weeklyDates.length}`);
  assert(weekdays.every((d) => d === 1 || d === 4), 'weekly occurrences land only on Mon/Thu');

  const endsSoon = { ...daily, recurrence_ends_at: new Date(Date.now() + 2 * 86_400_000).toISOString() };
  const endedDates = expandTask(endsSoon);
  assert(endedDates.length <= 4, `recurrence_ends_at caps expansion, got ${endedDates.length}`);

  const oneTime = {
    recurrence: 'none', scheduled_at: '2026-09-10T02:15:00.000Z',
    recurrence_time: null, recurrence_weekdays: null, recurrence_ends_at: null, created_at: created,
  };
  const onceDates = expandTask(oneTime);
  assert(onceDates.length === 1 && onceDates[0] === oneTime.scheduled_at, 'one-time task → exactly its scheduled_at');

  const futureTask = { ...daily, created_at: new Date(Date.now() + 5 * 86_400_000).toISOString() };
  const futureDates = expandTask(futureTask);
  assert(futureDates.every((iso) => new Date(iso) > new Date()), 'no occurrences before the task existed');
}

// ---------------------------------------------------------------------------
// 2. Status derivation + sorting (pure client logic, tested in Node)
// ---------------------------------------------------------------------------
async function testStatusAndSorting() {
  console.log('\n[2] Status derivation + feed sorting');
  // src/tasks.js imports src/api.js which is browser-safe to import (no top-level DOM).
  const { deriveStatus, sortForWorkerFeed } = await import('../src/tasks.js');

  const now = new Date();
  const mk = (dueOffsetMin, status = 'pending') => ({
    occurrence: { due_at: new Date(now.getTime() + dueOffsetMin * 60000).toISOString(), status },
  });

  assert(deriveStatus(mk(120).occurrence, now) === 'pending', 'due in 2h → pending');
  assert(deriveStatus(mk(30).occurrence, now) === 'dueSoon', 'due in 30min → dueSoon');
  assert(deriveStatus(mk(-5).occurrence, now) === 'overdue', 'due 5min ago → overdue');
  assert(deriveStatus(mk(-5, 'completed').occurrence, now) === 'completed', 'completed stays completed');
  assert(deriveStatus(mk(-1500, 'missed').occurrence, now) === 'missed', 'missed stays missed');

  const urgentLater = { ...mk(50), task: { priority: 'urgent' } };
  const normalSooner = { ...mk(10), task: { priority: 'normal' } };
  const doneFirst = { ...mk(-60, 'completed'), task: { priority: 'urgent' } };
  const sorted = sortForWorkerFeed([doneFirst, normalSooner, urgentLater]);
  assert(sorted[0] === urgentLater, 'urgent sorts before normal within actionable group');
  assert(sorted[1] === normalSooner, 'normal follows urgent');
  assert(sorted[2] === doneFirst, 'completed sinks to the bottom');
}

// ---------------------------------------------------------------------------
// 3. API integration
// ---------------------------------------------------------------------------
async function testApi() {
  console.log('\n[3] Tasks API integration');
  await rm(TEST_DB, { force: true });

  const server = spawn(process.execPath, [path.join(root, 'tools', 'dev-server.js'), String(PORT)], {
    env: { ...process.env, FARM_LOCAL_DB: TEST_DB },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1500));

  try {
    // Bootstrap + owner guard key
    await fetch(`${BASE}/api/bootstrap`);
    let res = await fetch(`${BASE}/api/accounts`);
    const { accounts } = await res.json();
    const owner = accounts.find((a) => a.role === 'owner');
    const worker = accounts.find((a) => a.role === 'worker');
    const guardKey = createHash('sha256').update(owner.hash + '|farm-guard').digest('hex');
    const headers = { 'Content-Type': 'application/json', 'x-owner-key': guardKey };

    // Guard enforcement
    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', title: 'X', priority: 'normal', recurrence: 'none', assignedAccountId: worker.id, scheduledAt: new Date().toISOString() }),
    });
    assert(res.status === 401, 'task create without owner key rejected');

    // Validation
    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'create', title: '', priority: 'normal', recurrence: 'none', assignedAccountId: worker.id, scheduledAt: new Date().toISOString() }),
    });
    assert(res.status === 400, 'empty title rejected (400)');

    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'create', title: 'X', priority: 'normal', recurrence: 'weekly', recurrenceTime: '08:00', recurrenceWeekdays: [], assignedAccountId: worker.id }),
    });
    assert(res.status === 400, 'weekly without weekdays rejected (400)');

    // Create one-time task
    const scheduledAt = new Date(Date.now() + 3600_000).toISOString();
    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'create', title: 'Feed cows', description: 'Morning feed', priority: 'urgent', photoRequired: true, recurrence: 'none', scheduledAt, assignedAccountId: worker.id }),
    });
    assert(res.status === 201, 'one-time task created (201)');
    const { id: oneTimeId } = await res.json();

    // Create daily recurring task
    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'create', title: 'Water buffaloes', priority: 'normal', photoRequired: false, recurrence: 'daily', recurrenceTime: '07:30', assignedAccountId: worker.id }),
    });
    assert(res.status === 201, 'daily task created (201)');
    const { id: dailyId } = await res.json();

    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({
        action: 'create', title: 'X', priority: 'normal', recurrence: 'none',
        scheduledAt: new Date(Date.now() + 3600_000).toISOString(), assignedAccountIds: [],
      }),
    });
    assert(res.status === 400, 'empty assignee list rejected (400)');

    res = await fetch(`${BASE}/api/accounts`, {
      method: 'POST', headers,
      body: JSON.stringify({
        action: 'create', username: 'ram', displayName: 'Ram Worker',
        passwordHash: 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56',
        salt: 'cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56',
        iterations: 100000,
      }),
    });
    assert(res.status === 201, 'second worker created (201)');
    const { id: worker2Id } = await res.json();

    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({
        action: 'create', title: 'Shared duty', priority: 'normal', photoRequired: false,
        recurrence: 'none', scheduledAt: new Date(Date.now() + 7200_000).toISOString(),
        assignedAccountIds: [worker.id, worker2Id],
      }),
    });
    assert(res.status === 201, 'multi-assign task created (201)');
    const { id: sharedId } = await res.json();

    res = await fetch(`${BASE}/api/tasks`);
    let feedCheck = await res.json();
    const shared = feedCheck.tasks.find((t) => t.id === sharedId);
    assert(shared?.assigned_account_ids?.length === 2
      && shared.assigned_account_ids.includes(worker.id)
      && shared.assigned_account_ids.includes(worker2Id),
      'task stores multiple assignees');
    const { isAssignedTo } = await import('../api/_lib/assignees.js');
    assert(isAssignedTo(shared, worker.id) && isAssignedTo(shared, worker2Id),
      'both workers count as assignees');

    // Feed: occurrences expanded
    res = await fetch(`${BASE}/api/tasks`);
    let feed = await res.json();
    const dailyOccs = feed.occurrences.filter((o) => o.task_id === dailyId);
    // Window is yesterday→+7d (9 days), but yesterday's occurrence is excluded
    // when it's more than 24h before the task's creation time — so a freshly
    // created task yields 8 or 9 depending on the time of day.
    assert(dailyOccs.length >= 8 && dailyOccs.length <= 9,
      `daily task expanded to 8–9 occurrences, got ${dailyOccs.length}`);
    const oneTimeOccs = feed.occurrences.filter((o) => o.task_id === oneTimeId);
    assert(oneTimeOccs.length === 1 && oneTimeOccs[0].due_at === scheduledAt, 'one-time occurrence matches scheduled time');

    // Idempotency: second GET must not duplicate
    res = await fetch(`${BASE}/api/tasks`);
    const feed2 = await res.json();
    assert(feed2.occurrences.length === feed.occurrences.length, 'repeated GET does not duplicate occurrences');

    // Update: change daily → weekly on tomorrow's weekday only; future occurrences re-expand
    const tomorrowWeekday = new Date(Date.now() + 86_400_000).getUTCDay(); // approx; window covers it
    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'update', id: dailyId, title: 'Water buffaloes', priority: 'normal', photoRequired: false, recurrence: 'weekly', recurrenceTime: '09:00', recurrenceWeekdays: [tomorrowWeekday], assignedAccountId: worker.id }),
    });
    assert(res.status === 200, 'task update succeeds');

    res = await fetch(`${BASE}/api/tasks`);
    feed = await res.json();
    const updatedOccs = feed.occurrences.filter((o) => o.task_id === dailyId);
    const futureOccs = updatedOccs.filter((o) => new Date(o.due_at) > new Date());
    assert(futureOccs.length <= 2 && futureOccs.every((o) => o.due_at.includes('T03:15:00')),
      `future occurrences re-expanded at new 09:00 farm time (03:15 UTC), got ${futureOccs.length}`);

    // Cancel one day of a recurring series
    const slotToCancel = feed.occurrences.find((o) => o.task_id === dailyId && o.status === 'pending');
    assert(slotToCancel, 'pending occurrence available to cancel');
    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'cancel_occurrence', occurrenceId: slotToCancel.id }),
    });
    assert(res.status === 200, 'cancel_occurrence succeeds');
    res = await fetch(`${BASE}/api/tasks`);
    feed = await res.json();
    assert(!feed.occurrences.some((o) => o.id === slotToCancel.id),
      'skipped occurrence removed from feed');
    const dailyTask = feed.tasks.find((t) => t.id === dailyId);
    assert((dailyTask?.skipped_due_at || []).includes(slotToCancel.due_at),
      'skipped due_at stored on task template');

    // Re-fetch must not resurrect the skipped slot
    res = await fetch(`${BASE}/api/tasks`);
    feed = await res.json();
    assert(!feed.occurrences.some((o) => o.task_id === dailyId && o.due_at === slotToCancel.due_at),
      'skipped slot stays gone after re-expand');

    // Fork one day into a one-time task (before further cancels)
    const slotToFork = feed.occurrences.find((o) => o.task_id === dailyId && o.status === 'pending');
    assert(slotToFork, 'pending occurrence available to fork');
    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({
        action: 'fork_occurrence',
        occurrenceId: slotToFork.id,
        title: 'Special water day',
        description: 'Extra feed',
        priority: 'urgent',
        photoRequired: false,
        recurrence: 'none',
        assignedAccountId: worker.id,
        scheduledAt: slotToFork.due_at,
      }),
    });
    assert(res.status === 201, 'fork_occurrence creates one-time task');
    res = await fetch(`${BASE}/api/tasks`);
    feed = await res.json();
    assert(feed.tasks.some((t) => t.title === 'Special water day' && t.recurrence === 'none'),
      'forked one-time task in feed');
    assert(!feed.occurrences.some((o) => o.id === slotToFork.id),
      'forked recurring slot removed');

    // Missed occurrences can also be skipped (common after the 24h auto-mark)
    res = await fetch(`${BASE}/api/tasks`);
    feed = await res.json();
    const missedSlot = feed.occurrences.find((o) => o.task_id === dailyId && o.status === 'pending');
    if (missedSlot) {
      const { getStore, resetStoreForTests } = await import('../api/_lib/store.js');
      resetStoreForTests();
      const store = await getStore();
      await store.setOccurrenceStatus(missedSlot.id, 'missed');
      res = await fetch(`${BASE}/api/tasks`, {
        method: 'POST', headers,
        body: JSON.stringify({ action: 'cancel_occurrence', occurrenceId: missedSlot.id }),
      });
      assert(res.status === 200, 'cancel_occurrence works on missed status');
    }

    // Delete cascades
    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers, body: JSON.stringify({ action: 'delete', id: dailyId }),
    });
    assert(res.status === 200, 'task deleted');
    res = await fetch(`${BASE}/api/tasks`);
    feed = await res.json();
    assert(!feed.tasks.some((x) => x.id === dailyId), 'deleted task gone from feed');
    assert(!feed.occurrences.some((o) => o.task_id === dailyId), 'deleted task occurrences gone');

    // Missed marking: create a task 2 days in the past → occurrence flips to missed
    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'create', title: 'Old task', priority: 'normal', photoRequired: false, recurrence: 'none', scheduledAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), assignedAccountId: worker.id }),
    });
    assert(res.status === 201, 'past-dated task created');
    res = await fetch(`${BASE}/api/tasks`);
    feed = await res.json();
    const oldOcc = feed.occurrences.find((o) => o.due_at < new Date(Date.now() - 86_400_000).toISOString() && feed.tasks.find((x) => x.id === o.task_id)?.title === 'Old task');
    assert(oldOcc?.status === 'missed', 'stale pending occurrence auto-marked missed');
  } finally {
    server.kill();
    await rm(TEST_DB, { force: true });
  }
}

// ---------------------------------------------------------------------------
await testRecurrence();
await testStatusAndSorting();
await testApi();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
