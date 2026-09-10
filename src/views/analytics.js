// Owner analytics dashboard — hand-rolled SVG charts (Phase 8).

import { t, formatNumber, getLang } from '../i18n.js';
import { api } from '../api.js';
import { fetchTaskFeed } from '../tasks.js';
import { horizontalBarChart, verticalBarChart, donutChart, COLORS } from '../charts.js';
import { mountDateFilterBar } from './components/dateFilterBar.js';
import {
  defaultViewRange, inRange, describeRange, loadViewRange, rangeToQuery,
} from '../dateRange.js';
import { farmDayParts, farmDayStartIso, farmAddDays } from '../config.js';
import { getCalendar } from '../dateRange.js';
import { isoToBs, formatBs } from '../nepaliDate.js';

const DAY_MS = 86_400_000;

let teardownFilter = null;

export async function render(container) {
  if (teardownFilter) { teardownFilter(); teardownFilter = null; }
  container.innerHTML = `<p class="text-center text-stone-500 mt-8">${t('common.loading')}</p>`;

  const saved = loadViewRange('analytics');
  const range = defaultViewRange('analytics');
  const qs = rangeToQuery(range);

  let feed, logs;
  try {
    [feed, { logs }] = await Promise.all([
      fetchTaskFeed(range),
      api(`/api/logs${qs ? `?${qs}` : ''}`),
    ]);
  } catch {
    container.innerHTML = `
      <div class="max-w-md mx-auto mt-8 bg-red-50 border-2 border-farm-urgent text-farm-urgent rounded-lg p-4 font-semibold">
        ${t('errors.network')}
      </div>`;
    return;
  }

  renderAnalytics(container, feed, logs, range, saved?.preset ?? range.preset, saved?.custom ?? {});
}

