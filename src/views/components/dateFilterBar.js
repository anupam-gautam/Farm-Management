// Shared date-range filter: preset chips, AD/बि.सं. toggle, custom range.

import { t, getLang } from '../../i18n.js';
import {
  PRESETS, getCalendar, setCalendar, resolveRange, saveViewRange, onCalendarChange,
} from '../../dateRange.js';
import {
  bsMonthLength, bsMonthNames, todayBs, adInputBounds,
  adDateToIso, isoToAdInput, isoToBs, bsToIso, BS_MIN_YEAR, BS_MAX_YEAR,
} from '../../nepaliDate.js';

const PRESET_ORDER = [
  PRESETS.TODAY,
  PRESETS.YESTERDAY,
  PRESETS.LAST_7,
  PRESETS.THIS_MONTH,
  PRESETS.CUSTOM,
  PRESETS.ALL,
];

const PRESET_LABEL = {
  [PRESETS.TODAY]: 'filter.presetToday',
  [PRESETS.YESTERDAY]: 'filter.presetYesterday',
  [PRESETS.LAST_7]: 'filter.presetLast7',
  [PRESETS.THIS_MONTH]: 'filter.presetThisMonth',
  [PRESETS.CUSTOM]: 'filter.presetCustom',
  [PRESETS.ALL]: 'filter.presetAll',
};

/**
 * Mount the filter bar into `container`.
 * @param {HTMLElement} container
 * @param {{ viewKey: string, preset: string, custom?: object, onChange: (range) => void }} opts
 */
