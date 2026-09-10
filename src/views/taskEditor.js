// Task assignment drawer (owner): create or edit a task template.
// Renders into the shared #modal-host. Supports one-time, daily and weekly
// recurrence, priority, photo-proof toggle, and worker assignment.

import { t, weekdayNames } from '../i18n.js';
import { escapeHtml, toast } from '../dom.js';
import { api } from '../api.js';
import { getSession, ownerGuardHeaders } from '../auth.js';
import { taskAssigneeIds } from '../tasks.js';

/**
 * @param {object}   opts.task        existing task to edit (omit for create)
 * @param {object}   opts.occurrence  when set with editScope 'day', edits one day only
 * @param {'series'|'day'} opts.editScope  default 'series'
 * @param {Array}    opts.workers     active worker accounts
 * @param {Function} opts.onSaved     called after a successful save
 */
export function openTaskEditor({ task = null, occurrence = null, editScope = 'series', workers = [], onSaved }) {
  const host = document.getElementById('modal-host');
  const isEdit = !!task;
  const singleDay = isEdit && editScope === 'day' && occurrence;

  // Pre-fill values
  const v = {
    title: task?.title ?? '',
    description: task?.description ?? '',
    recurrence: task?.recurrence ?? 'none',
    priority: task?.priority ?? 'normal',
    photoRequired: task?.photo_required ?? false,
    assignees: task
      ? taskAssigneeIds(task)
      : (workers[0] ? [workers[0].id] : []),
    scheduledLocal: singleDay
      ? toLocalInputValue(occurrence.due_at)
      : (task?.scheduled_at ? toLocalInputValue(task.scheduled_at) : ''),
    recurrenceTime: task?.recurrence_time ?? '08:00',
    recurrenceWeekdays: task?.recurrence_weekdays ?? [],
    recurrenceEndsLocal: task?.recurrence_ends_at ? toLocalDateValue(task.recurrence_ends_at) : '',
  };

  const weekdays = weekdayNames('short');

  host.innerHTML = `
    <div class="absolute inset-0 bg-black/50" data-close></div>
    <div class="absolute inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                sm:max-w-lg sm:w-full bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl
                max-h-[92vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-xl font-bold text-farm-green">
          ${singleDay ? t('tasks.editThisDay') : (isEdit ? t('tasks.editTask') : t('owner.assignTask'))}
        </h3>
        ${singleDay ? `<p class="text-sm text-stone-500 mb-3">${t('tasks.editThisDayHint')}</p>` : ''}
        <button type="button" data-close class="text-2xl font-bold text-stone-500 px-3" aria-label="${t('common.close')}">✕</button>
      </div>

      <form id="task-form" class="space-y-4">
        <div>
          <label class="block font-semibold mb-1" for="tf-title">${t('tasks.title')}</label>
          <input id="tf-title" required maxlength="120" value="${escapeHtml(v.title)}"
                 placeholder="${t('tasks.titlePlaceholder')}"
                 class="w-full rounded-lg border-2 border-stone-300 px-3 py-2" />
        </div>

        <div>
          <label class="block font-semibold mb-1" for="tf-desc">${t('tasks.description')}</label>
          <textarea id="tf-desc" rows="2" maxlength="2000" placeholder="${t('tasks.descPlaceholder')}"
                    class="w-full rounded-lg border-2 border-stone-300 px-3 py-2">${escapeHtml(v.description)}</textarea>
        </div>

        <div>
          <span class="block font-semibold mb-1">${t('tasks.assignTo')}</span>
          <p class="text-sm text-stone-500 mb-2">${t('tasks.assignToHint')}</p>
          <div class="space-y-2" id="tf-assignees">
            ${workers.map((w) => `
              <label class="flex items-center gap-3 rounded-lg border-2 px-3 py-2 cursor-pointer font-semibold
                            ${v.assignees.includes(w.id) ? 'border-farm-green bg-green-50 text-farm-green' : 'border-stone-300'}">
                <input type="checkbox" name="assignee" value="${w.id}"
                       ${v.assignees.includes(w.id) ? 'checked' : ''} class="w-5 h-5 shrink-0" />
                <span>${escapeHtml(w.display_name)} <span class="text-stone-500 font-normal">(@${escapeHtml(w.username)})</span></span>
              </label>`).join('')}
          </div>
        </div>

        ${singleDay ? '' : `
        <div>
          <span class="block font-semibold mb-1">${t('tasks.recurrence')}</span>
          <div class="grid grid-cols-3 gap-2" role="radiogroup">
            ${['none', 'daily', 'weekly'].map((r) => `
              <label class="flex items-center justify-center gap-1 rounded-lg border-2 px-2 py-2 cursor-pointer font-semibold text-sm
                            ${v.recurrence === r ? 'border-farm-green bg-green-50 text-farm-green' : 'border-stone-300'}">
                <input type="radio" name="recurrence" value="${r}" ${v.recurrence === r ? 'checked' : ''} class="sr-only" />
                ${t('tasks.' + (r === 'none' ? 'once' : r))}
              </label>`).join('')}
          </div>
        </div>`}

        <div id="tf-once-block" class="${singleDay || v.recurrence === 'none' ? '' : 'hidden'}">
          <label class="block font-semibold mb-1" for="tf-scheduled">${t('tasks.scheduledAt')}</label>
          <input id="tf-scheduled" type="datetime-local" value="${v.scheduledLocal}"
                 class="w-full rounded-lg border-2 border-stone-300 px-3 py-2" />
        </div>

        <div id="tf-repeat-block" class="${singleDay || v.recurrence === 'none' ? 'hidden' : ''} space-y-4">
          <div>
            <label class="block font-semibold mb-1" for="tf-time">${t('tasks.time')}</label>
            <input id="tf-time" type="time" value="${v.recurrenceTime}"
                   class="w-full rounded-lg border-2 border-stone-300 px-3 py-2" />
          </div>
          <div id="tf-weekdays" class="${v.recurrence === 'weekly' ? '' : 'hidden'}">
            <span class="block font-semibold mb-1">${t('tasks.repeatOn')}</span>
            <div class="grid grid-cols-7 gap-1">
              ${weekdays.map((name, i) => `
                <label class="flex flex-col items-center gap-1 rounded-lg border-2 px-1 py-2 cursor-pointer text-xs font-bold
                              ${v.recurrenceWeekdays.includes(i) ? 'border-farm-green bg-green-50 text-farm-green' : 'border-stone-300'}">
                  <input type="checkbox" name="weekday" value="${i}" ${v.recurrenceWeekdays.includes(i) ? 'checked' : ''} class="sr-only" />
                  ${name}
                </label>`).join('')}
            </div>
          </div>
          <div>
            <label class="block font-semibold mb-1" for="tf-ends">${t('tasks.endsOn')} (${t('common.optional')})</label>
            <input id="tf-ends" type="date" value="${v.recurrenceEndsLocal}"
                   class="w-full rounded-lg border-2 border-stone-300 px-3 py-2" />
          </div>
        </div>

        <div>
          <span class="block font-semibold mb-1">${t('tasks.priority')}</span>
          <div class="grid grid-cols-2 gap-2" role="radiogroup">
            <label class="flex items-center justify-center rounded-lg border-2 px-2 py-2 cursor-pointer font-semibold
                          ${v.priority === 'normal' ? 'border-farm-green bg-green-50 text-farm-green' : 'border-stone-300'}">
              <input type="radio" name="priority" value="normal" ${v.priority === 'normal' ? 'checked' : ''} class="sr-only" />
              ${t('tasks.priorityNormal')}
            </label>
            <label class="flex items-center justify-center rounded-lg border-2 px-2 py-2 cursor-pointer font-semibold
                          ${v.priority === 'urgent' ? 'border-farm-urgent bg-red-50 text-farm-urgent' : 'border-stone-300'}">
              <input type="radio" name="priority" value="urgent" ${v.priority === 'urgent' ? 'checked' : ''} class="sr-only" />
              ⚠ ${t('tasks.priorityUrgent')}
            </label>
          </div>
        </div>

        <label class="flex items-start gap-3 rounded-lg border-2 border-stone-300 px-4 py-3 cursor-pointer">
          <input id="tf-photo" type="checkbox" ${v.photoRequired ? 'checked' : ''} class="mt-1 w-5 h-5" />
          <span>
            <span class="block font-semibold">${t('tasks.photoRequired')}</span>
            <span class="block text-sm text-stone-500">${t('tasks.photoRequiredHint')}</span>
          </span>
        </label>

        <p id="tf-error" role="alert" class="hidden text-farm-urgent font-semibold"></p>

        <div class="flex gap-3 pt-2">
          <button type="button" data-close
                  class="flex-1 rounded-lg border-2 border-stone-300 py-3 font-bold text-stone-600">
            ${t('common.cancel')}
          </button>
          <button type="submit"
                  class="flex-1 rounded-lg bg-farm-green text-white py-3 font-bold hover:bg-farm-greenLight transition-colors">
            ${isEdit ? t('common.save') : t('tasks.createTask')}
          </button>
        </div>
      </form>
    </div>
  `;
  host.classList.remove('hidden');

  // --- interactions ---------------------------------------------------------
  const close = () => { host.classList.add('hidden'); host.innerHTML = ''; };
  host.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));

  // Recurrence radio: toggle conditional blocks + selected styling.
  const RECURRENCE_BASE = 'flex items-center justify-center gap-1 rounded-lg border-2 px-2 py-2 cursor-pointer font-semibold text-sm';
  const PRIORITY_BASE = 'flex items-center justify-center rounded-lg border-2 px-2 py-2 cursor-pointer font-semibold';

  if (!singleDay) host.querySelectorAll('input[name="recurrence"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const val = host.querySelector('input[name="recurrence"]:checked').value;
      host.querySelector('#tf-once-block').classList.toggle('hidden', val !== 'none');
      host.querySelector('#tf-repeat-block').classList.toggle('hidden', val === 'none');
      host.querySelector('#tf-weekdays').classList.toggle('hidden', val !== 'weekly');
      restyleChoices(host, 'input[name="recurrence"]', RECURRENCE_BASE);
    });
  });
  host.querySelectorAll('input[name="priority"]').forEach((radio) => {
    radio.addEventListener('change', () => restyleChoices(host, 'input[name="priority"]', PRIORITY_BASE));
  });
  host.querySelectorAll('input[name="weekday"]').forEach((box) => {
    box.addEventListener('change', () => restyleWeekdays(host));
  });
  host.querySelectorAll('input[name="assignee"]').forEach((box) => {
    box.addEventListener('change', () => restyleAssignees(host));
  });

  host.querySelector('#task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = host.querySelector('#tf-error');
    errorEl.classList.add('hidden');

    const recurrence = singleDay
      ? 'none'
      : host.querySelector('input[name="recurrence"]:checked').value;
    const scheduledLocalVal = host.querySelector('#tf-scheduled').value;
    const endsLocal = host.querySelector('#tf-ends')?.value;

    const assignedAccountIds = [...host.querySelectorAll('input[name="assignee"]:checked')]
      .map((c) => c.value);
    if (!assignedAccountIds.length) {
      errorEl.textContent = t('tasks.assignToRequired');
      errorEl.classList.remove('hidden');
      return;
    }

    const body = {
      action: singleDay ? 'fork_occurrence' : (isEdit ? 'update' : 'create'),
      ...(singleDay ? { occurrenceId: occurrence.id } : {}),
      ...(isEdit && !singleDay ? { id: task.id } : {}),
      title: host.querySelector('#tf-title').value,
      description: host.querySelector('#tf-desc').value,
      assignedAccountIds,
      recurrence,
      priority: host.querySelector('input[name="priority"]:checked').value,
      photoRequired: host.querySelector('#tf-photo').checked,
      scheduledAt: (singleDay || recurrence === 'none') && scheduledLocalVal
        ? new Date(scheduledLocalVal).toISOString() : null,
      recurrenceTime: recurrence !== 'none' ? host.querySelector('#tf-time').value : null,
      recurrenceWeekdays: recurrence === 'weekly'
        ? [...host.querySelectorAll('input[name="weekday"]:checked')].map((c) => Number(c.value))
        : null,
      recurrenceEndsAt: recurrence !== 'none' && endsLocal
        ? new Date(endsLocal + 'T23:59:59').toISOString() : null,
    };

    try {
      const session = getSession();
      await api('/api/tasks', {
        method: 'POST',
        headers: { ...(await ownerGuardHeaders()), 'x-account-id': session?.accountId ?? '' },
        body,
      });
      close();
      toast(singleDay ? t('tasks.occurrenceUpdated') : (isEdit ? t('tasks.taskUpdated') : t('tasks.taskCreated')));
      onSaved?.();
    } catch (err) {
      errorEl.textContent = err.code === 'network' ? t('errors.network') : t('errors.generic');
      errorEl.classList.remove('hidden');
    }
  });
}

