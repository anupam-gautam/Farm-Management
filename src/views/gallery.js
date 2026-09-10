// Owner photo verification gallery: thumbnail grid of completion photos with
// task/worker context, date + worker filters, full-screen viewer, and purged
// placeholders (photos auto-delete after 7 days — Phase 6 — but the text log
// remains and is shown here).

import { t, formatDateTime, formatNumber } from '../i18n.js';
import { escapeHtml } from '../dom.js';
import { api } from '../api.js';
import { CONFIG } from '../config.js';
import { mountDateFilterBar } from './components/dateFilterBar.js';
import {
  defaultViewRange, inRange, describeRange, loadViewRange, rangeToQuery, PRESETS,
} from '../dateRange.js';

let teardownFilter = null;

function photoSrc(key) {
  return key.startsWith('https://') ? key : `/api/photos?key=${encodeURIComponent(key)}`;
}

function daysUntilPurge(log) {
  const purgeAt = new Date(log.completed_at).getTime() + CONFIG.PHOTO_TTL_HOURS * 3600_000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / 86_400_000));
}

export async function render(container) {
  if (teardownFilter) { teardownFilter(); teardownFilter = null; }
  container.innerHTML = `<p class="text-center text-stone-500 mt-8">${t('common.loading')}</p>`;

  const saved = loadViewRange('gallery');
  const range = defaultViewRange('gallery');
  const qs = rangeToQuery(range);

  let logs;
  try {
    ({ logs } = await api(`/api/logs${qs ? `?${qs}` : ''}`));
  } catch {
    container.innerHTML = `
      <div class="max-w-md mx-auto mt-8 bg-red-50 border-2 border-farm-urgent text-farm-urgent rounded-lg p-4 font-semibold">
        ${t('errors.network')}
      </div>`;
    return;
  }

  renderGallery(container, logs, {}, range, saved?.preset ?? range.preset, saved?.custom ?? {});
}

function renderGallery(container, logs, filters, range, preset, custom) {
  const withPhotos = logs.filter((l) => l.photo_status !== 'none');
  const rangeLabel = describeRange(range);

  const workerNames = [...new Set(withPhotos.map((l) => l.completed_by_name))];

  const filtered = withPhotos.filter((l) => {
    if (filters.worker && l.completed_by_name !== filters.worker) return false;
    if (!inRange(l.completed_at, range)) return false;
    return true;
  });

  container.innerHTML = `
    <div class="max-w-3xl mx-auto mt-2">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 class="text-2xl font-bold text-farm-green">${t('gallery.title')}</h2>
        <a href="#/dashboard" class="text-farm-green font-semibold underline text-sm min-h-touch flex items-center">
          ← ${t('common.back')}
        </a>
      </div>

      <div id="date-filter-host"></div>

      <div class="flex flex-wrap gap-2 mb-4">
        <select id="gf-worker" class="rounded-xl border-2 border-stone-300 px-3 bg-white font-semibold min-h-[44px]">
          <option value="">${t('tasks.allWorkers')}</option>
          ${workerNames.map((n) => `
            <option value="${escapeHtml(n)}" ${filters.worker === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
        </select>
      </div>

      ${filtered.length === 0
        ? `<div class="text-center py-10">
            <p class="text-stone-500 mb-3">${t('filter.rangeEmpty', { range: rangeLabel })}</p>
            <button type="button" id="show-all-btn"
                    class="min-h-[44px] px-5 rounded-xl border-2 border-farm-green text-farm-green font-bold">
              ${t('filter.showAll')}
            </button>
          </div>`
        : `<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            ${filtered.map((log) => log.photo_status === 'purged' ? `
              <div class="bg-stone-100 rounded-xl border-2 border-dashed border-stone-300 p-3 flex flex-col items-center justify-center text-center min-h-[10rem]">
                <span class="text-2xl" aria-hidden="true">🗑</span>
                <p class="text-xs font-semibold text-stone-500 mt-1">${t('gallery.photoPurged')}</p>
                <p class="text-xs text-stone-500 mt-1">${escapeHtml(log.task_title_snapshot)}</p>
                <p class="text-xs text-stone-400">${formatDateTime(log.completed_at)}</p>
              </div>`
            : `
              <button data-view="${log.id}" class="group bg-white rounded-xl shadow border-2 border-farm-green/15 overflow-hidden text-left p-0">
                <img src="${photoSrc(log.photo_blob_key)}" alt="${escapeHtml(log.task_title_snapshot)}"
                     loading="lazy" class="w-full h-32 object-cover" />
                <div class="p-2">
                  <p class="font-bold text-sm leading-tight truncate">${escapeHtml(log.task_title_snapshot)}</p>
                  <p class="text-xs text-stone-500">${escapeHtml(log.completed_by_name)}</p>
                  <p class="text-xs text-stone-400">${formatDateTime(log.completed_at)}</p>
                  <p class="text-xs text-farm-amber font-semibold mt-0.5">
                    ${t('gallery.expiresIn', { days: formatNumber(daysUntilPurge(log)) })}
                  </p>
                </div>
              </button>`).join('')}
          </div>`}
    </div>
  `;

  const filterHost = container.querySelector('#date-filter-host');
  teardownFilter = mountDateFilterBar(filterHost, {
    viewKey: 'gallery',
    preset,
    custom,
    onChange: () => render(container),
  });

  container.querySelector('#gf-worker')?.addEventListener('change', (e) => {
    renderGallery(container, logs, { ...filters, worker: e.target.value || null }, range, preset, custom);
  });

  container.querySelector('#show-all-btn')?.addEventListener('click', async () => {
    const { saveViewRange } = await import('../dateRange.js');
    saveViewRange('gallery', { preset: PRESETS.ALL, custom: {} });
    render(container);
  });

  container.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const log = filtered.find((l) => l.id === btn.dataset.view);
      if (log) openViewer(log);
    });
  });
}

function openViewer(log) {
  const host = document.getElementById('modal-host');
  host.innerHTML = `
    <div class="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-4" data-close>
      <img src="${photoSrc(log.photo_blob_key)}" alt="${escapeHtml(log.task_title_snapshot)}"
           class="max-w-full max-h-[70vh] rounded-xl object-contain" />
      <div class="bg-white rounded-xl mt-4 p-4 w-full max-w-md text-left" onclick="event.stopPropagation()">
        <p class="font-bold text-lg">${escapeHtml(log.task_title_snapshot)}</p>
        <p class="text-sm text-stone-600">${t('gallery.takenBy')}: ${escapeHtml(log.completed_by_name)}</p>
        <p class="text-sm text-stone-600">${t('gallery.takenAt')}: ${formatDateTime(log.completed_at)}</p>
        ${log.worker_note ? `<p class="text-sm text-stone-800 mt-2 border-l-4 border-farm-green/40 pl-3">${escapeHtml(log.worker_note)}</p>` : ''}
        <button data-close class="mt-4 w-full rounded-lg bg-farm-green text-white font-bold py-3 min-h-[44px]">
          ${t('common.close')}
        </button>
      </div>
    </div>
  `;
  host.classList.remove('hidden');
  host.querySelectorAll('[data-close]').forEach((el) =>
    el.addEventListener('click', () => { host.classList.add('hidden'); host.innerHTML = ''; })
  );
}
