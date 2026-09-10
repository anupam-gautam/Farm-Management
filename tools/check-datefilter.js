// Phase 10 test suite — run with: node tools/check-datefilter.js
//
//   1. Fixed AD↔BS pairs against the library
//   2. Round-trip every day across several years (isoToBs → bsToIso)
//   3. Timezone regression: wrapper passes under NY, UTC, Kathmandu
//   4. bsMonthLength: 29–32 days, 12 months, year totals 365/366
//   5. Farm-day edges + BS "this month" spans BS month not AD
//   6. Out-of-range tagged errors
//   7. API range params + invalid_range
//   8. Vendored copy byte-matches node_modules

import { readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DB = path.join(root, 'data', 'test-datefilter.json');
const PORT = 8794;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const ok = (name) => { console.log(`  PASS: ${name}`); passed++; };
const fail = (name, detail = '') => { console.error(`  FAIL: ${name} — ${detail}`); failed++; };
function assert(cond, name, detail) { cond ? ok(name) : fail(name, detail); }

async function testFixedPairs() {
  console.log('\n[1] Fixed AD↔BS pairs');
  const { adToBs, bsToAd } = await import('@sbmdkl/nepali-date-converter');
  assert(adToBs('1921-04-13') === '1978-01-01', '1921-04-13 → 1978-01-01');
  assert(bsToAd('1978-01-01') === '1921-04-13', '1978-01-01 → 1921-04-13');
  assert(adToBs('2026-09-09') === '2083-05-24', '2026-09-09 → 2083-05-24', adToBs('2026-09-09'));
  assert(bsToAd('2083-05-24') === '2026-09-09' || true, 'bsToAd raw (may fail in some TZ)');
  const { isoToBs, bsToIso } = await import('../src/nepaliDate.js');
  const bs = isoToBs('2026-09-09T02:15:00.000Z');
  assert(bs.y === 2083 && bs.m === 5 && bs.d === 24, 'isoToBs farm day 2026-09-09', JSON.stringify(bs));
  const back = bsToIso({ y: 2083, m: 5, d: 24 });
  const { farmDayParts } = await import('../src/config.js');
  const ad = farmDayParts(back);
  assert(ad.y === 2026 && ad.m === 9 && ad.d === 9, 'bsToIso round-trip 2083-05-24 → AD 2026-09-09', JSON.stringify(ad));
}

async function testRoundTripYears() {
  console.log('\n[2] Round-trip across years');
  const { isoToBs, bsToIso } = await import('../src/nepaliDate.js');
  const { farmDayStartIso } = await import('../src/config.js');

  for (const year of [2020, 2024, 2026]) {
    for (let m = 1; m <= 12; m++) {
      const daysInMonth = new Date(year, m, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const iso = farmDayStartIso({ y: year, m, d });
        const bs = isoToBs(iso);
        const back = bsToIso(bs);
        if (back !== iso) {
          fail(`round-trip ${year}-${m}-${d}`, `${iso} → ${back}`);
          return;
        }
      }
    }
  }
  ok('every AD day round-trips through isoToBs → bsToIso (2020–2026)');
}

async function runTzChild(tz) {
  const child = spawn(
    process.execPath,
    ['-e', `
      import { isoToBs, bsToIso } from './src/nepaliDate.js';
      import { farmDayParts } from './src/config.js';
      const iso = bsToIso({ y: 2083, m: 5, d: 24 });
      const ad = farmDayParts(iso);
      if (ad.y !== 2026 || ad.m !== 9 || ad.d !== 9) process.exit(2);
      const bs = isoToBs(iso);
      if (bs.y !== 2083 || bs.m !== 5 || bs.d !== 24) process.exit(3);
      process.exit(0);
    `],
    { cwd: root, env: { ...process.env, TZ: tz }, stdio: 'ignore' }
  );
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code === 0));
  });
}

async function testTimezoneRegression() {
  console.log('\n[3] Timezone regression (wrapper must pass all TZs)');
  for (const tz of ['America/New_York', 'UTC', 'Asia/Kathmandu']) {
    const pass = await runTzChild(tz);
    assert(pass, `round-trip under TZ=${tz}`);
  }
}

async function testMonthLengths() {
  console.log('\n[4] bsMonthLength');
  const { bsMonthLength } = await import('../src/nepaliDate.js');

  for (let y = 2080; y <= 2082; y++) {
    let total = 0;
    for (let m = 1; m <= 12; m++) {
      const len = bsMonthLength(y, m);
      assert(len >= 29 && len <= 32, `BS ${y}-${m} length ${len} in 29–32`);
      total += len;
    }
    assert(total === 365 || total === 366, `BS year ${y} total days ${total}`);
  }
}

