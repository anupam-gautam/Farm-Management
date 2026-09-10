// Sync engine: poll loop, write-queue reconciliation, status reporting.
//
//   - Polls /api/tasks + /api/alerts every POLL_INTERVAL_MS while the page is
//     visible; pauses when hidden; resumes (immediately) on visibility return.
//   - Exponential backoff on failure (×1.5, capped at 2 min), reset on success.
//   - Replays the offline photo queue before each poll (write queue).
//   - Detects data changes by hashing ids+statuses, and only then notifies
//     subscribers — views re-render on real changes, not on every poll.
//   - Tracks newly-seen alert ids so the chime fires once per alert.

import { CONFIG, storageKey } from './config.js';
import { api } from './api.js';
import { getSession } from './auth.js';
import { replayQueue } from './photoQueue.js';
import { countPendingPhotos } from './db.js';

const MAX_BACKOFF_MS = 120_000;

let timer = null;
let failCount = 0;
let lastSyncAt = null;
let lastDataHash = '';
let syncing = false;
let seenAlertIds = new Set(
  JSON.parse(localStorage.getItem(storageKey('seenAlerts')) || '[]')
);

const eventListeners = new Set();
const statusListeners = new Set();

export function onSyncEvent(fn) { eventListeners.add(fn); }
export function onSyncStatus(fn) { statusListeners.add(fn); }

function emitStatus(status) {
  statusListeners.forEach((fn) => fn(status));
}

export function getSyncState() {
  return {
    lastSyncAt,
    online: navigator.onLine,
    pendingCount: 0, // refreshed by callers via refreshPendingCount
  };
}

export async function pendingCount() {
  try {
    return await countPendingPhotos();
  } catch {
    return 0;
  }
}

function hashData(feed, alerts) {
  const occ = feed.occurrences.map((o) => `${o.id}:${o.status}`).join(',');
  const al = alerts.map((a) => `${a.id}:${a.active}`).join(',');
  return `${occ}|${al}`;
}

async function tick() {
  const session = getSession();
  if (!session) { emitStatus('idle'); return; }
  if (document.hidden) return; // paused while hidden; visibilitychange resumes
  if (syncing) return;
  syncing = true;

  const queued = await pendingCount();
  emitStatus(!navigator.onLine ? 'offline' : queued > 0 ? 'pending' : 'syncing');

  try {
    // Write queue first: flush offline completions before reading state.
    const replay = await replayQueue();

    const [feedData, alertsData] = await Promise.all([
      api('/api/tasks'),
      api('/api/alerts'),
    ]);

    failCount = 0;
    lastSyncAt = new Date().toISOString();

    const hash = hashData(feedData, alertsData.alerts);
    const changed = hash !== lastDataHash;
    lastDataHash = hash;

    // Newly-seen active alerts (for the chime/notification).
    const newAlerts = alertsData.alerts.filter((a) => !seenAlertIds.has(a.id));
    if (newAlerts.length) {
      newAlerts.forEach((a) => seenAlertIds.add(a.id));
      localStorage.setItem(storageKey('seenAlerts'), JSON.stringify([...seenAlertIds].slice(-200)));
    }

    const remaining = await pendingCount();
    emitStatus(remaining > 0 ? 'pending' : 'synced');

    if (changed || newAlerts.length || replay.synced) {
      eventListeners.forEach((fn) => fn({
        feed: feedData,
        alerts: alertsData.alerts,
        newAlerts,
        changed,
      }));
    }
  } catch (err) {
    failCount++;
    emitStatus(err.code === 'network' ? 'offline' : 'pending');
  } finally {
    syncing = false;
  }
}

function scheduleNext() {
  clearTimeout(timer);
  const backoff = Math.min(
    CONFIG.POLL_INTERVAL_MS * Math.pow(1.5, failCount),
    MAX_BACKOFF_MS
  );
  timer = setTimeout(async () => { await tick(); scheduleNext(); }, backoff);
}

/** Start the loop (idempotent). Call once at app init. */
export function startSyncLoop() {
  if (timer) return;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick(); // immediate refresh on return to the tab
  });
  tick();
  scheduleNext();
}

/** Manual "sync now" from the settings panel. */
export async function syncNow() {
  await tick();
  scheduleNext();
}