export function mountDateFilterBar(container, { viewKey, preset, custom = {}, onChange }) {
  let currentPreset = preset;
  let currentCustom = { ...custom };
  let showCustom = preset === PRESETS.CUSTOM;
  const calendar = getCalendar();

  function emit() {
    const range = resolveRange(currentPreset, {
      ...currentCustom,
      inclusiveEnd: true,
    });
    saveViewRange(viewKey, { preset: currentPreset, custom: currentCustom });
    onChange(range);
  }

  function render() {
    const cal = getCalendar();
    const { min, max } = adInputBounds();
    const bsToday = todayBs();

    container.innerHTML = `
      <div class="date-filter-bar space-y-2 mb-4">
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex gap-1 rounded-xl border-2 border-stone-300 p-0.5 bg-white" role="group" aria-label="${t('filter.calendarToggle')}">
            <button type="button" data-cal="ad"
                    class="min-h-[44px] px-3 rounded-lg font-bold text-sm ${cal === 'ad' ? 'bg-farm-green text-white' : 'text-stone-600'}">
              ${t('filter.calendarAd')}
            </button>
            <button type="button" data-cal="bs"
                    class="min-h-[44px] px-3 rounded-lg font-bold text-sm ${cal === 'bs' ? 'bg-farm-green text-white' : 'text-stone-600'}">
              ${t('filter.calendarBs')}
            </button>
          </div>
        </div>

        <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="${t('filter.presets')}">
          ${PRESET_ORDER.map((p) => `
            <button type="button" data-preset="${p}"
                    class="shrink-0 min-h-[44px] px-4 rounded-full border-2 font-bold text-sm whitespace-nowrap
                           ${currentPreset === p
                             ? 'bg-farm-green text-white border-farm-green'
                             : 'bg-white text-stone-700 border-stone-300'}">
              ${t(PRESET_LABEL[p])}
            </button>`).join('')}
        </div>

        <div id="dfb-custom" class="${showCustom ? '' : 'hidden'} bg-white rounded-xl border-2 border-stone-200 p-3 space-y-3">
          ${cal === 'ad' ? adCustomHtml(currentCustom, min, max) : bsCustomHtml(currentCustom, bsToday)}
          <div class="flex gap-2">
            <button type="button" id="dfb-apply"
                    class="flex-1 min-h-[44px] rounded-lg bg-farm-green text-white font-bold">
              ${t('filter.apply')}
            </button>
            <button type="button" id="dfb-clear"
                    class="min-h-[44px] px-4 rounded-lg border-2 border-stone-300 font-bold text-stone-600">
              ${t('filter.clear')}
            </button>
          </div>
        </div>
      </div>
    `;

    wire(container);
  }

  function adCustomHtml(custom, min, max) {
    const from = custom.fromAd ? isoToAdInput(custom.fromAd) : (custom.fromIso ? isoToAdInput(custom.fromIso) : '');
    const to = custom.toAd ? isoToAdInput(custom.toAd) : (custom.toIso ? isoToAdInput(custom.toIso) : '');
    return `
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm font-semibold text-stone-600">${t('filter.from')}</span>
          <input type="date" id="dfb-from-ad" value="${from}" min="${min}" max="${max}"
                 class="mt-1 w-full rounded-lg border-2 border-stone-300 px-2 py-2 font-semibold min-h-[44px]" />
        </label>
        <label class="block">
          <span class="text-sm font-semibold text-stone-600">${t('filter.to')}</span>
          <input type="date" id="dfb-to-ad" value="${to}" min="${min}" max="${max}"
                 class="mt-1 w-full rounded-lg border-2 border-stone-300 px-2 py-2 font-semibold min-h-[44px]" />
        </label>
      </div>`;
  }

  function bsCustomHtml(custom, bsToday) {
    const fromBs = custom.fromBs ?? (custom.fromIso ? isoToBs(custom.fromIso) : { ...bsToday });
    const toBs = custom.toBs ?? (custom.toIso ? isoToBs(custom.toIso) : { ...bsToday });
    return `
      <div class="space-y-3">
        <div>
          <span class="text-sm font-semibold text-stone-600">${t('filter.from')}</span>
          <div class="grid grid-cols-3 gap-2 mt-1" id="dfb-from-bs">${bsSelects('from', fromBs)}</div>
        </div>
        <div>
          <span class="text-sm font-semibold text-stone-600">${t('filter.to')}</span>
          <div class="grid grid-cols-3 gap-2 mt-1" id="dfb-to-bs">${bsSelects('to', toBs)}</div>
        </div>
      </div>`;
  }

  function bsSelects(prefix, { y, m, d }) {
    const monthNames = bsMonthNames(getLang());
    const days = bsMonthLength(y, m);
    const clampedD = Math.min(d, days);

    const years = [];
    for (let yr = BS_MIN_YEAR; yr <= BS_MAX_YEAR; yr++) years.push(yr);

    return `
      <select data-bs="${prefix}-y" class="rounded-lg border-2 border-stone-300 px-2 py-2 font-semibold min-h-[44px]">
        ${years.map((yr) => `<option value="${yr}" ${yr === y ? 'selected' : ''}>${yr}</option>`).join('')}
      </select>
      <select data-bs="${prefix}-m" class="rounded-lg border-2 border-stone-300 px-2 py-2 font-semibold min-h-[44px]">
        ${monthNames.map((name, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${name}</option>`).join('')}
      </select>
      <select data-bs="${prefix}-d" class="rounded-lg border-2 border-stone-300 px-2 py-2 font-semibold min-h-[44px]">
        ${Array.from({ length: days }, (_, i) => i + 1).map((day) =>
          `<option value="${day}" ${day === clampedD ? 'selected' : ''}>${day}</option>`
        ).join('')}
      </select>`;
  }

  function readBsBound(prefix) {
    const y = Number(container.querySelector(`[data-bs="${prefix}-y"]`)?.value);
    const m = Number(container.querySelector(`[data-bs="${prefix}-m"]`)?.value);
    let d = Number(container.querySelector(`[data-bs="${prefix}-d"]`)?.value);
    const maxD = bsMonthLength(y, m);
    if (d > maxD) d = maxD;
    return { y, m, d };
  }

  function refreshBsDayOptions(prefix) {
    const y = Number(container.querySelector(`[data-bs="${prefix}-y"]`)?.value);
    const m = Number(container.querySelector(`[data-bs="${prefix}-m"]`)?.value);
    const daySel = container.querySelector(`[data-bs="${prefix}-d"]`);
    if (!daySel) return;
    const days = bsMonthLength(y, m);
    const prev = Number(daySel.value) || 1;
    const clamped = Math.min(prev, days);
    daySel.innerHTML = Array.from({ length: days }, (_, i) => {
      const day = i + 1;
      return `<option value="${day}" ${day === clamped ? 'selected' : ''}>${day}</option>`;
    }).join('');
  }

  function wire(root) {
    root.querySelectorAll('[data-cal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setCalendar(btn.dataset.cal);
        render();
      });
    });

    root.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentPreset = btn.dataset.preset;
        showCustom = currentPreset === PRESETS.CUSTOM;
        if (currentPreset !== PRESETS.CUSTOM) {
          emit();
        }
        render();
      });
    });

    root.querySelectorAll('[data-bs]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const prefix = sel.dataset.bs.split('-')[0];
        refreshBsDayOptions(prefix);
      });
    });

    root.querySelector('#dfb-apply')?.addEventListener('click', () => {
      const cal = getCalendar();
      if (cal === 'ad') {
        const fromVal = root.querySelector('#dfb-from-ad')?.value;
        const toVal = root.querySelector('#dfb-to-ad')?.value;
        if (!fromVal || !toVal) return;
        currentCustom = {
          fromAd: adDateToIso(fromVal),
          toAd: adDateToIso(toVal),
        };
      } else {
        currentCustom = {
          fromBs: readBsBound('from'),
          toBs: readBsBound('to'),
        };
      }
      currentPreset = PRESETS.CUSTOM;
      emit();
    });

    root.querySelector('#dfb-clear')?.addEventListener('click', () => {
      currentCustom = {};
      currentPreset = PRESETS.LAST_7;
      showCustom = false;
      emit();
      render();
    });
  }

  const unsubCal = onCalendarChange(() => render());
  render();

  return () => unsubCal();
}