// Selected-choice styling helpers (radio/checkbox labels highlight).
function restyleChoices(host, selector, baseClass) {
  host.querySelectorAll(selector).forEach((input) => {
    const label = input.closest('label');
    const isUrgent = input.value === 'urgent';
    label.className = input.checked
      ? `${baseClass} ${isUrgent
          ? 'border-farm-urgent bg-red-50 text-farm-urgent'
          : 'border-farm-green bg-green-50 text-farm-green'}`
      : `${baseClass} border-stone-300`;
  });
}

function restyleWeekdays(host) {
  host.querySelectorAll('input[name="weekday"]').forEach((box) => {
    const label = box.closest('label');
    label.className = `flex flex-col items-center gap-1 rounded-lg border-2 px-1 py-2 cursor-pointer text-xs font-bold ${
      box.checked ? 'border-farm-green bg-green-50 text-farm-green' : 'border-stone-300'
    }`;
  });
}

function restyleAssignees(host) {
  host.querySelectorAll('input[name="assignee"]').forEach((box) => {
    const label = box.closest('label');
    label.className = `flex items-center gap-3 rounded-lg border-2 px-3 py-2 cursor-pointer font-semibold ${
      box.checked ? 'border-farm-green bg-green-50 text-farm-green' : 'border-stone-300'
    }`;
  });
}

// datetime-local wants "YYYY-MM-DDTHH:MM" in *local* time.
function toLocalInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalDateValue(iso) {
  return toLocalInputValue(iso).slice(0, 10);
}
