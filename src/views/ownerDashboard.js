// Owner dashboard: overview counters, task occurrence list with worker/status
// filters, assign-task drawer, edit/delete. Photo gallery, analytics and
// backup arrive in Phases 5–8.

import { t, formatSmartDateTime } from '../i18n.js';
import { escapeHtml, toast } from '../dom.js';
import { getSession, fetchAccounts, ownerGuardHeaders } from '../auth.js';
import { api } from '../api.js';
import { fetchTaskFeed, joinTasks, deriveStatus, countByStatus, cancelOccurrence, taskAssigneeIds } from '../tasks.js';
import { openTaskEditor } from './taskEditor.js';
import { openRecurringChoice } from './recurringChoice.js';
import { mountDateFilterBar } from './components/dateFilterBar.js';
import { getTaskAlert } from '../alerts.js';
import {
  defaultViewRange, inRange, describeRange, loadViewRange,
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

let teardownFilter = null;
/** Retained across date-range changes and full reloads within the session. */
let dashboardListFilters = { workerId: null, status: null };

export async function render(container) {
  if (teardownFilter) { teardownFilter(); teardownFilter = null; }
  container.innerHTML = `<p class="text-center text-stone-500 mt-8">${t('common.loading')}</p>`;
  const session = getSession();
  const saved = loadViewRange('dashboard');
  const range = defaultViewRange('dashboard');

  let feed, workers;
  try {
    [feed, workers] = await Promise.all([
      fetchTaskFeed(range),
      fetchAccounts(true).then((a) => a.filter((x) => x.role === 'worker' && x.active)),
    ]);
  } catch {
    container.innerHTML = `
      <div class="max-w-md mx-auto mt-8 bg-red-50 border-2 border-farm-urgent text-farm-urgent rounded-lg p-4 font-semibold">
        ${t('errors.network')}
      </div>`;
    return;
  }

  renderDashboard(container, {
    session, feed, workers, filters: dashboardListFilters, range,
    preset: saved?.preset ?? range.preset,
    custom: saved?.custom ?? {},
  });
}

function renderDashboard(container, { session, feed, workers, filters, range, preset, custom }) {
  const inRangeOcc = feed.occurrences.filter((o) => inRange(o.due_at, range));
  const pairs = joinTasks(inRangeOcc, feed.tasks);
  const counts = countByStatus(inRangeOcc);
  const rangeLabel = describeRange(range);

  const filtered = pairs.filter((p) => {
    if (filters.workerId && !taskAssigneeIds(p.task).includes(filters.workerId)) return false;
    if (filters.status && deriveStatus(p.occurrence) !== filters.status) return false;
    return true;
  }).sort((a, b) => new Date(a.occurrence.due_at) - new Date(b.occurrence.due_at));

  const workerName = (id) =>
    workers.find((w) => w.id === id)?.display_name ?? '—';

  container.innerHTML = `
    <div class="max-w-3xl mx-auto mt-2">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 class="text-2xl font-bold text-farm-green">
          ${t('auth.welcome')}, ${escapeHtml(session?.displayName ?? '')}
        </h2>
        <div class="flex gap-4 text-sm font-semibold">
          <a href="#/gallery" class="text-farm-green underline min-h-touch flex items-center">${t('nav.gallery')}</a>
          <a href="#/analytics" class="text-farm-green underline min-h-touch flex items-center">${t('nav.analytics')}</a>
          <a href="#/workers" class="text-farm-green underline min-h-touch flex items-center">${t('workers.manageWorkers')}</a>
          <a href="#/settings" class="text-farm-green underline min-h-touch flex items-center">${t('nav.settings')}</a>
        </div>
      </div>

      <div id="date-filter-host"></div>

      <p class="text-sm text-stone-500 mb-3 text-center">${t('filter.rangeLabel', { range: rangeLabel })}</p>

      <!-- Overview counters (for visible range) -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        ${[
          [t('owner.totalTasks'), counts.total, 'text-farm-ink'],
          [t('owner.completedTasks'), counts.completed, 'text-farm-green'],
          [t('owner.pendingTasks'), counts.pending + counts.dueSoon, 'text-blue-800'],
          [t('owner.overdueTasks'), counts.overdue + counts.missed, 'text-farm-urgent'],
        ].map(([label, n, cls]) => `
          <div class="bg-white rounded-2xl shadow border-2 border-farm-green/15 p-4 text-center">
            <p class="text-3xl font-extrabold ${cls}">${n}</p>
            <p class="text-sm font-semibold text-stone-600">${label}</p>
          </div>`).join('')}
      </div>

      <!-- Assign + filters -->
      <div class="flex flex-wrap gap-2 mb-4">
        <button id="assign-btn"
                class="flex-1 min-w-[10rem] bg-farm-green text-white font-bold rounded-xl py-3 hover:bg-farm-greenLight transition-colors">
          ＋ ${t('owner.assignTask')}
        </button>
        <select id="filter-worker" class="rounded-xl border-2 border-stone-300 px-3 bg-white font-semibold min-h-[44px]">
          <option value="">${t('tasks.allWorkers')}</option>
          ${workers.map((w) => `
            <option value="${w.id}" ${filters.workerId === w.id ? 'selected' : ''}>${escapeHtml(w.display_name)}</option>`).join('')}
        </select>
        <select id="filter-status" class="rounded-xl border-2 border-stone-300 px-3 bg-white font-semibold min-h-[44px]">
          <option value="">${t('tasks.allStatuses')}</option>
          ${Object.keys(STATUS_LABEL_KEY).map((s) => `
            <option value="${s}" ${filters.status === s ? 'selected' : ''}>${t(STATUS_LABEL_KEY[s])}</option>`).join('')}
        </select>
      </div>

      <!-- Occurrence list -->
      ${filtered.length === 0
        ? `<div class="text-center py-10">
            <p class="text-stone-500 mb-3">${t('filter.rangeEmpty', { range: rangeLabel })}</p>
            <button type="button" id="show-all-btn"
                    class="min-h-[44px] px-5 rounded-xl border-2 border-farm-green text-farm-green font-bold">
              ${t('filter.showAll')}
            </button>
          </div>`
        : `<ul class="space-y-3">
            ${filtered.map(({ occurrence, task }) => {
              const status = deriveStatus(occurrence);
              const canModify = ['pending', 'dueSoon', 'overdue', 'missed'].includes(status);
              const alert = getTaskAlert(task.id, feed.alerts || []);
              return `
              <li class="bg-white rounded-2xl shadow border-2 ${task.priority === 'urgent' ? 'border-farm-urgent/50' : 'border-farm-green/15'} p-4 ${alert ? 'ring-2 ring-farm-urgent' : ''}">
                <div class="flex flex-wrap items-center gap-2">
                  <div class="flex-1 min-w-[10rem]">
                    <p class="font-bold text-lg leading-tight">
                      ${task.priority === 'urgent' ? '<span class="text-farm-urgent">⚠</span> ' : ''}${alert ? '<span class="text-farm-urgent">🔔</span> ' : ''}${escapeHtml(task.title)}
                    </p>
                    <p class="text-sm text-stone-500">
                      ${formatSmartDateTime(occurrence.due_at)} · ${escapeHtml(taskAssigneeIds(task).map(workerName).join(', '))}
                      ${task.photo_required ? ` · 📷` : ''}
                      ${task.recurrence !== 'none' ? ` · 🔁 ${t('tasks.' + task.recurrence)}` : ''}
                      ${alert ? ` · <span class="text-farm-urgent font-semibold">${t('alerts.alertActive')}</span>` : ''}
                    </p>
                  </div>
                  <span class="text-xs font-bold uppercase px-3 py-1.5 rounded-full ${STATUS_BADGE[status]}">
                    ${t(STATUS_LABEL_KEY[status])}
                  </span>
                </div>
                ${canModify ? `
                <div class="flex flex-wrap gap-2 mt-3">
                  <button data-edit="${task.id}" data-occurrence="${occurrence.id}"
                          class="px-4 py-2 rounded-lg border-2 border-farm-green text-farm-green font-semibold text-sm min-h-[44px]">
                    ${t('common.edit')}
                  </button>
                  <button data-alert="${task.id}"
                          class="px-4 py-2 rounded-lg border-2 ${alert ? 'border-farm-urgent bg-farm-urgent/10 text-farm-urgent' : 'border-farm-amber text-farm-amber'} font-semibold text-sm min-h-[44px]">
                    🔔 ${alert ? t('alerts.alertActive') : t('alerts.raiseAlert')}
                  </button>
                  <button data-delete="${task.id}" data-occurrence="${occurrence.id}"
                          class="px-4 py-2 rounded-lg border-2 border-farm-urgent text-farm-urgent font-semibold text-sm min-h-[44px]">
                    ${t('common.delete')}
                  </button>
                </div>` : ''}
              </li>`;
            }).join('')}
          </ul>`}
    </div>
  `;

  const filterHost = container.querySelector('#date-filter-host');
  teardownFilter = mountDateFilterBar(filterHost, {
    viewKey: 'dashboard',
    preset,
    custom,
    onChange: () => render(container),
  });

  wireEvents(container, { feed, workers, filters, range });
}

function wireEvents(container, { feed, workers, filters }) {
  const reload = () => render(container);

  container.querySelector('#assign-btn')?.addEventListener('click', () => {
    openTaskEditor({ workers, onSaved: reload });
  });

  container.querySelector('#filter-worker')?.addEventListener('change', (e) => {
    dashboardListFilters = { ...dashboardListFilters, workerId: e.target.value || null };
    renderDashboard(container, {
      session: getSession(), feed, workers,
      filters: dashboardListFilters,
      range: defaultViewRange('dashboard'),
      preset: loadViewRange('dashboard')?.preset,
      custom: loadViewRange('dashboard')?.custom ?? {},
    });
  });
  container.querySelector('#filter-status')?.addEventListener('change', (e) => {
    dashboardListFilters = { ...dashboardListFilters, status: e.target.value || null };
    renderDashboard(container, {
      session: getSession(), feed, workers,
      filters: dashboardListFilters,
      range: defaultViewRange('dashboard'),
      preset: loadViewRange('dashboard')?.preset,
      custom: loadViewRange('dashboard')?.custom ?? {},
    });
  });

  container.querySelector('#show-all-btn')?.addEventListener('click', () => {
    import('../dateRange.js').then(({ saveViewRange, PRESETS }) => {
      saveViewRange('dashboard', { preset: PRESETS.ALL, custom: {} });
      render(container);
    });
  });

  container.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const task = feed.tasks.find((x) => x.id === btn.dataset.edit);
      const occurrence = feed.occurrences.find((o) => o.id === btn.dataset.occurrence);
      if (!task || !occurrence) return;

      if (task.recurrence !== 'none') {
        openRecurringChoice({
          mode: 'edit',
          task,
          occurrence,
          onThisDay: () => openTaskEditor({ task, occurrence, editScope: 'day', workers, onSaved: reload }),
          onAllDays: () => openTaskEditor({ task, editScope: 'series', workers, onSaved: reload }),
        });
      } else {
        openTaskEditor({ task, workers, onSaved: reload });
      }
    });
  });

  container.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const task = feed.tasks.find((x) => x.id === btn.dataset.delete);
      const occurrence = feed.occurrences.find((o) => o.id === btn.dataset.occurrence);
      if (!task || !occurrence) return;

      const deleteSeries = async () => {
        try {
          await api('/api/tasks', {
            method: 'POST',
            headers: await ownerGuardHeaders(),
            body: { action: 'delete', id: task.id },
          });
          toast(t('tasks.taskDeleted'));
          reload();
        } catch {
          toast(t('errors.generic'), 'error');
        }
      };

      const deleteThisDay = async () => {
        try {
          await cancelOccurrence(occurrence.id);
          toast(t('tasks.occurrenceCancelled'));
          reload();
        } catch (err) {
          const msg = err.code === 'occurrence_completed'
            ? t('tasks.cannotSkipCompleted')
            : err.code === 'occurrence_not_cancellable'
              ? t('tasks.cannotSkipDay')
              : t('errors.generic');
          toast(msg, 'error');
        }
      };

      if (task.recurrence !== 'none') {
        openRecurringChoice({
          mode: 'delete',
          task,
          occurrence,
          onThisDay: deleteThisDay,
          onAllDays: async () => {
            if (!window.confirm(t('tasks.deleteAllDaysConfirm'))) return;
            await deleteSeries();
          },
        });
      } else {
        if (!window.confirm(t('tasks.deleteTaskConfirm'))) return;
        await deleteSeries();
      }
    });
  });

  container.querySelectorAll('[data-alert]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const task = feed.tasks.find((x) => x.id === btn.dataset.alert);
      if (task) openRaiseAlertModal(task, reload);
    });
  });
}

