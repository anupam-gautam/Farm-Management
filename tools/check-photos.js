// Phase 5 test suite — run with: node tools/check-photos.js
//
//   1. Local blob backend: put/get/delete round-trip + path-traversal guard.
//   2. API integration: photo upload/serve, mandatory-photo gate (422),
//      completion with photo stores key + 'stored' status, gallery logs
//      endpoint, oversized upload rejected (413).
//
// Canvas compression is browser-only and verified manually (see PHASE-5.md).

import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DB = path.join(root, 'data', 'test-photos.json');
const TEST_PHOTOS = path.join(root, 'data', 'test-photos-dir');
const PORT = 8794;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const ok = (name) => { console.log(`  PASS: ${name}`); passed++; };
const fail = (name, detail = '') => { console.error(`  FAIL: ${name} — ${detail}`); failed++; };
function assert(cond, name, detail) { cond ? ok(name) : fail(name, detail); }

// ---------------------------------------------------------------------------
// 1. Local blob backend
// ---------------------------------------------------------------------------
async function testBlobBackend() {
  console.log('\n[1] Local photo storage backend');
  process.env.FARM_PHOTOS_DIR = TEST_PHOTOS;
  const { putPhoto, getPhotoBuffer, deletePhoto, isRemoteStorage } = await import('../api/_lib/blob.js');

  assert(isRemoteStorage() === false, 'local backend selected when BLOB_READ_WRITE_TOKEN absent');

  const bytes = randomBytes(2048);
  const key = await putPhoto(bytes);
  assert(typeof key === 'string' && key.endsWith('.jpg'), 'putPhoto returns a .jpg key');

  const back = await getPhotoBuffer(key);
  assert(back && back.equals(bytes), 'getPhotoBuffer round-trips identical bytes');

  assert((await getPhotoBuffer('../secret')) === null, 'path traversal rejected');
  assert((await getPhotoBuffer('nonexistent.jpg')) === null, 'missing key → null');

  await deletePhoto(key);
  assert((await getPhotoBuffer(key)) === null, 'deletePhoto removes the file');
}

// ---------------------------------------------------------------------------
// 2. API integration
// ---------------------------------------------------------------------------
async function testApi() {
  console.log('\n[2] Photo API + mandatory gate integration');
  await rm(TEST_DB, { force: true });
  await rm(TEST_PHOTOS, { recursive: true, force: true });

  const server = spawn(process.execPath, [path.join(root, 'tools', 'dev-server.js'), String(PORT)], {
    env: { ...process.env, FARM_LOCAL_DB: TEST_DB, FARM_PHOTOS_DIR: TEST_PHOTOS },
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

    // --- upload + serve round-trip -------------------------------------------
    const photoBytes = randomBytes(4096);
    res = await fetch(`${BASE}/api/photos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: photoBytes.toString('base64') }),
    });
    assert(res.status === 201, 'photo upload → 201');
    const { key, size } = await res.json();
    assert(size === 4096, 'reported size matches uploaded bytes');

    res = await fetch(`${BASE}/api/photos?key=${encodeURIComponent(key)}`);
    assert(res.status === 200 && res.headers.get('content-type') === 'image/jpeg', 'GET serves image/jpeg');
    const served = Buffer.from(await res.arrayBuffer());
    assert(served.equals(photoBytes), 'served bytes identical to uploaded bytes');

    res = await fetch(`${BASE}/api/photos?key=missing.jpg`);
    assert(res.status === 404, 'missing photo → 404');

    // --- oversized upload → 413 -------------------------------------------------
    res = await fetch(`${BASE}/api/photos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: 'A'.repeat(7_000_001) }),
    });
    assert(res.status === 413, 'oversized upload → 413');

    // --- photo-required task: gate enforcement ----------------------------------
    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({
        action: 'create', title: 'Photo task', priority: 'normal', photoRequired: true,
        recurrence: 'none', scheduledAt: new Date(Date.now() + 10 * 60000).toISOString(),
        assignedAccountId: worker.id,
      }),
    });
    const { id: taskId } = await res.json();

    res = await fetch(`${BASE}/api/tasks`);
    const feed = await res.json();
    const occ = feed.occurrences.find((o) => o.task_id === taskId);

    // Without photo → 422 photo_required
    res = await fetch(`${BASE}/api/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-account-id': worker.id },
      body: JSON.stringify({ occurrenceId: occ.id, note: 'no photo' }),
    });
    assert(res.status === 422, 'photo-required task without photo → 422');
    assert((await res.json()).error === 'photo_required', 'error code is photo_required');

    // With photo → 200, log carries key + stored status
    res = await fetch(`${BASE}/api/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-account-id': worker.id },
      body: JSON.stringify({ occurrenceId: occ.id, note: 'with photo', photoKey: key }),
    });
    assert(res.status === 200, 'photo-required task with photo → 200');

    // --- logs endpoint powers the gallery -----------------------------------------
    res = await fetch(`${BASE}/api/logs`);
    const { logs } = await res.json();
    const log = logs.find((l) => l.occurrence_id === occ.id);
    assert(!!log, 'completion log present in /api/logs');
    assert(log?.photo_blob_key === key && log?.photo_status === 'stored', 'log has photo key + stored status');

    // --- non-photo task still completes without photo ------------------------------
    res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({
        action: 'create', title: 'Plain task', priority: 'normal', photoRequired: false,
        recurrence: 'none', scheduledAt: new Date(Date.now() + 10 * 60000).toISOString(),
        assignedAccountId: worker.id,
      }),
    });
    const { id: plainId } = await res.json();
    res = await fetch(`${BASE}/api/tasks`);
    const feed2 = await res.json();
    const plainOcc = feed2.occurrences.find((o) => o.task_id === plainId);
    res = await fetch(`${BASE}/api/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-account-id': worker.id },
      body: JSON.stringify({ occurrenceId: plainOcc.id }),
    });
    assert(res.status === 200, 'non-photo task completes without photo');
  } finally {
    server.kill();
    await rm(TEST_DB, { force: true });
    await rm(TEST_PHOTOS, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
await testBlobBackend();
await testApi();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
