// Modal: for recurring tasks, choose "this day only" vs "entire series".

import { t, formatSmartDateTime } from '../i18n.js';
import { escapeHtml } from '../dom.js';

/**
 * @param {'edit'|'delete'} mode
 * @param {{ task, occurrence, onThisDay: () => void, onAllDays: () => void }} opts
 */
export function openRecurringChoice({ mode, task, occurrence, onThisDay, onAllDays }) {
  const host = document.getElementById('modal-host');
  const isEdit = mode === 'edit';
  const when = formatSmartDateTime(occurrence.due_at);

  host.innerHTML = `
    <div class="absolute inset-0 bg-black/50" data-close></div>
    <div class="absolute inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                sm:max-w-md sm:w-full bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-6">
      <h3 class="text-xl font-bold text-farm-green mb-1">
        ${isEdit ? t('tasks.recurringEditTitle') : t('tasks.recurringDeleteTitle')}
      </h3>
      <p class="text-sm text-stone-600 mb-1">${escapeHtml(task.title)}</p>
      <p class="text-sm text-stone-500 mb-4">${when}</p>
      <p class="text-sm text-stone-600 mb-4">${t('tasks.recurringChoiceHint')}</p>

      <div class="space-y-3">
        <button type="button" id="rc-this-day"
                class="w-full min-h-[44px] rounded-xl border-2 border-farm-green text-farm-green font-bold py-3 hover:bg-green-50">
          ${isEdit ? t('tasks.editThisDay') : t('tasks.deleteThisDay')}
        </button>
        <button type="button" id="rc-all-days"
                class="w-full min-h-[44px] rounded-xl border-2 border-stone-300 text-stone-700 font-bold py-3 hover:bg-stone-50">
          ${isEdit ? t('tasks.editAllDays') : t('tasks.deleteAllDays')}
        </button>
        <button type="button" data-close
                class="w-full min-h-[44px] rounded-xl text-stone-500 font-semibold py-2">
          ${t('common.cancel')}
        </button>
      </div>
    </div>
  `;
  host.classList.remove('hidden');

  const close = () => { host.classList.add('hidden'); host.innerHTML = ''; };
  host.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  host.querySelector('#rc-this-day').addEventListener('click', () => { close(); onThisDay(); });
  host.querySelector('#rc-all-days').addEventListener('click', () => { close(); onAllDays(); });
}
