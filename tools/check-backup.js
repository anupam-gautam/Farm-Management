// Phase 8 test suite — run with: node tools/check-backup.js
//
//   1. Export / import round-trip reproduces full state
//   2. Owner guard enforced on backup endpoints
//   3. Version mismatch and invalid file rejected
//   4. Demo data exercises every task variant
//   5. Factory reset wipes operational data, keeps bootstrap accounts
//   6. Chart helpers render without error

import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DB = path.join(root, 'data', 'test-backup.json');
const PORT = 8793;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const ok = (name) => { console.log(`  PASS: ${name}`); passed++; };
const fail = (name, detail = '') => { console.error(`  FAIL: ${name} — ${detail}`); failed++; };
function assert(cond, name, detail) { cond ? ok(name) : fail(name, detail); }

async function testCharts() {
  console.log('\n[1] SVG chart helpers');
  const { horizontalBarChart, verticalBarChart, donutChart } = await import('../src/charts.js');

  const h = horizontalBarChart([{ label: 'Ram', value: 5 }, { label: 'Sita', value: 3 }]);
  assert(h.includes('<svg') && h.includes('Ram'), 'horizontalBarChart renders');

  const v = verticalBarChart([{ label: 'Mon', value: 2 }, { label: 'Tue', value: 4 }]);
  assert(v.includes('<svg') && v.includes('Mon'), 'verticalBarChart renders');

  const d = donutChart([
    { label: 'On time', value: 7, color: '#2d6a4f' },
    { label: 'Late', value: 2, color: '#d97706' },
  ]);
  assert(d.includes('<svg') && d.includes('On time'), 'donutChart renders');
}

async function testDemoBuilder() {
  console.log('\n[2] Demo dataset builder');
  const { buildDemoBackup } = await import('../api/_lib/demo.js');
  const accounts = [
    { id: 'acc_o', username: 'admin', role: 'owner', hash: 'a', salt: 'b', iterations: 100000,
      display_name: 'Owner', must_change_password: false, active: true },
    { id: 'acc_w', username: 'worker', role: 'worker', hash: 'c', salt: 'd', iterations: 100000,
      display_name: 'Worker', must_change_password: false, active: true },
  ];
  const demo = buildDemoBackup(accounts);

  assert(demo.schemaVersion === 1, 'demo has schema version');
  assert(demo.tasks.some((t) => t.recurrence === 'none'), 'demo has one-time task');
  assert(demo.tasks.some((t) => t.recurrence === 'daily'), 'demo has daily task');
  assert(demo.tasks.some((t) => t.recurrence === 'weekly'), 'demo has weekly task');
  assert(demo.tasks.some((t) => t.priority === 'urgent'), 'demo has urgent task');
  assert(demo.tasks.some((t) => t.photo_required), 'demo has photo-required task');
  assert(demo.completion_logs.some((l) => l.photo_status === 'purged'), 'demo has purged photo log');
  assert(demo.completion_logs.some((l) => l.worker_note), 'demo has worker notes');
  assert(demo.occurrences.some((o) => o.status === 'missed'), 'demo has missed occurrence');
}

async function testApi() {
  console.log('\n[3] Backup API integration');
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
    const headers = { 'Content-Type': 'application/json', 'x-owner-key': guardKey };

    // Guard on export
    res = await fetch(`${BASE}/api/backup`);
    assert(res.status === 401, 'export without guard rejected');

    // Create a task so export has content
    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({
        action: 'create', title: 'Backup test task', priority: 'normal',
        recurrence: 'none', scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
        assignedAccountId: worker.id,
      }),
    });
    assert(res.status === 201, 'seed task for export');

    // Export
    res = await fetch(`${BASE}/api/backup`, { headers });
    assert(res.status === 200, 'export succeeds with guard');
    const backup = await res.json();
    assert(backup.schemaVersion === 1, 'export includes schemaVersion');
    assert(backup.tasks.length >= 1, 'export includes tasks');
    assert(Array.isArray(backup.completion_logs), 'export includes completion_logs');

    // Import bad version
    res = await fetch(`${BASE}/api/backup`, {
      method: 'POST', headers,
      body: JSON.stringify({ ...backup, schemaVersion: 99 }),
    });
    assert(res.status === 400, 'wrong schema version rejected');
    const badVer = await res.json();
    assert(badVer.error === 'version_mismatch', 'version_mismatch error code');

    // Import invalid
    res = await fetch(`${BASE}/api/backup`, {
      method: 'POST', headers,
      body: JSON.stringify({ schemaVersion: 1 }),
    });
    assert(res.status === 400, 'invalid backup rejected');

    // Wipe and import round-trip
    res = await fetch(`${BASE}/api/seed`, {
      method: 'POST', headers, body: JSON.stringify({ action: 'reset' }),
    });
    assert(res.status === 200, 'factory reset succeeds');

    res = await fetch(`${BASE}/api/tasks`);
    let feed = await res.json();
    assert(feed.tasks.length === 0, 'reset clears tasks');

    res = await fetch(`${BASE}/api/backup`, {
      method: 'POST', headers, body: JSON.stringify(backup),
    });
    assert(res.status === 200, 'import overwrite succeeds');

    res = await fetch(`${BASE}/api/tasks`);
    feed = await res.json();
    assert(feed.tasks.some((t) => t.title === 'Backup test task'), 'import restores task');

    // Demo data
    res = await fetch(`${BASE}/api/seed`, {
      method: 'POST', headers, body: JSON.stringify({ action: 'demo' }),
    });
    assert(res.status === 200, 'demo load succeeds');

    res = await fetch(`${BASE}/api/tasks`);
    feed = await res.json();
    assert(feed.tasks.length >= 5, `demo loads multiple tasks, got ${feed.tasks.length}`);
    assert(feed.tasks.some((t) => t.recurrence === 'weekly'), 'demo has weekly task');

    res = await fetch(`${BASE}/api/logs`);
    const { logs } = await res.json();
    assert(logs.some((l) => l.photo_status === 'purged'), 'demo has purged photo log');
    assert(logs.some((l) => l.worker_note), 'demo logs include worker notes');

    // Factory reset again
    res = await fetch(`${BASE}/api/seed`, {
      method: 'POST', headers, body: JSON.stringify({ action: 'reset' }),
    });
    assert(res.status === 200, 'second factory reset succeeds');
    res = await fetch(`${BASE}/api/accounts`);
    const afterReset = await res.json();
    assert(afterReset.accounts.length === 2, 'reset restores bootstrap accounts only');
  } finally {
    server.kill();
    await rm(TEST_DB, { force: true });
  }
}

await testCharts();
await testDemoBuilder();
await testApi();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