function renderAnalytics(container, feed, logs, range, preset, custom) {
  const rangeLabel = describeRange(range);
  const inRangeOcc = feed.occurrences.filter((o) => inRange(o.due_at, range));
  const recentLogs = logs.filter((l) => inRange(l.completed_at, range));

  const pending = inRangeOcc.filter((o) => o.status === 'pending').length;
  const completed = inRangeOcc.filter((o) => o.status === 'completed').length;

  const onTime = recentLogs.filter((l) => {
    const occ = feed.occurrences.find((o) => o.id === l.occurrence_id);
    return occ && new Date(l.completed_at) <= new Date(occ.due_at);
  }).length;
  const late = recentLogs.length - onTime;

  const photoRequiredLogs = recentLogs.filter((l) => {
    const task = feed.tasks.find((tk) => tk.id === l.task_id);
    return task?.photo_required;
  });
  const photoOk = photoRequiredLogs.filter((l) =>
    l.photo_status === 'stored' || l.photo_blob_key
  ).length;
  const photoRate = photoRequiredLogs.length
    ? Math.round((photoOk / photoRequiredLogs.length) * 100)
    : 100;

  const workerTotals = new Map();
  for (const l of recentLogs) {
    workerTotals.set(l.completed_by_name, (workerTotals.get(l.completed_by_name) || 0) + 1);
  }
  const workerBars = [...workerTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ label: name, value }));

  const dailyBuckets = buildDailyBuckets(range, logs);
  const completionRate = (completed + pending) > 0
    ? Math.round((completed / (completed + pending)) * 100)
    : 0;

  container.innerHTML = `
    <div class="max-w-3xl mx-auto mt-2">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 class="text-2xl font-bold text-farm-green">${t('analytics.title')}</h2>
        <a href="#/dashboard" class="text-farm-green font-semibold underline text-sm min-h-touch flex items-center">
          ← ${t('common.back')}
        </a>
      </div>

      <div id="date-filter-host"></div>

      <p class="text-sm text-stone-500 mb-4 text-center">
        ${t('analytics.periodLabel', { range: rangeLabel })} · ${t('analytics.completionRate')}: ${formatNumber(completionRate)}%
      </p>

      <div class="grid grid-cols-2 gap-3 mb-4">
        <div class="bg-white rounded-2xl shadow border-2 border-farm-green/15 p-4 text-center">
          <p class="text-3xl font-extrabold text-farm-green">${formatNumber(completed)}</p>
          <p class="text-sm font-semibold text-stone-600">${t('tasks.statusCompleted')}</p>
        </div>
        <div class="bg-white rounded-2xl shadow border-2 border-farm-green/15 p-4 text-center">
          <p class="text-3xl font-extrabold text-blue-800">${formatNumber(pending)}</p>
          <p class="text-sm font-semibold text-stone-600">${t('tasks.statusPending')}</p>
        </div>
      </div>

      <section class="bg-white rounded-2xl shadow border-2 border-farm-green/15 p-4 mb-4">
        <h3 class="font-bold text-lg mb-2">${t('analytics.completionRate')}</h3>
        ${dailyBuckets.some((b) => b.value > 0)
          ? verticalBarChart(dailyBuckets, { color: COLORS.green })
          : `<p class="text-stone-500 text-sm">${t('analytics.noData')}</p>`}
      </section>

      <section class="bg-white rounded-2xl shadow border-2 border-farm-green/15 p-4 mb-4">
        <h3 class="font-bold text-lg mb-2">${t('analytics.onTime')} / ${t('analytics.late')}</h3>
        ${recentLogs.length > 0
          ? donutChart([
              { label: t('analytics.onTime'), value: onTime, color: COLORS.green },
              { label: t('analytics.late'), value: late, color: COLORS.amber },
            ])
          : `<p class="text-stone-500 text-sm">${t('analytics.noData')}</p>`}
      </section>

      <section class="bg-white rounded-2xl shadow border-2 border-farm-green/15 p-4 mb-4">
        <h3 class="font-bold text-lg mb-2">${t('analytics.perWorker')}</h3>
        ${workerBars.length > 0
          ? horizontalBarChart(workerBars)
          : `<p class="text-stone-500 text-sm">${t('analytics.noData')}</p>`}
      </section>

      <section class="bg-white rounded-2xl shadow border-2 border-farm-green/15 p-4 mb-4">
        <h3 class="font-bold text-lg mb-2">${t('analytics.photoCompliance')}</h3>
        <p class="text-3xl font-extrabold text-farm-green mb-1">${formatNumber(photoRate)}%</p>
        <p class="text-sm text-stone-500">
          ${formatNumber(photoOk)} / ${formatNumber(photoRequiredLogs.length)} ${t('tasks.photoRequired').toLowerCase()}
        </p>
      </section>
    </div>
  `;

  const filterHost = container.querySelector('#date-filter-host');
  teardownFilter = mountDateFilterBar(filterHost, {
    viewKey: 'analytics',
    preset,
    custom,
    onChange: () => render(container),
  });
}

function buildDailyBuckets(range, logs) {
  if (!range.fromIso || !range.toIso) return [];

  const buckets = [];
  let cursor = farmDayParts(range.fromIso);
  const endMs = new Date(range.toIso).getTime();
  const lang = getLang();
  const calendar = getCalendar();

  while (new Date(farmDayStartIso(cursor)).getTime() < endMs) {
    const dayStart = farmDayStartIso(cursor);
    const next = farmAddDays(cursor, 1);
    const dayEnd = farmDayStartIso(next);

    let label;
    if (calendar === 'bs') {
      const bs = isoToBs(dayStart);
      label = formatBs(bs, lang).split(' ').slice(1).join(' '); // month + day
    } else {
      const d = new Date(dayStart);
      label = d.toLocaleDateString(lang === 'ne' ? 'ne-NP' : 'en-GB', { weekday: 'short' });
    }

    const done = logs.filter((l) => {
      const at = new Date(l.completed_at).getTime();
      return at >= new Date(dayStart).getTime() && at < new Date(dayEnd).getTime();
    }).length;

    buckets.push({ label, value: done });
    cursor = next;
    if (buckets.length > 366) break;
  }

  return buckets;
}
