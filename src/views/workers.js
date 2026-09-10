// Worker account manager (owner only): list, create, rename,
// activate/deactivate, reset password.

import { t } from '../i18n.js';
import { escapeHtml } from '../dom.js';
import {
  fetchAccounts, createWorker, updateWorker, resetWorkerPassword,
} from '../auth.js';

export async function render(container, opts = {}) {
  container.innerHTML = `<p class="text-center text-stone-500 mt-8">${t('common.loading')}</p>`;
  let accounts;
  try {
    accounts = await fetchAccounts(true);
  } catch {
    container.innerHTML = `
      <div class="max-w-md mx-auto mt-8 bg-red-50 border-2 border-farm-urgent text-farm-urgent rounded-lg p-4 font-semibold">
        ${t('errors.network')}
      </div>`;
    return;
  }
  renderManager(container, accounts.filter((a) => a.role === 'worker'), opts);
}

function renderManager(container, workers, { notice = '', error = '', openForm = null, openId = null }) {
  container.innerHTML = `
    <div class="max-w-2xl mx-auto mt-4">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-2xl font-bold text-farm-green">${t('workers.manageWorkers')}</h2>
        <a href="#/dashboard" class="text-farm-green font-semibold underline text-sm">← ${t('common.back')}</a>
      </div>

      ${notice ? `<div role="status" class="mb-4 bg-green-50 border-2 border-farm-greenLight text-farm-green rounded-lg px-4 py-3 font-semibold">${notice}</div>` : ''}
      ${error ? `<div role="alert" class="mb-4 bg-red-50 border-2 border-farm-urgent text-farm-urgent rounded-lg px-4 py-3 font-semibold">${error}</div>` : ''}

      <!-- Add worker -->
      <details class="bg-white rounded-2xl shadow border-2 border-farm-green/20 p-5 mb-6" ${openForm === 'add' ? 'open' : ''}>
        <summary class="font-bold text-lg text-farm-green cursor-pointer min-h-touch flex items-center">
          ＋ ${t('workers.addWorker')}
        </summary>
        <form id="add-worker-form" class="mt-4 space-y-3">
          <div>
            <label class="block font-semibold mb-1" for="aw-username">${t('auth.username')}</label>
            <input id="aw-username" required pattern="[A-Za-z0-9_.\\-]{3,32}" autocomplete="off"
                   class="w-full rounded-lg border-2 border-stone-300 px-3 py-2" />
          </div>
          <div>
            <label class="block font-semibold mb-1" for="aw-name">${t('workers.workerName')}</label>
            <input id="aw-name" required maxlength="64"
                   class="w-full rounded-lg border-2 border-stone-300 px-3 py-2" />
          </div>
          <div>
            <label class="block font-semibold mb-1" for="aw-password">${t('auth.password')}</label>
            <input id="aw-password" type="password" required minlength="6" autocomplete="new-password"
                   class="w-full rounded-lg border-2 border-stone-300 px-3 py-2" />
          </div>
          <button class="w-full bg-farm-green text-white font-bold rounded-lg py-3 hover:bg-farm-greenLight transition-colors">
            ${t('workers.addWorker')}
          </button>
        </form>
      </details>

      <!-- Worker list -->
      ${workers.length === 0
        ? `<p class="text-center text-stone-500 py-8">${t('workers.noWorkers')}</p>`
        : `<ul class="space-y-3">
            ${workers.map((w) => `
              <li class="bg-white rounded-2xl shadow border-2 ${w.active ? 'border-farm-green/20' : 'border-stone-200 opacity-70'} p-4">
                <div class="flex flex-wrap items-center gap-2">
                  <div class="flex-1 min-w-[8rem]">
                    <p class="font-bold text-lg">${escapeHtml(w.display_name)}</p>
                    <p class="text-sm text-stone-500">@${escapeHtml(w.username)}</p>
                  </div>
                  <span class="text-xs font-bold uppercase px-3 py-1 rounded-full ${w.active ? 'bg-green-100 text-farm-green' : 'bg-stone-200 text-stone-600'}">
                    ${w.active ? t('workers.active') : t('workers.inactive')}
                  </span>
                </div>
                <div class="flex flex-wrap gap-2 mt-3">
                  <button data-action="rename" data-id="${w.id}"
                          class="px-4 py-2 rounded-lg border-2 border-farm-green text-farm-green font-semibold text-sm">
                    ${t('common.edit')}
                  </button>
                  <button data-action="reset" data-id="${w.id}"
                          class="px-4 py-2 rounded-lg border-2 border-farm-amber text-farm-amber font-semibold text-sm">
                    ${t('workers.resetPassword')}
                  </button>
                  <button data-action="toggle" data-id="${w.id}" data-active="${w.active}"
                          class="px-4 py-2 rounded-lg border-2 ${w.active ? 'border-farm-urgent text-farm-urgent' : 'border-farm-green text-farm-green'} font-semibold text-sm">
                    ${w.active ? t('workers.deactivate') : t('workers.activate')}
                  </button>
                </div>
                ${openForm === 'rename' && openId === w.id ? `
                  <form class="rename-form mt-3 flex gap-2" data-id="${w.id}">
                    <input name="displayName" required maxlength="64" value="${escapeHtml(w.display_name)}"
                           class="flex-1 rounded-lg border-2 border-stone-300 px-3 py-2" />
                    <button class="px-4 rounded-lg bg-farm-green text-white font-bold">${t('common.save')}</button>
                  </form>` : ''}
                ${openForm === 'reset' && openId === w.id ? `
                  <form class="reset-form mt-3 flex gap-2" data-id="${w.id}">
                    <input name="password" type="password" required minlength="6" autocomplete="new-password"
                           placeholder="${t('auth.newPassword')}"
                           class="flex-1 rounded-lg border-2 border-stone-300 px-3 py-2" />
                    <button class="px-4 rounded-lg bg-farm-amber text-white font-bold">${t('common.confirm')}</button>
                  </form>` : ''}
              </li>
            `).join('')}
          </ul>`}
    </div>
  `;

  wireEvents(container, workers);
}

