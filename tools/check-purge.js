// Phase 6 test suite — run with: node tools/check-purge.js
//
//   1. Purge logic: a photo older than 168h is deleted and its log flips to
//      'purged' — while title, timestamps, worker and note survive untouched.
//      A fresh photo is NOT purged. Failures leave logs 'stored' for retry.
//   2. Endpoint auth: no auth → 401, owner guard key → 200.

import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DB = path.join(root, 'data', 'test-purge.json');
const TEST_PHOTOS = path.join(root, 'data', 'test-purge-dir');
const PORT = 8795;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const ok = (name) => { console.log(`  PASS: ${name}`); passed++; };
const fail = (name, detail = '') => { console.error(`  FAIL: ${name} — ${detail}`); failed++; };
function assert(cond, name, detail) { cond ? ok(name) : fail(name, detail); }

process.env.FARM_LOCAL_DB = TEST_DB;
process.env.FARM_PHOTOS_DIR = TEST_PHOTOS;

async function testPurgeLogic() {
  console.log('\n[1] Purge logic (7-day lifecycle)');
  const { getStore, resetStoreForTests } = await import('../api/_lib/store.js');
  const { putPhoto, getPhotoBuffer } = await import('../api/_lib/blob.js');
  const { purgeExpiredPhotos } = await import('../api/_lib/purge.js');
  resetStoreForTests();
  const store = await getStore();
  await store.ensureSchema();

  // An 8-day-old photo log and a 1-day-old photo log.
  const oldKey = await putPhoto(randomBytes(1024));
  const freshKey = await putPhoto(randomBytes(1024));
  const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
  const oneDayAgo = new Date(Date.now() - 1 * 86_400_000).toISOString();

  const oldLog = await store.insertCompletionLog({
    occurrence_id: 'occ_old', task_id: 'task_old', task_title_snapshot: 'Old milking',
    completed_at: eightDaysAgo, completed_by: 'acc_w', completed_by_name: 'Sita',
    worker_note: 'Done early', photo_blob_key: oldKey, photo_status: 'stored',
  });
  const freshLog = await store.insertCompletionLog({
    occurrence_id: 'occ_fresh', task_id: 'task_fresh', task_title_snapshot: 'Fresh milking',
    completed_at: oneDayAgo, completed_by: 'acc_w', completed_by_name: 'Sita',
    worker_note: '', photo_blob_key: freshKey, photo_status: 'stored',
  });
  // A log with no photo at all must be ignored.
  await store.insertCompletionLog({
    occurrence_id: 'occ_plain', task_id: 'task_plain', task_title_snapshot: 'No photo',
    completed_at: eightDaysAgo, completed_by: 'acc_w', completed_by_name: 'Sita',
  });

  const result = await purgeExpiredPhotos(store);
  assert(result.purged === 1 && result.errors === 0, `exactly 1 photo purged, got ${result.purged}`);

  // Old photo: bytes gone, log flipped, text intact.
  assert((await getPhotoBuffer(oldKey)) === null, 'old photo bytes deleted');
  const logs = await store.listCompletionLogs();
  const purgedLog = logs.find((l) => l.id === oldLog.id);
  assert(purgedLog.photo_status === 'purged', 'old log photo_status → purged');
  assert(purgedLog.photo_blob_key === null, 'old log photo key cleared');
  assert(!!purgedLog.photo_purged_at, 'old log photo_purged_at stamped');
  assert(purgedLog.task_title_snapshot === 'Old milking', 'title snapshot preserved');
  assert(purgedLog.worker_note === 'Done early', 'worker note preserved');
  assert(purgedLog.completed_by_name === 'Sita', 'worker name preserved');
  assert(purgedLog.completed_at === eightDaysAgo, 'completion timestamp preserved');

  // Fresh photo: untouched.
  const freshAfter = logs.find((l) => l.id === freshLog.id);
  assert(freshAfter.photo_status === 'stored', 'fresh photo NOT purged');
  assert((await getPhotoBuffer(freshKey)) !== null, 'fresh photo bytes intact');

  // Idempotent: second run purges nothing.
  const again = await purgeExpiredPhotos(store);
  assert(again.purged === 0, 'second purge run is a no-op');
}

async function testEndpointAuth() {
  console.log('\n[2] Purge endpoint auth');
  await rm(TEST_DB, { force: true });

  const server = spawn(process.execPath, [path.join(root, 'tools', 'dev-server.js'), String(PORT)], {
    env: { ...process.env, FARM_LOCAL_DB: TEST_DB, FARM_PHOTOS_DIR: TEST_PHOTOS, CRON_SECRET: 'test-cron-secret' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1500));

  try {
    await fetch(`${BASE}/api/bootstrap`);

    // Cron path: no auth → 401
    let res = await fetch(`${BASE}/api/cron/purge-photos`);
    assert(res.status === 401, 'cron GET without secret → 401');

    // Cron path: wrong secret → 401
    res = await fetch(`${BASE}/api/cron/purge-photos`, {
      headers: { Authorization: 'Bearer wrong' },
    });
    assert(res.status === 401, 'cron GET with wrong secret → 401');

    // Cron path: correct secret → 200
    res = await fetch(`${BASE}/api/cron/purge-photos`, {
      headers: { Authorization: 'Bearer test-cron-secret' },
    });
    assert(res.status === 200, 'cron GET with correct secret → 200');
    const body = await res.json();
    assert(body.ok && body.purged === 0, 'cron response reports purged count');

    // Manual path: owner guard key → 200
    res = await fetch(`${BASE}/api/accounts`);
    const { accounts } = await res.json();
    const owner = accounts.find((a) => a.role === 'owner');
    const guardKey = createHash('sha256').update(owner.hash + '|farm-guard').digest('hex');

    res = await fetch(`${BASE}/api/cron/purge-photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    assert(res.status === 401, 'manual POST without owner key → 401');

    res = await fetch(`${BASE}/api/cron/purge-photos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-owner-key': guardKey },
    });
    assert(res.status === 200, 'manual POST with owner key → 200');
  } finally {
    server.kill();
    await rm(TEST_DB, { force: true });
    await rm(TEST_PHOTOS, { recursive: true, force: true });
  }
}

await testPurgeLogic();
await testEndpointAuth();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
