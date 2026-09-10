// i18n runtime: translation lookup, localised dates/numbers, language switching.
// Every user-facing string in the app goes through t() — no literals in views.

import { DICTIONARY } from './i18n-dictionary.js';
import { storageKey, farmDayParts } from './config.js';
import { formatBs, isoToBs } from './nepaliDate.js';
import { serverNow } from './api.js';

const SUPPORTED = ['en', 'ne'];

const storage = typeof localStorage !== 'undefined'
  ? localStorage
  : { getItem: () => null, setItem: () => {} };

let lang = SUPPORTED.includes(storage.getItem(storageKey('lang')))
  ? storage.getItem(storageKey('lang'))
  : 'en';

const listeners = new Set();

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

/**
 * Translate a dot key, e.g. t('tasks.priorityUrgent'), with optional params:
 * t('worker.unlocksIn', { time: '12 min' })
 * Falls back to English, then to the raw key, and warns in dev on a miss.
 */
export function t(key, params = {}) {
  const value = lookup(lang, key) ?? lookup('en', key);
  if (value === undefined) {
    console.warn(`[i18n] missing key: "${key}" (lang: ${lang})`);
    return key;
  }
  return value.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] !== undefined ? String(params[name]) : `{${name}}`
  );
}

function lookup(language, key) {
  return key.split('.').reduce((node, part) => node?.[part], DICTIONARY[language]);
}

// ---------------------------------------------------------------------------
// Language state
// ---------------------------------------------------------------------------

export function getLang() {
  return lang;
}

export function setLang(next) {
  if (!SUPPORTED.includes(next) || next === lang) return;
  lang = next;
  storage.setItem(storageKey('lang'), lang);
  document.documentElement.lang = next;
  listeners.forEach((fn) => fn(next));
}

/** Subscribe to language changes. Returns an unsubscribe function. */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Locale string for Intl APIs. ne-NP renders Devanagari digits automatically. */
function locale() {
  return lang === 'ne' ? 'ne-NP' : 'en-GB';
}

// ---------------------------------------------------------------------------
// Localised formatting
// ---------------------------------------------------------------------------

export function formatNumber(n) {
  return new Intl.NumberFormat(locale()).format(n);
}

function activeCalendar() {
  const stored = storage.getItem(storageKey('calendar'));
  if (stored === 'ad' || stored === 'bs') return stored;
  return lang === 'ne' ? 'bs' : 'ad';
}

/** Date only — respects AD/BS calendar toggle. */
export function formatDateSmart(iso) {
  if (activeCalendar() === 'bs') {
    return formatBs(isoToBs(iso), lang);
  }
  return formatDate(iso);
}

export function formatDate(iso) {
  if (activeCalendar() === 'bs') {
    return formatBs(isoToBs(iso), lang);
  }
  return new Intl.DateTimeFormat(locale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

export function formatTime(iso) {
  return new Intl.DateTimeFormat(locale(), {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

export function formatDateTime(iso) {
  return `${formatDateSmart(iso)}, ${formatTime(iso)}`;
}

/** "Today at 5:00 PM" style smart label for due times (farm-day boundaries). */
export function formatSmartDateTime(iso) {
  const dParts = farmDayParts(iso);
  const nParts = farmDayParts(serverNow().toISOString());
  const toDayNum = (p) => p.y * 372 + p.m * 32 + p.d;
  const farmDiff = toDayNum(dParts) - toDayNum(nParts);
  const time = formatTime(iso);
  if (farmDiff === 0) return t('time.todayAt', { time });
  if (farmDiff === 1) return t('time.tomorrowAt', { time });
  if (farmDiff === -1) return t('time.yesterdayAt', { time });
  return formatDateTime(iso);
}

/** Relative time, e.g. "2 hours ago" / "२ घण्टा अघि", via Intl.RelativeTimeFormat. */
export function formatRelative(iso) {
  const diffMs = new Date(iso).getTime() - Date.now();
  const absSec = Math.round(Math.abs(diffMs) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const sign = diffMs < 0 ? -1 : 1;
  if (absSec < 60) return rtf.format(sign * Math.round(diffMs / 1000 / 60) || 0, 'minute');
  if (absSec < 3600) return rtf.format(Math.trunc(sign * absSec / 60), 'minute');
  if (absSec < 86400) return rtf.format(Math.trunc(sign * absSec / 3600), 'hour');
  return rtf.format(Math.trunc(sign * absSec / 86400), 'day');
}

/** Localised weekday names, index 0 = Sunday … 6 = Saturday (for pickers). */
export function weekdayNames(style = 'short') {
  const fmt = new Intl.DateTimeFormat(locale(), { weekday: style, timeZone: 'UTC' });
  // 2023-01-01 was a Sunday — walk the week from a known anchor.
  return Array.from({ length: 7 }, (_, i) =>
    fmt.format(new Date(Date.UTC(2023, 0, 1 + i)))
  );
}

/** Duration label for countdowns: "12 min", "1 hr 5 min", "2 day(s)". */
export function formatDuration(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  if (totalMin < 60) return t('time.minutes', { n: formatNumber(totalMin) });
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 24) {
    return mins === 0
      ? t('time.hours', { n: formatNumber(hours) })
      : t('time.hoursMinutes', { h: formatNumber(hours), m: formatNumber(mins) });
  }
  return t('time.days', { n: formatNumber(Math.ceil(totalMin / 1440)) });
}
