// Application bootstrap: hash router with role guards, top-bar wiring, init sequence.
// All user-facing strings go through i18n.t() — no literals here.

import { t, getLang, setLang, onLangChange } from './i18n.js';
import { onCalendarChange } from './dateRange.js';
import { api } from './api.js';
import { getSession, logout, onSessionExpired } from './auth.js';
import { startSyncLoop, onSyncStatus, onSyncEvent } from './sync.js';
import {
  initAudioUnlock, renderAlertBanner, alertsForSession, playChime, notifyAlert,
} from './alerts.js';
import { initPwa } from './pwa.js';

// ---------------------------------------------------------------------------
// Hash router with role guards
// ---------------------------------------------------------------------------
const routes = {
  '#/login': { load: () => import('./views/login.js'), guard: 'guest' },
  '#/worker': { load: () => import('./views/workerFeed.js'), guard: 'any' },
  '#/dashboard': { load: () => import('./views/ownerDashboard.js'), guard: 'owner' },
  '#/workers': { load: () => import('./views/workers.js'), guard: 'owner' },
  '#/gallery': { load: () => import('./views/gallery.js'), guard: 'owner' },
  '#/settings': { load: () => import('./views/settings.js'), guard: 'owner' },
  '#/analytics': { load: () => import('./views/analytics.js'), guard: 'owner' },
};

const DEFAULT_ROUTE = '#/login';

function currentRoute() {
  return window.location.hash || DEFAULT_ROUTE;
}

/** Returns the hash to redirect to, or null if access is allowed. */
function guardRedirect(guard) {
  const session = getSession();
  if (guard === 'guest') {
    if (session) return session.role === 'owner' ? '#/dashboard' : '#/worker';
    return null;
  }
  if (!session) return '#/login';
  if (guard === 'owner' && session.role !== 'owner') return '#/worker';
  return null;
}

async function renderRoute() {
  const hash = currentRoute();
  const route = routes[hash] || routes[DEFAULT_ROUTE];

  const redirect = guardRedirect(route.guard);
  if (redirect) {
    window.location.hash = redirect; // triggers hashchange → re-render
    return;
  }

  updateChromeForSession();

  const container = document.getElementById('view-container');
  try {
    const mod = await route.load();
    container.innerHTML = '';
    await mod.render(container);
  } catch (err) {
    console.error('Failed to load view:', err);
    container.innerHTML = `
      <div class="bg-red-50 border-2 border-farm-urgent text-farm-urgent rounded-lg p-4 font-semibold">
        ${t('errors.loadFailed')}
      </div>`;
  }
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------
function applyLanguageToChrome() {
  document.getElementById('app-title').textContent = t('common.appName');
  document.getElementById('logout-btn').textContent = t('common.logout');
  document.getElementById('lang-toggle').textContent = getLang() === 'en' ? 'नेपाली' : 'EN';
  document.getElementById('lang-toggle').setAttribute('aria-label', t('common.language'));
  document.documentElement.lang = getLang();
}

/** Show/hide role badge + logout based on session state. */
function updateChromeForSession() {
  const session = getSession();
  const badge = document.getElementById('role-badge');
  const logoutBtn = document.getElementById('logout-btn');
  if (session) {
    badge.textContent = `${session.displayName} · ${t('roles.' + session.role)}`;
    badge.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
    logoutBtn.classList.add('hidden');
  }
}

function initTopBar() {
  document.getElementById('lang-toggle').addEventListener('click', () => {
    setLang(getLang() === 'en' ? 'ne' : 'en');
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    logout();
    window.location.hash = '#/login';
    updateChromeForSession();
  });

  setSyncStatus('idle');
}

// Sync status: 'idle' | 'synced' | 'syncing' | 'pending' | 'offline'
// Phase 7 drives this; exposed now so later phases don't touch the DOM directly.
export function setSyncStatus(status) {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  const indicator = document.getElementById('sync-indicator');
  indicator?.setAttribute('aria-label', t('sync.statusLabel'));
  const styles = {
    idle: ['bg-gray-300', '—'],
    synced: ['bg-green-400', t('sync.synced')],
    syncing: ['bg-blue-400 animate-pulse', t('sync.syncing')],
    pending: ['bg-amber-400', t('sync.pending')],
    offline: ['bg-red-500', t('sync.offline')],
  };
  const [dotClass, text] = styles[status] || styles.idle;
  dot.className = `inline-block w-3 h-3 rounded-full ${dotClass}`;
  label.textContent = text;
  const sr = document.getElementById('sync-sr');
  if (sr) sr.textContent = text;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  initPwa();
  initTopBar();
  applyLanguageToChrome(); // applies language before first view paint

  // One subscription: language change re-renders chrome + current view.
  onLangChange(() => {
    applyLanguageToChrome();
    renderRoute();
  });

  onCalendarChange(() => renderRoute());

  // Session inactivity expiry → back to login.
  onSessionExpired(() => {
    window.location.hash = '#/login';
    updateChromeForSession();
  });

  window.addEventListener('hashchange', renderRoute);

  // Replay offline-queued photo completions when connectivity returns.
  window.addEventListener('online', async () => {
    const { replayQueue } = await import('./photoQueue.js');
    replayQueue().then((r) => { if (r.synced) renderRoute(); }).catch(() => {});
  });

  // 7-day local photo lifecycle: purge stale queued photos on app init.
  import('./db.js').then((m) => m.purgeStalePendingPhotos()).catch(() => {});

  // Sync engine: status dot, alert banner/chime, change-driven re-renders.
  onSyncStatus(setSyncStatus);
  initAudioUnlock();
  onSyncEvent(({ feed, alerts, newAlerts, changed }) => {
    const session = getSession();
    renderAlertBanner(alerts, feed.tasks, session);

    // Chime + notify only for alerts relevant to this user.
    const mine = alertsForSession(newAlerts, feed.tasks, session);
    if (mine.length) {
      playChime();
      notifyAlert(mine[0].message || t('alerts.urgentAlert'));
    }

    // Re-render the current view on real data changes — but never while a
    // modal (task editor, completion dialog) is open.
    const modalOpen = !document.getElementById('modal-host').classList.contains('hidden');
    if (changed && !modalOpen && currentRoute() !== '#/login') {
      renderRoute();
    }
  });
  startSyncLoop();

  // Ensure schema + seed exist before anything else touches the API.
  try {
    await api('/api/bootstrap');
  } catch (err) {
    console.error('Bootstrap failed:', err);
    // Non-fatal: the login view will surface a network error on submit.
  }

  if (!window.location.hash) {
    window.location.hash = DEFAULT_ROUTE;
  } else {
    renderRoute();
  }
}

init();
