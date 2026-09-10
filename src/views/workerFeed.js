// Worker task feed: occurrences sorted by urgency then due time, with the
// 30-minute completion rule (locked cards count down and auto-unlock) and
// the photo-proof pipeline — Canvas compression, camera capture, mandatory
// gate for photo-required tasks, and an IndexedDB offline queue.

import { t, formatSmartDateTime, formatDuration } from '../i18n.js';
import { escapeHtml, toast } from '../dom.js';
import { getSession } from '../auth.js';
import { serverNow } from '../api.js';
import {
  fetchTaskFeed, joinTasks, deriveStatus, sortForWorkerFeed, canComplete, completeOccurrence, isAssignedTo,
} from '../tasks.js';
import { compressImage, formatBytes } from '../images.js';
import { uploadPhoto, queueCompletion, replayQueue } from '../photoQueue.js';
import { renderAlertBanner, requestNotificationPermission, getTaskAlert } from '../alerts.js';
import { mountDateFilterBar } from './components/dateFilterBar.js';
import {
  defaultViewRange, inRange, loadViewRange,
} from '../dateRange.js';

const STATUS_BADGE = {
  pending: 'bg-stone-200 text-stone-700',
  dueSoon: 'bg-blue-100 text-blue-800',
  overdue: 'bg-amber-100 text-farm-amber',
  completed: 'bg-green-100 text-farm-green',
  missed: 'bg-red-100 text-farm-urgent',
};

const STATUS_LABEL_KEY = {
  pending: 'tasks.statusPending',
  dueSoon: 'tasks.statusDueSoon',
  overdue: 'tasks.statusOverdue',
  completed: 'tasks.statusCompleted',
  missed: 'tasks.statusMissed',
};

let countdownTimer = null;
let cardIndex = new Map();
let teardownFilter = null;

export async function render(container) {
  clearInterval(countdownTimer);
  if (teardownFilter) { teardownFilter(); teardownFilter = null; }
  container.innerHTML = `<p class="text-center text-stone-500 mt-8">${t('common.loading')}</p>`;
  const session = getSession();
  const saved = loadViewRange('worker');
  const range = defaultViewRange('worker');

  replayQueue().then((r) => { if (r.synced) render(container); }).catch(() => {});

  let feed;
  try {
    feed = await fetchTaskFeed(range);
    renderAlertBanner(feed.alerts, feed.tasks, session);
    requestNotificationPermission();
  } catch {
    container.innerHTML = `
      <div class="max-w-md mx-auto mt-8 bg-red-50 border-2 border-farm-urgent text-farm-urgent rounded-lg p-4 font-semibold">
        ${t('errors.network')}
      </div>`;
    return;
  }

  const alertTaskIds = new Set(
    (feed.alerts || []).filter((a) => a.active).map((a) => a.task_id)
  );

  const mine = joinTasks(feed.occurrences, feed.tasks)
    .filter((p) => isAssignedTo(p.task, session.accountId));

  const isAlwaysVisible = (p) => {
    const status = deriveStatus(p.occurrence);
    return status === 'overdue' || alertTaskIds.has(p.task.id);
  };

  const inRangeItems = mine.filter((p) => inRange(p.occurrence.due_at, range));
  const overdueExtra = mine.filter((p) => isAlwaysVisible(p) && !inRange(p.occurrence.due_at, range));

  const seen = new Set();
  const ranged = sortForWorkerFeed(inRangeItems.filter((p) => {
    if (seen.has(p.occurrence.id)) return false;
    seen.add(p.occurrence.id);
    return true;
  }));

  const overdueGroup = sortForWorkerFeed(overdueExtra.filter((p) => {
    if (seen.has(p.occurrence.id)) return false;
    seen.add(p.occurrence.id);
    return true;
  }));

  const allCards = [...ranged, ...overdueGroup];
  cardIndex = new Map(allCards.map((p) => [p.occurrence.id, p]));

  container.innerHTML = `
    <div class="max-w-xl mx-auto mt-2">
      <h2 class="text-2xl font-bold text-farm-green mb-4">${t('worker.myTasks')}</h2>

      <div id="date-filter-host"></div>

      ${ranged.length === 0 && overdueGroup.length === 0
        ? `<p class="text-center text-stone-500 py-10">${t('tasks.noTasks')}</p>`
        : `
          ${ranged.length > 0 ? `
            <ul class="space-y-3 mb-4">
              ${ranged.map(({ occurrence, task }) => cardHtml(occurrence, task, alertTaskIds.has(task.id))).join('')}
            </ul>` : ''}
          ${overdueGroup.length > 0 ? `
            <h3 class="text-lg font-bold text-farm-urgent mb-2">${t('filter.overdueGroup')}</h3>
            <ul class="space-y-3">
              ${overdueGroup.map(({ occurrence, task }) => cardHtml(occurrence, task, alertTaskIds.has(task.id))).join('')}
            </ul>` : ''}`}
    </div>
  `;

  const filterHost = container.querySelector('#date-filter-host');
  teardownFilter = mountDateFilterBar(filterHost, {
    viewKey: 'worker',
    preset: saved?.preset ?? range.preset,
    custom: saved?.custom ?? {},
    onChange: () => render(container),
  });

  wireCards(container, session);
  startCountdownTicker(container);
}