function wireEvents(container, workers) {
  const rerender = (opts = {}) => render(container, opts); // re-fetch + re-render

  container.querySelector('#add-worker-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = container.querySelector('#aw-username').value.trim();
    const displayName = container.querySelector('#aw-name').value.trim();
    const password = container.querySelector('#aw-password').value;
    try {
      await createWorker(username, displayName, password);
      rerender({ notice: t('workers.workerCreated') });
    } catch (err) {
      showError(container, workers, err.code === 'username_taken' ? t('workers.usernameTaken') : t('errors.generic'), 'add');
    }
  });

  container.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { action, id, active } = btn.dataset;
      if (action === 'rename') {
        renderManager(container, workers, { openForm: 'rename', openId: id });
      } else if (action === 'reset') {
        renderManager(container, workers, { openForm: 'reset', openId: id });
      } else if (action === 'toggle') {
        if (active === 'true' && !window.confirm(t('workers.confirmDeactivate'))) return;
        try {
          await updateWorker(id, { active: active !== 'true' });
          rerender({ notice: active !== 'true' ? t('workers.active') : t('workers.inactive') });
        } catch {
          showError(container, workers, t('errors.generic'));
        }
      }
    });
  });

  container.querySelectorAll('.rename-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await updateWorker(form.dataset.id, { displayName: form.displayName.value.trim() });
        rerender({ notice: t('common.save') });
      } catch {
        showError(container, workers, t('errors.generic'));
      }
    });
  });

  container.querySelectorAll('.reset-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!window.confirm(t('workers.confirmReset'))) return;
      try {
        await resetWorkerPassword(form.dataset.id, form.password.value);
        rerender({ notice: t('workers.passwordReset') });
      } catch {
        showError(container, workers, t('errors.generic'));
      }
    });
  });
}

function showError(container, workers, message, openForm = null) {
  renderManager(container, workers, { error: message, openForm });
}