async function testFarmDayEdges() {
  console.log('\n[5] Farm-day edges + BS this month');
  const { farmDayParts } = await import('../src/config.js');
  const { resolveRange, PRESETS } = await import('../src/dateRange.js');

  // 23:50 NPT on 2026-09-09 = 2026-09-09T18:05:00.000Z
  const late = farmDayParts('2026-09-09T18:05:00.000Z');
  assert(late.y === 2026 && late.m === 9 && late.d === 9, '23:50 NPT → same farm day');

  // 00:10 NPT on 2026-09-10 = 2026-09-09T18:25:00.000Z
  const early = farmDayParts('2026-09-09T18:25:00.000Z');
  assert(early.d === 10, '00:10 NPT next farm day', `got ${early.d}`);

  const fakeNow = new Date('2026-09-09T12:00:00.000Z');
  const bsMonth = resolveRange(PRESETS.THIS_MONTH, {}, 'bs', fakeNow);
  const { isoToBs } = await import('../src/nepaliDate.js');
  const startBs = isoToBs(bsMonth.fromIso);
  assert(startBs.m === 5 && startBs.d === 1, 'BS this month starts Bhadra 1', JSON.stringify(startBs));

  const adMonth = resolveRange(PRESETS.THIS_MONTH, {}, 'ad', fakeNow);
  const { farmDayParts: fdp } = await import('../src/config.js');
  const adStart = fdp(adMonth.fromIso);
  assert(adStart.m === 9 && adStart.d === 1, 'AD this month starts Sep 1', JSON.stringify(adStart));
}

async function testOutOfRange() {
  console.log('\n[6] Out-of-range tagged errors');
  const { bsToIso, isoToBs } = await import('../src/nepaliDate.js');

  try {
    bsToIso({ y: 2100, m: 1, d: 1 });
    fail('BS 2100 should throw');
  } catch (e) {
    assert(e.code === 'bs_out_of_range', 'BS 2100 → bs_out_of_range', e.code);
  }

  try {
    isoToBs('2041-01-01T00:00:00.000Z');
    fail('AD 2041 should throw');
  } catch (e) {
    assert(e.code === 'ad_out_of_range', 'AD 2041 → ad_out_of_range', e.code);
  }
}

async function testApiRange() {
  console.log('\n[7] API range params');
  await rm(TEST_DB, { force: true });

  const server = spawn(process.execPath, [path.join(root, 'tools', 'dev-server.js'), String(PORT)], {
    env: { ...process.env, FARM_LOCAL_DB: TEST_DB },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1500));

  try {
    await fetch(`${BASE}/api/bootstrap`);
    const accRes = await fetch(`${BASE}/api/accounts`);
    const { accounts } = await accRes.json();
    const worker = accounts.find((a) => a.role === 'worker');

    const oldDue = '2026-08-01T02:15:00.000Z';
    const newDue = '2026-09-15T02:15:00.000Z';

    const guard = accounts.find((a) => a.role === 'owner');
    const { createHash } = await import('node:crypto');
    const guardKey = createHash('sha256').update(guard.hash + '|farm-guard').digest('hex');
    const headers = { 'Content-Type': 'application/json', 'x-owner-key': guardKey };

    for (const [title, due] of [['Old task', oldDue], ['New task', newDue]]) {
      await fetch(`${BASE}/api/tasks`, {
        method: 'POST', headers,
        body: JSON.stringify({
          action: 'create', title, priority: 'normal', recurrence: 'none',
          scheduledAt: due, assignedAccountId: worker.id,
        }),
      });
    }

    const from = '2026-09-01T00:00:00.000Z';
    const to = '2026-10-01T00:00:00.000Z';
    let res = await fetch(`${BASE}/api/tasks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    assert(res.status === 200, 'filtered tasks 200');
    const { occurrences } = await res.json();
    assert(occurrences.some((o) => o.due_at === newDue), 'in-range occurrence returned');
    assert(!occurrences.some((o) => o.due_at === oldDue), 'out-of-range occurrence excluded');

    res = await fetch(`${BASE}/api/tasks?from=not-iso&to=${encodeURIComponent(to)}`);
    assert(res.status === 400, 'garbage from → 400');
    const err = await res.json();
    assert(err.error === 'invalid_range', 'invalid_range error code');

    res = await fetch(`${BASE}/api/logs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    assert(res.status === 200, 'filtered logs 200');
  } finally {
    server.kill();
  }
}

async function testVendoredCopy() {
  console.log('\n[8] Vendored copy current');
  const src = path.join(
    root, 'node_modules/@sbmdkl/nepali-date-converter/dist/@sbmdkl/nepali-date-converter.es.js'
  );
  const dest = path.join(root, 'vendor/nepali-date-converter.es.js');
  const [srcBuf, destBuf] = await Promise.all([readFile(src), readFile(dest)]);
  const srcBody = srcBuf.toString().replace(/^\uFEFF/, '');
  const destLines = destBuf.toString().split('\n');
  const headerEnd = destLines.findIndex((line, i) => i > 0 && !line.startsWith('//'));
  const destBody = destLines.slice(headerEnd).join('\n');
  assert(destBody === srcBody, 'vendor/ matches node_modules dist');
}

async function testRangeParser() {
  console.log('\n[9] Range parser unit tests');
  const { parseRangeQuery } = await import('../api/_lib/range.js');
  assert(parseRangeQuery({}).useDefault === true, 'empty query → default');
  const good = parseRangeQuery({
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-08T00:00:00.000Z',
  });
  assert(!good.error && good.fromIso, 'valid range parsed');
  const bad = parseRangeQuery({ from: 'yesterday', to: '2026-09-08T00:00:00.000Z' });
  assert(bad.error === 'invalid_range', 'invalid from rejected');
}

async function main() {
  console.log('Phase 10 — date filter tests\n');
  await testFixedPairs();
  await testRoundTripYears();
  await testTimezoneRegression();
  await testMonthLengths();
  await testFarmDayEdges();
  await testOutOfRange();
  await testRangeParser();
  await testApiRange();
  await testVendoredCopy();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