function cardHtml(occurrence, task, hasAlert) {
  const status = deriveStatus(occurrence);
  const urgent = task.priority === 'urgent' && ['pending', 'dueSoon', 'overdue'].includes(status);
  const actionable = status === 'pending' || status === 'dueSoon' || status === 'overdue';
  const gate = canComplete(occurrence);

  return `
  <li class="bg-white rounded-2xl shadow border-2 p-4 ${urgent ? 'border-farm-urgent' : 'border-farm-green/15'} ${hasAlert ? 'ring-2 ring-farm-urgent' : ''}"
      data-occ-id="${occurrence.id}">
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex-1 min-w-[10rem]">
        <p class="font-bold text-lg leading-tight">
          ${urgent ? '<span class="text-farm-urgent">⚠</span> ' : ''}${hasAlert ? '<span class="text-farm-urgent">🔔</span> ' : ''}${escapeHtml(task.title)}
        </p>
        ${task.description ? `<p class="text-sm text-stone-600 mt-0.5">${escapeHtml(task.description)}</p>` : ''}
        <p class="text-sm font-semibold text-stone-500 mt-1">
          🕒 ${formatSmartDateTime(occurrence.due_at)}
          ${task.photo_required ? ` · 📷 ${t('tasks.photoRequired')}` : ''}
          ${hasAlert ? ` · <span class="text-farm-urgent font-bold">${t('alerts.alertActive')}</span>` : ''}
        </p>
      </div>
      <span class="text-xs font-bold uppercase px-3 py-1.5 rounded-full ${STATUS_BADGE[status]}">
        ${t(STATUS_LABEL_KEY[status])}
      </span>
    </div>

    ${actionable ? `
      <div class="mt-3">
        ${gate.allowed ? `
          <button data-complete="${occurrence.id}"
                  class="w-full bg-farm-green text-white font-bold rounded-xl py-3 text-lg hover:bg-farm-greenLight transition-colors min-h-[44px]">
            ✓ ${t('worker.completeTask')}
          </button>`
        : `
          <button disabled data-locked="${occurrence.id}"
                  class="w-full bg-stone-200 text-stone-500 font-bold rounded-xl py-3 text-lg cursor-not-allowed min-h-[44px]">
            🔒 <span data-countdown="${occurrence.id}"
                     data-unlocks-at="${gate.unlocksAt.getTime()}">${countdownLabel(gate.unlocksAt)}</span>
          </button>`}
      </div>`
    : ''}
  </li>`;
}

function countdownLabel(unlocksAt) {
  return t('worker.unlocksIn', { time: formatDuration(unlocksAt.getTime() - serverNow().getTime()) });
}

function startCountdownTicker(container) {
  const els = container.querySelectorAll('[data-countdown]');
  if (els.length === 0) return;

  countdownTimer = setInterval(() => {
    let anyUnlocked = false;
    els.forEach((el) => {
      const unlocksAtMs = Number(el.dataset.unlocksAt);
      const remaining = unlocksAtMs - serverNow().getTime();
      if (remaining <= 0) {
        anyUnlocked = true;
      } else {
        el.textContent = t('worker.unlocksIn', { time: formatDuration(remaining) });
      }
    });
    if (anyUnlocked) {
      clearInterval(countdownTimer);
      render(container);
    }
  }, 1000);
}

function wireCards(container, session) {
  container.querySelectorAll('[data-complete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pair = cardIndex.get(btn.dataset.complete);
      if (pair) openCompletionModal(container, session, pair.occurrence, pair.task);
    });
  });
}

