// Urgent alert presentation: pulsing banner, WebAudio chime, notifications.
//
// The chime is synthesized with the Web Audio API (no audio asset to cache or
// deploy). Browsers block audio until the first user gesture, so the
// AudioContext is unlocked on first interaction; the pulsing banner is always
// the primary signal, sound is the enhancement.

import { t, formatRelative } from './i18n.js';
import { escapeHtml } from './dom.js';
import { api } from './api.js';
import { storageKey } from './config.js';

// ---------------------------------------------------------------------------
// Mute preference
// ---------------------------------------------------------------------------
export function isMuted() {
  return localStorage.getItem(storageKey('muteAlerts')) === '1';
}
export function toggleMute() {
  localStorage.setItem(storageKey('muteAlerts'), isMuted() ? '0' : '1');
  return !isMuted();
}

// ---------------------------------------------------------------------------
// WebAudio chime (two-tone, three pulses)
// ---------------------------------------------------------------------------
let audioCtx = null;

// Unlock on first user gesture (browser autoplay policy).
export function initAudioUnlock() {
  const unlock = () => {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* unsupported */ }
    }
    audioCtx?.resume?.();
  };
  ['click', 'touchstart', 'keydown'].forEach((evt) =>
    window.addEventListener(evt, unlock, { once: true, passive: true })
  );
}

export function playChime() {
  if (isMuted() || !audioCtx) return;
  const notes = [880, 660];
  for (let pulse = 0; pulse < 3; pulse++) {
    notes.forEach((freq, i) => {
      const start = audioCtx.currentTime + pulse * 0.5 + i * 0.18;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  }
}

// ---------------------------------------------------------------------------
// Browser notification
// ---------------------------------------------------------------------------
export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

export function notifyAlert(message) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(`⚠ ${t('alerts.urgentAlert')}`, { body: message });
  } catch { /* some mobile browsers throw without a service worker */ }
}

// ---------------------------------------------------------------------------
// Banner (rendered into #alert-host, above the view)
// ---------------------------------------------------------------------------

/** Active alerts relevant to this user: workers see alerts for their tasks. */
export function alertsForSession(alerts, tasks, session) {
  if (!session) return [];
  if (session.role === 'owner') return alerts;
  const myTaskIds = new Set(
    tasks.filter((x) => {
      const ids = x.assigned_account_ids?.length
        ? x.assigned_account_ids
        : (x.assigned_account_id ? [x.assigned_account_id] : []);
      return ids.includes(session.accountId);
    }).map((x) => x.id)
  );
  return alerts.filter((a) => myTaskIds.has(a.task_id));
}

export function renderAlertBanner(alerts, tasks, session) {
  const host = document.getElementById('alert-host');
  if (!host) return;
  const mine = alertsForSession(alerts, tasks, session);

  if (session?.role !== 'worker' || mine.length === 0) {
    host.innerHTML = '';
    return;
  }

  host.innerHTML = mine.map((alert) => {
    const task = tasks.find((x) => x.id === alert.task_id);
    return `
    <div class="bg-farm-urgent text-white animate-urgent shadow-lg">
      <div class="max-w-xl mx-auto px-4 py-3 flex items-center gap-3">
        <span class="text-2xl" aria-hidden="true">⚠</span>
        <div class="flex-1 min-w-0">
          <p class="font-extrabold tracking-wide">${t('alerts.urgentAlert')}</p>
          <p class="text-sm font-semibold truncate">
            <strong>${escapeHtml(task?.title || 'Task')}</strong>
          </p>
          ${alert.message ? `<p class="text-sm truncate">${escapeHtml(alert.message)}</p>` : ''}
          <p class="text-xs opacity-80">${formatRelative(alert.raised_at)}</p>
        </div>
        <button data-ack="${alert.id}"
                class="bg-white text-farm-urgent font-bold rounded-lg px-4 py-2 shrink-0">
          ${t('alerts.acknowledge')}
        </button>
      </div>
    </div>`;
  }).join('');

  host.querySelectorAll('[data-ack]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api('/api/alerts', {
          method: 'POST',
          headers: { 'x-account-id': session.accountId },
          body: { action: 'acknowledge', id: btn.dataset.ack },
        });
      } catch { /* next poll reconciles */ }
      btn.closest('div.bg-farm-urgent')?.remove();
    });
  });
}

export function getTaskAlert(taskId, alerts) {
  return alerts.find((a) => a.task_id === taskId && a.active);
}