// ---------------------------------------------------------------------------
// Raise urgent alert modal
// ---------------------------------------------------------------------------
function openRaiseAlertModal(task, onRaised) {
  const host = document.getElementById('modal-host');
  host.innerHTML = `
    <div class="absolute inset-0 bg-black/50" data-close></div>
    <div class="absolute inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                sm:max-w-md sm:w-full bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-6">
      <h3 class="text-xl font-bold text-farm-urgent mb-1">⚠ ${t('alerts.raiseAlert')}</h3>
      <p class="text-sm text-stone-600 mb-4">${escapeHtml(task.title)}</p>

      <label class="block font-semibold mb-1" for="ra-message">${t('alerts.alertMessage')}</label>
      <input id="ra-message" maxlength="300" placeholder="${t('alerts.alertMessagePlaceholder')}"
             class="w-full rounded-lg border-2 border-stone-300 px-3 py-2 mb-4" />

      <div class="flex gap-3">
        <button type="button" data-close
                class="flex-1 rounded-lg border-2 border-stone-300 py-3 font-bold text-stone-600">
          ${t('common.cancel')}
        </button>
        <button id="ra-send"
                class="flex-1 rounded-lg bg-farm-urgent text-white py-3 font-bold hover:bg-red-700 transition-colors">
          ${t('alerts.raiseAlert')}
        </button>
      </div>
    </div>
  `;
  host.classList.remove('hidden');

  const close = () => { host.classList.add('hidden'); host.innerHTML = ''; };
  host.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));

  host.querySelector('#ra-send').addEventListener('click', async () => {
    const message = host.querySelector('#ra-message').value;
    try {
      const session = getSession();
      await api('/api/alerts', {
        method: 'POST',
        headers: { ...(await ownerGuardHeaders()), 'x-account-id': session?.accountId ?? '' },
        body: { action: 'raise', taskId: task.id, message },
      });
      close();
      toast(t('alerts.alertRaised'));
      onRaised?.();
    } catch {
      toast(t('errors.generic'), 'error');
    }
  });
}