function openCompletionModal(container, session, occurrence, task) {
  const host = document.getElementById('modal-host');
  let photo = null;

  host.innerHTML = `
    <div class="absolute inset-0 bg-black/50" data-close></div>
    <div class="absolute inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                sm:max-w-md sm:w-full bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-6
                max-h-[92vh] overflow-y-auto">
      <h3 class="text-xl font-bold text-farm-green mb-1">${t('worker.completeTask')}</h3>
      <p class="text-sm text-stone-600 mb-4">${escapeHtml(task.title)}</p>

      <div class="mb-4">
        <span class="block font-semibold mb-1">
          📷 ${t('worker.attachPhoto')}
          ${task.photo_required
            ? `<span class="text-farm-urgent"> (${t('common.required')})</span>`
            : `<span class="text-stone-500"> (${t('common.optional')})</span>`}
        </span>

        <div id="cm-photo-empty" class="grid grid-cols-2 gap-2">
          <button type="button" id="cm-take"
                  class="rounded-lg border-2 border-farm-green text-farm-green font-bold py-3 min-h-[44px]">
            ${t('worker.takePhoto')}
          </button>
          <button type="button" id="cm-choose"
                  class="rounded-lg border-2 border-stone-400 text-stone-600 font-bold py-3 min-h-[44px]">
            ${t('worker.choosePhoto')}
          </button>
        </div>

        <div id="cm-photo-preview" class="hidden">
          <img id="cm-preview-img" alt="" class="w-full rounded-xl border-2 border-farm-green/30 max-h-64 object-cover" />
          <p id="cm-photo-meta" class="text-sm text-stone-500 mt-1"></p>
          <button type="button" id="cm-retake"
                  class="mt-2 w-full rounded-lg border-2 border-stone-400 text-stone-600 font-bold py-2 min-h-[44px]">
            ${t('worker.retake')}
          </button>
        </div>

        <input id="cm-file-camera" type="file" accept="image/*" capture="environment" class="hidden" />
        <input id="cm-file-gallery" type="file" accept="image/*" class="hidden" />
      </div>

      <label class="block font-semibold mb-1" for="cm-note">${t('worker.addNote')}</label>
      <textarea id="cm-note" rows="2" maxlength="1000" placeholder="${t('worker.notePlaceholder')}"
                class="w-full rounded-lg border-2 border-stone-300 px-3 py-2 mb-4"></textarea>

      <p id="cm-error" role="alert" class="hidden text-farm-urgent font-semibold mb-3"></p>

      <div class="flex gap-3">
        <button type="button" data-close
                class="flex-1 rounded-lg border-2 border-stone-300 py-3 font-bold text-stone-600 min-h-[44px]">
          ${t('common.cancel')}
        </button>
        <button id="cm-confirm"
                class="flex-1 rounded-lg bg-farm-green text-white py-3 font-bold hover:bg-farm-greenLight transition-colors min-h-[44px]">
          ${t('common.confirm')}
        </button>
      </div>
    </div>
  `;
  host.classList.remove('hidden');

  const close = () => {
    if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    host.classList.add('hidden');
    host.innerHTML = '';
  };
  host.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));

  const errorEl = host.querySelector('#cm-error');
  const showError = (msg) => { errorEl.textContent = msg; errorEl.classList.remove('hidden'); };
  const hideError = () => errorEl.classList.add('hidden');

  async function handleFile(file) {
    if (!file) return;
    hideError();
    try {
      const result = await compressImage(file);
      if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
      photo = { ...result, previewUrl: URL.createObjectURL(result.blob) };
      host.querySelector('#cm-preview-img').src = photo.previewUrl;
      host.querySelector('#cm-photo-meta').textContent =
        `${formatBytes(photo.originalBytes)} → ${formatBytes(photo.compressedBytes)}`;
      host.querySelector('#cm-photo-empty').classList.add('hidden');
      host.querySelector('#cm-photo-preview').classList.remove('hidden');
    } catch {
      showError(t('errors.generic'));
    }
  }

  const cameraInput = host.querySelector('#cm-file-camera');
  const galleryInput = host.querySelector('#cm-file-gallery');
  host.querySelector('#cm-take').addEventListener('click', () => cameraInput.click());
  host.querySelector('#cm-choose').addEventListener('click', () => galleryInput.click());
  cameraInput.addEventListener('change', () => handleFile(cameraInput.files[0]));
  galleryInput.addEventListener('change', () => handleFile(galleryInput.files[0]));
  host.querySelector('#cm-retake').addEventListener('click', () => {
    if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    photo = null;
    cameraInput.value = '';
    galleryInput.value = '';
    host.querySelector('#cm-photo-preview').classList.add('hidden');
    host.querySelector('#cm-photo-empty').classList.remove('hidden');
  });

  host.querySelector('#cm-confirm').addEventListener('click', async () => {
    hideError();
    if (task.photo_required && !photo) {
      showError(t('worker.photoMissing'));
      return;
    }

    const note = host.querySelector('#cm-note').value;
    const confirmBtn = host.querySelector('#cm-confirm');
    confirmBtn.disabled = true;

    try {
      const photoKey = photo ? await uploadPhoto(photo.blob) : undefined;
      await completeOccurrence(occurrence.id, note, session.accountId, photoKey);
      close();
      toast(t('worker.completedSuccess'));
      render(container);
    } catch (err) {
      if (err.code === 'network') {
        try {
          await queueCompletion({
            occurrenceId: occurrence.id,
            accountId: session.accountId,
            note,
            photoBlob: photo?.blob ?? null,
          });
          close();
          toast(t('worker.photoQueued'));
          render(container);
        } catch {
          confirmBtn.disabled = false;
          showError(t('errors.generic'));
        }
      } else if (err.code === 'too_early') {
        close();
        toast(t('worker.cannotCompleteYet'), 'error');
        render(container);
      } else if (err.code === 'photo_required') {
        confirmBtn.disabled = false;
        showError(t('worker.photoMissing'));
      } else {
        confirmBtn.disabled = false;
        showError(t('errors.generic'));
      }
    }
  });
}
