// Service worker — precache shell, runtime caching, offline fallback.
// Bump CACHE_VERSION on every deploy that changes static assets.

const CACHE_VERSION = 'farm-v10-5';
const PRECACHE = `precache-${CACHE_VERSION}`;
const RUNTIME = `runtime-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/robots.txt',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/src/main.js',
  '/src/pwa.js',
  '/src/config.js',
  '/src/i18n.js',
  '/src/i18n-dictionary.js',
  '/src/api.js',
  '/src/auth.js',
  '/src/sync.js',
  '/src/tasks.js',
  '/src/dom.js',
  '/src/alerts.js',
  '/src/db.js',
  '/src/images.js',
  '/src/photoQueue.js',
  '/src/backup.js',
  '/src/seed.js',
  '/src/charts.js',
  '/src/nepaliDate.js',
  '/src/dateRange.js',
  '/vendor/nepali-date-converter.es.js',
  '/src/views/components/dateFilterBar.js',
  '/src/views/recurringChoice.js',
  '/src/views/login.js',
  '/src/views/workerFeed.js',
  '/src/views/ownerDashboard.js',
  '/src/views/taskEditor.js',
  '/src/views/gallery.js',
  '/src/views/workers.js',
  '/src/views/settings.js',
  '/src/views/analytics.js',
];

const CDN_HOSTS = ['cdn.tailwindcss.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![PRECACHE, RUNTIME, API_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isApiGet(request) {
  return request.method === 'GET' && new URL(request.url).pathname.startsWith('/api/');
}

function isStaticAsset(url) {
  const { pathname } = new URL(url);
  return pathname.startsWith('/src/') ||
    pathname.startsWith('/icons/') ||
    pathname.endsWith('.html') ||
    pathname === '/manifest.json';
}

function isCdn(url) {
  return CDN_HOSTS.some((h) => url.includes(h));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = request.url;

  // Navigation: network-first, offline.html fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match('/index.html'))
        .catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // API reads: network-first, cache fallback for offline cached data.
  if (isApiGet(request)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(API_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Tailwind CDN: cache-first after first fetch.
  if (isCdn(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put(request, copy));
          return res;
        });
      })
    );
    return;
  }

  // Same-origin static assets: cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put(request, copy));
          return res;
        })
      )
    );
    return;
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Background Sync: nudge open clients to replay the offline write queue.
self.addEventListener('sync', (event) => {
  if (event.tag === 'farm-replay-queue') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: 'REPLAY_QUEUE' }));
      })
    );
  }
});
