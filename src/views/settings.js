// Owner settings: sync panel, photo purge, backup/restore, demo data, factory reset.

import { t, formatNumber, formatRelative } from '../i18n.js';
import { toast } from '../dom.js';
import { api } from '../api.js';
import { ownerGuardHeaders } from '../auth.js';
import { syncNow, pendingCount, onSyncStatus } from '../sync.js';
import { downloadBackup, importBackup, readBackupFile } from '../backup.js';
import { loadDemoData, factoryReset } from '../seed.js';

export async function render(container) {
  const pending = await pendingCount().catch(() => 0);

  container.innerHTML = `
    <div class="max-w-2xl mx-auto mt-2">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 class="text-2xl font-bold text-farm-green">${t('settings.title')}</h2>
        <a href="#/dashboard" class="text-farm-green font-semibold underline text-sm min-h-touch flex items-center">
          ← ${t('common.back')}
        </a>
      </div>

      <!-- Guided sync panel -->
      <section class="bg-white rounded-2xl shadow border-2 border-farm-green/20 p-5 mb-4">
        <h3 class="font-bold text-lg mb-2">🔄 ${t('settings.syncTitle')}</h3>
        <dl class="text-sm space-y-1 mb-3">
          <div class="flex justify-between">
            <dt class="text-stone-500">${t('sync.lastSync')}</dt>
            <dd id="sync-last" class="font-semibold">—</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-stone-500">${t('sync.pending')}</dt>
            <dd id="sync-pending" class="font-semibold">${t('sync.pendingChanges', { n: formatNumber(pending) })}</dd>
          </div>
        </dl>
        <button id="sync-now-btn"
                class="w-full rounded-xl bg-farm-green text-white font-bold py-3 hover:bg-farm-greenLight transition-colors">
          ${t('sync.syncNow')}
        </button>
      </section>

      <!-- Backup & restore -->
      <section class="bg-white rounded-2xl shadow border-2 border-farm-green/20 p-5 mb-4">
        <h3 class="font-bold text-lg mb-1">💾 ${t('settings.backupRestore')}</h3>
        <p class="text-sm text-stone-600 mb-3">${t('settings.exportHint')}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <button id="export-btn"
                  class="rounded-xl bg-farm-green text-white font-bold py-3 hover:bg-farm-greenLight transition-colors">
            ${t('settings.exportData')}
          </button>
          <button id="import-btn"
                  class="rounded-xl border-2 border-farm-green text-farm-green font-bold py-3 hover:bg-green-50 transition-colors">
            ${t('settings.importData')}
          </button>
        </div>
        <p class="text-xs text-stone-500">${t('settings.importHint')}</p>
        <input id="import-file" type="file" accept="application/json,.json" class="hidden" />
      </section>

      <!-- Demo data + factory reset -->
      <section class="bg-white rounded-2xl shadow border-2 border-farm-green/20 p-5 mb-4">
        <h3 class="font-bold text-lg mb-1">🌱 ${t('settings.demoData')}</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button id="demo-btn"
                  class="rounded-xl border-2 border-farm-green text-farm-green font-bold py-3 hover:bg-green-50 transition-colors">
            ${t('settings.loadDemo')}
          </button>
          <button id="reset-btn"
                  class="rounded-xl border-2 border-farm-urgent text-farm-urgent font-bold py-3 hover:bg-red-50 transition-colors">
            ${t('settings.factoryReset')}
          </button>
        </div>
      </section>

      <!-- Photo lifecycle -->
      <section class="bg-white rounded-2xl shadow border-2 border-farm-green/20 p-5 mb-4">
        <h3 class="font-bold text-lg mb-1">🗑 ${t('settings.runPurge')}</h3>
        <p class="text-sm text-stone-600 mb-3">${t('settings.purgeHint')}</p>
        <button id="purge-btn"
                class="w-full rounded-xl border-2 border-farm-amber text-farm-amber font-bold py-3 hover:bg-amber-50 transition-colors">
          ${t('settings.runPurge')}
        </button>
      </section>
    </div>
  `;

  const lastEl = container.querySelector('#sync-last');
  const updateLast = () => {
    import('../sync.js').then((m) => {
      const { lastSyncAt } = m.getSyncState();
      lastEl.textContent = lastSyncAt ? formatRelative(lastSyncAt) : t('sync.never');
    });
  };
  updateLast();
  onSyncStatus(updateLast);

  container.querySelector('#sync-now-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    await syncNow().catch(() => {});
    const remaining = await pendingCount().catch(() => 0);
    container.querySelector('#sync-pending').textContent =
      t('sync.pendingChanges', { n: formatNumber(remaining) });
    updateLast();
    toast(remaining === 0 ? t('sync.synced') : t('sync.pendingChanges', { n: formatNumber(remaining) }),
      remaining === 0 ? 'ok' : 'error');
    btn.disabled = false;
  });

  container.querySelector('#export-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await downloadBackup();
    } catch {
      toast(t('errors.generic'), 'error');
    } finally {
      btn.disabled = false;
    }
  });

  const fileInput = container.querySelector('#import-file');
  container.querySelector('#import-btn').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;

    if (!window.confirm(`${t('settings.importConfirmTitle')}\n\n${t('settings.importConfirmBody')}`)) {
      return;
    }

    try {
      const backup = await readBackupFile(file);
      await importBackup(backup);
      toast(t('settings.importSuccess'));
      window.location.hash = '#/dashboard';
    } catch (err) {
      const msg = err?.code === 'version_mismatch'
        ? t('errors.versionMismatch')
        : err?.code === 'invalid_file' ? t('errors.invalidFile') : t('settings.importError');
      toast(msg, 'error');
    }
  });

  container.querySelector('#demo-btn').addEventListener('click', async (e) => {
    if (!window.confirm(t('settings.loadDemoConfirm'))) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await loadDemoData();
      toast(t('settings.demoLoaded'));
      window.location.hash = '#/dashboard';
    } catch {
      toast(t('errors.generic'), 'error');
    } finally {
      btn.disabled = false;
    }
  });

  container.querySelector('#reset-btn').addEventListener('click', async (e) => {
    if (!window.confirm(t('settings.factoryResetConfirm'))) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await factoryReset();
      toast(t('settings.resetDone'));
      window.location.hash = '#/login';
    } catch {
      toast(t('errors.generic'), 'error');
    } finally {
      btn.disabled = false;
    }
  });

  container.querySelector('#purge-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const result = await api('/api/cron/purge-photos', {
        method: 'POST',
        headers: await ownerGuardHeaders(),
      });
      toast(`${t('settings.purgeDone')} — ${t('settings.purgeCount', { n: formatNumber(result.purged) })}`);
    } catch {
      toast(t('errors.generic'), 'error');
    } finally {
      btn.disabled = false;
    }
  });
}
