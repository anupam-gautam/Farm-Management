// Shared date-range presets, persistence, and client-side filtering.

import { storageKey } from './config.js';

const storage = typeof localStorage !== 'undefined'
  ? localStorage
  : { getItem: () => null, setItem: () => {} };
import { farmDayParts, farmDayStartIso, farmAddDays } from './config.js';
import { serverNow } from './api.js';
import { getLang } from './i18n.js';
import { t } from './i18n.js';
import { isoToBs, bsToIso, formatBs, isoToAdInput } from './nepaliDate.js';

export const PRESETS = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  LAST_7: 'last7',
  THIS_MONTH: 'thisMonth',
  CUSTOM: 'custom',
  ALL: 'all',
};

const ALL_SPAN_DAYS = 366;

let calendarMode = loadCalendar();

const calendarListeners = new Set();

export function getCalendar() {
  return calendarMode;
}

export function setCalendar(mode) {
  if (mode !== 'ad' && mode !== 'bs') return;
  calendarMode = mode;
  storage.setItem(storageKey('calendar'), mode);
  calendarListeners.forEach((fn) => fn(mode));
}

export function onCalendarChange(fn) {
  calendarListeners.add(fn);
  return () => calendarListeners.delete(fn);
}

export function loadCalendar() {
  const stored = storage.getItem(storageKey('calendar'));
  if (stored === 'ad' || stored === 'bs') return stored;
  const lang = storage.getItem(storageKey('lang'));
  return lang === 'ne' ? 'bs' : 'ad';
}

function farmTodayStart(now = serverNow()) {
  const parts = farmDayParts(now.toISOString());
  return farmDayStartIso(parts);
}

function farmTomorrowStart(now = serverNow()) {
  const parts = farmAddDays(farmDayParts(now.toISOString()), 1);
  return farmDayStartIso(parts);
}

function thisMonthRange(calendar, now = serverNow()) {
  if (calendar === 'bs') {
    const bs = isoToBs(now.toISOString());
    const fromIso = bsToIso({ y: bs.y, m: bs.m, d: 1 });
    const next = bs.m === 12 ? { y: bs.y + 1, m: 1 } : { y: bs.y, m: bs.m + 1 };
    const toIso = bsToIso({ y: next.y, m: next.m, d: 1 });
    return { fromIso, toIso };
  }
  const { y, m } = farmDayParts(now.toISOString());
  const fromIso = farmDayStartIso({ y, m, d: 1 });
  const next = m === 12 ? { y: y + 1, m: 1, d: 1 } : { y, m: m + 1, d: 1 };
  const toIso = farmDayStartIso(next);
  return { fromIso, toIso };
}

/**
 * Resolve a preset (+ optional custom bounds) to { fromIso, toIso, preset }.
 * fromIso is farm-day start; toIso is exclusive.
 */
export function resolveRange(preset, custom = {}, calendar = getCalendar(), now = serverNow()) {
  const todayStart = farmTodayStart(now);
  const tomorrowStart = farmTomorrowStart(now);

  if (preset === PRESETS.ALL) {
    const fromParts = farmAddDays(farmDayParts(now.toISOString()), -(ALL_SPAN_DAYS - 1));
    return {
      preset,
      fromIso: farmDayStartIso(fromParts),
      toIso: tomorrowStart,
      all: true,
    };
  }

  if (preset === PRESETS.TODAY) {
    return { preset, fromIso: todayStart, toIso: tomorrowStart };
  }

  if (preset === PRESETS.YESTERDAY) {
    const yParts = farmAddDays(farmDayParts(now.toISOString()), -1);
    return {
      preset,
      fromIso: farmDayStartIso(yParts),
      toIso: todayStart,
    };
  }

  if (preset === PRESETS.LAST_7) {
    const fromParts = farmAddDays(farmDayParts(now.toISOString()), -6);
    return {
      preset,
      fromIso: farmDayStartIso(fromParts),
      toIso: tomorrowStart,
    };
  }

  if (preset === PRESETS.THIS_MONTH) {
    const { fromIso, toIso } = thisMonthRange(calendar, now);
    return { preset, fromIso, toIso };
  }

  if (preset === PRESETS.CUSTOM) {
    let fromIso = custom.fromIso ?? null;
    let toIso = custom.toIso ?? null;
    if (custom.fromAd) fromIso = custom.fromAd;
    if (custom.toAd) toIso = custom.toAd;
    if (custom.fromBs) fromIso = bsToIso(custom.fromBs);
    if (custom.toBs) toIso = bsToIso(custom.toBs);
    // Custom end date is inclusive in the UI — make toIso exclusive (+1 farm day).
    if (toIso && custom.inclusiveEnd) {
      const endParts = farmDayParts(toIso);
      const next = farmAddDays(endParts, 1);
      toIso = farmDayStartIso(next);
    }
    return { preset, fromIso, toIso, custom };
  }

  return resolveRange(PRESETS.LAST_7, {}, calendar, now);
}

/** Client-side filter: is `iso` inside the range? Null bounds = unbounded. */
export function inRange(iso, range) {
  if (!range || range.all) return true;
  const t = new Date(iso).getTime();
  if (range.fromIso && t < new Date(range.fromIso).getTime()) return false;
  if (range.toIso && t >= new Date(range.toIso).getTime()) return false;
  return true;
}

export function loadViewRange(viewKey) {
  try {
    const raw = storage.getItem(storageKey(`filter.${viewKey}`));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveViewRange(viewKey, state) {
  storage.setItem(storageKey(`filter.${viewKey}`), JSON.stringify(state));
}

/** Build query string params for API fetches from a resolved range. */
export function rangeToQuery(range) {
  const params = new URLSearchParams();
  if (range?.fromIso) params.set('from', range.fromIso);
  if (range?.toIso) params.set('to', range.toIso);
  return params.toString();
}

/** Human-readable label for headers and empty states. */
export function describeRange(range, lang = getLang(), calendar = getCalendar()) {
  if (!range) return t('filter.presetLast7');
  const presetLabels = {
    [PRESETS.TODAY]: 'filter.presetToday',
    [PRESETS.YESTERDAY]: 'filter.presetYesterday',
    [PRESETS.LAST_7]: 'filter.presetLast7',
    [PRESETS.THIS_MONTH]: 'filter.presetThisMonth',
    [PRESETS.ALL]: 'filter.presetAll',
    [PRESETS.CUSTOM]: 'filter.presetCustom',
  };
  if (range.preset && range.preset !== PRESETS.CUSTOM) {
    return t(presetLabels[range.preset] ?? 'filter.presetLast7');
  }
  if (range.fromIso && range.toIso) {
    const fromLabel = calendar === 'bs'
      ? formatBs(isoToBs(range.fromIso), lang)
      : isoToAdInput(range.fromIso);
    const endParts = farmAddDays(farmDayParts(range.toIso), -1);
    const toEndIso = farmDayStartIso(endParts);
    const toLabel = calendar === 'bs'
      ? formatBs(isoToBs(toEndIso), lang)
      : isoToAdInput(toEndIso);
    return t('filter.rangeFromTo', { from: fromLabel, to: toLabel });
  }
  return t('filter.presetCustom');
}

/** Default range for a view. */
export function defaultViewRange(viewKey) {
  const saved = loadViewRange(viewKey);
  if (saved) {
    return resolveRange(saved.preset, saved.custom ?? {}, getCalendar());
  }
  if (viewKey === 'worker') {
    return resolveRange(PRESETS.TODAY);
  }
  return resolveRange(PRESETS.LAST_7);
}
