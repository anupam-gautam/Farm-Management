// Phase 9 PWA test suite — run with: node tools/check-pwa.js

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const ok = (name) => { console.log(`  PASS: ${name}`); passed++; };
const fail = (name, detail = '') => { console.error(`  FAIL: ${name} — ${detail}`); failed++; };
function assert(cond, name, detail) { cond ? ok(name) : fail(name, detail); }

async function read(rel) {
  return readFile(path.join(root, rel), 'utf8');
}

async function testManifest() {
  console.log('\n[1] Web app manifest');
  const manifest = JSON.parse(await read('manifest.json'));
  assert(manifest.display === 'standalone', 'display is standalone');
  assert(manifest.orientation === 'portrait', 'orientation is portrait');
  assert(manifest.theme_color === '#14532d', 'theme_color matches brand');
  assert(manifest.background_color === '#fefce8', 'background_color matches cream');
  assert(manifest.icons?.some((i) => i.purpose === 'maskable'), 'has maskable icon');
  assert(manifest.icons?.some((i) => i.sizes === '192x192'), 'has 192px icon');
  assert(manifest.icons?.some((i) => i.sizes === '512x512'), 'has 512px icon');
}

async function testIcons() {
  console.log('\n[2] Icon files');
  for (const name of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
    const buf = await readFile(path.join(root, 'icons', name));
    assert(buf.length > 100, `${name} exists and is non-trivial`, `${buf.length} bytes`);
  }
}

async function testServiceWorker() {
  console.log('\n[3] Service worker');
  const sw = await read('sw.js');
  assert(sw.includes('CACHE_VERSION'), 'has CACHE_VERSION for deploy bumps');
  assert(sw.includes('PRECACHE_URLS'), 'precaches shell assets');
  assert(sw.includes('/offline.html'), 'precaches offline page');
  assert(sw.includes("event.tag === 'farm-replay-queue'"), 'Background Sync hook present');
  assert(sw.includes('SKIP_WAITING'), 'handles update activation');
  assert(sw.includes('network-first') || sw.includes('fetch(request)'), 'API network strategy');
}

async function testShell() {
  console.log('\n[4] HTML shell wiring');
  const html = await read('index.html');
  assert(html.includes('rel="manifest"'), 'index links manifest');
  assert(html.includes('apple-touch-icon'), 'index links apple-touch-icon');
  assert(html.includes('sr-only'), 'screen-reader utility class defined');
  assert(html.includes('min-h-touch') || html.includes('min-height: 44px'), 'touch targets enforced');

  const offline = await read('offline.html');
  assert(offline.includes('Try again') || offline.includes('फेरि'), 'offline page is bilingual');
}

async function testPwaModule() {
  console.log('\n[5] Client PWA module');
  const pwa = await read('src/pwa.js');
  assert(pwa.includes('serviceWorker.register'), 'registers service worker');
  assert(pwa.includes('beforeinstallprompt'), 'custom install prompt');
  assert(pwa.includes('showUpdateBanner'), 'update-available banner');
  assert(pwa.includes('offline-banner'), 'offline-mode banner');
  assert(pwa.includes('farm-replay-queue'), 'registers Background Sync tag');

  const main = await read('src/main.js');
  assert(main.includes('initPwa'), 'main.js initializes PWA');
}

async function testI18n() {
  console.log('\n[6] PWA i18n keys');
  const { DICTIONARY } = await import('../src/i18n-dictionary.js');
  const keys = ['pwa.installTitle', 'pwa.updateAvailable', 'pwa.offlineTitle', 'sync.statusLabel'];
  for (const key of keys) {
    const get = (lang) => key.split('.').reduce((n, p) => n?.[p], DICTIONARY[lang]);
    assert(get('en') && get('ne'), `both languages have ${key}`);
  }
}

await testManifest();
await testIcons();
await testServiceWorker();
await testShell();
await testPwaModule();
await testI18n();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
