// PWA lifecycle: service-worker registration, update prompt, install prompt,
// offline banner, and Background Sync hook for the write queue.

import { t, onLangChange } from './i18n.js';

let deferredInstall = null;
let updateWaiting = null;

/** Register the service worker and wire update / sync listeners. */
export function initPwa() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          updateWaiting = worker;
          showUpdateBanner();
        }
      });
    });

    // Already waiting from a previous visit.
    if (reg.waiting) {
      updateWaiting = reg.waiting;
      showUpdateBanner();
    }
  }).catch((err) => console.warn('SW registration failed:', err));

  navigator.serviceWorker.addEventListener('message', async (event) => {
    if (event.data?.type === 'REPLAY_QUEUE') {
      const { replayQueue } = await import('./photoQueue.js');
      replayQueue().catch(() => {});
    }
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    showInstallBanner();
  });

  initOfflineBanner();
  onLangChange(refreshBanners);

  // iOS has no beforeinstallprompt — show manual instructions.
  if (isIos() && !isStandalone()) {
    showIosInstallHint();
  }
}

/** Request Background Sync replay when a write is queued offline. */
export async function requestQueueSync() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('sync' in reg) await reg.sync.register('farm-replay-queue');
  } catch { /* iOS / unsupported — foreground replay handles it */ }
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

function bannerHost() {
  let host = document.getElementById('pwa-banner-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pwa-banner-host';
    host.className = 'sticky top-[60px] z-20';
    const alertHost = document.getElementById('alert-host');
    alertHost?.insertAdjacentElement('afterend', host);
  }
  return host;
}

function showUpdateBanner() {
  const host = bannerHost();
  host.innerHTML = `
    <div class="bg-blue-800 text-white px-4 py-3 flex flex-wrap items-center gap-3 justify-between"
         role="status" aria-live="polite">
      <div>
        <p class="font-bold">${t('pwa.updateAvailable')}</p>
        <p class="text-sm opacity-90">${t('pwa.updateBody')}</p>
      </div>
      <button id="pwa-reload" type="button"
              class="bg-white text-blue-900 font-bold rounded-xl px-5 py-2 min-h-touch">
        ${t('pwa.reload')}
      </button>
    </div>`;
  host.querySelector('#pwa-reload').addEventListener('click', () => {
    if (updateWaiting) updateWaiting.postMessage({ type: 'SKIP_WAITING' });
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    setTimeout(() => location.reload(), 500);
  });
}

function showInstallBanner() {
  if (isStandalone() || document.getElementById('pwa-install-banner')) return;
  const host = bannerHost();
  const el = document.createElement('div');
  el.id = 'pwa-install-banner';
  el.className = 'bg-farm-green text-white px-4 py-3 flex flex-wrap items-center gap-3 justify-between';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', t('pwa.installTitle'));
  el.innerHTML = `
    <div>
      <p class="font-bold">${t('pwa.installTitle')}</p>
      <p class="text-sm opacity-90">${t('pwa.installBody')}</p>
    </div>
    <div class="flex gap-2">
      <button id="pwa-install" type="button"
              class="bg-white text-farm-green font-bold rounded-xl px-5 py-2 min-h-touch">
        ${t('pwa.installButton')}
      </button>
      <button id="pwa-install-dismiss" type="button"
              class="bg-white/20 font-bold rounded-xl px-4 py-2 min-h-touch"
              aria-label="${t('common.close')}">✕</button>
    </div>`;
  host.appendChild(el);
  el.querySelector('#pwa-install').addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    el.remove();
  });
  el.querySelector('#pwa-install-dismiss').addEventListener('click', () => el.remove());
}

function showIosInstallHint() {
  if (sessionStorage.getItem('farm.iosInstallDismissed')) return;
  if (document.getElementById('pwa-ios-hint')) return;
  const host = bannerHost();
  const el = document.createElement('div');
  el.id = 'pwa-ios-hint';
  el.className = 'bg-stone-800 text-white px-4 py-3 flex flex-wrap items-center gap-3 justify-between';
  el.innerHTML = `
    <div>
      <p class="font-bold">${t('pwa.iosInstallTitle')}</p>
      <p class="text-sm opacity-90">${t('pwa.iosInstallBody')}</p>
    </div>
    <button id="pwa-ios-dismiss" type="button"
            class="bg-white/20 font-bold rounded-xl px-4 py-2 min-h-touch"
            aria-label="${t('common.close')}">✕</button>`;
  host.appendChild(el);
  el.querySelector('#pwa-ios-dismiss').addEventListener('click', () => {
    sessionStorage.setItem('farm.iosInstallDismissed', '1');
    el.remove();
  });
}

function initOfflineBanner() {
  const render = () => {
    let bar = document.getElementById('offline-banner');
    if (navigator.onLine) {
      bar?.remove();
      return;
    }
    if (bar) return;
    bar = document.createElement('div');
    bar.id = 'offline-banner';
    bar.className = 'bg-amber-100 border-b-2 border-farm-amber text-farm-amber px-4 py-2 text-sm font-semibold text-center';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    bar.innerHTML = `<strong>${t('pwa.offlineTitle')}</strong> — ${t('pwa.offlineBody')}`;
    const header = document.querySelector('header');
    header?.insertAdjacentElement('afterend', bar);
  };
  window.addEventListener('online', render);
  window.addEventListener('offline', render);
  render();
}

function refreshBanners() {
  if (updateWaiting) showUpdateBanner();
  const offline = document.getElementById('offline-banner');
  if (offline) {
    offline.innerHTML = `<strong>${t('pwa.offlineTitle')}</strong> — ${t('pwa.offlineBody')}`;
  }
}
