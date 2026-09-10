// Bikram Sambat wrapper around the vendored @sbmdkl/nepali-date-converter.
// All app code imports from here — never from vendor/ directly.

import { adToBs, bsToAd, calculateAge } from '../vendor/nepali-date-converter.es.js';
import { farmDayParts, farmDayStartIso, farmAddDays } from './config.js';

export const BS_MIN_YEAR = 1978;
export const BS_MAX_YEAR = 2099;
export const AD_MIN_YEAR = 1921;
export const AD_MAX_YEAR = 2040;

const BS_MONTHS_EN = [
  'Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
];
const BS_MONTHS_NE = [
  'बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज',
  'कात्तिक', 'मंसिर', 'पुष', 'माघ', 'फागुन', 'चैत',
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function adStr({ y, m, d }) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function mapLibraryError(err) {
  const msg = String(err?.message ?? err);
  if (msg.includes('BS Date out of range')) return { code: 'bs_out_of_range' };
  if (msg.includes('AD Date out of range')) return { code: 'ad_out_of_range' };
  if (msg.includes('Day is invalid')) return { code: 'bs_invalid_day' };
  if (msg.includes('Month is invalid')) return { code: 'bs_invalid_month' };
  if (msg.includes('Year is invalid')) return { code: 'bs_invalid_year' };
  if (msg.includes('Date format is invalid')) return { code: 'bs_invalid_format' };
  if (msg.includes('greater then today')) return { code: 'bs_future_date' };
  return { code: 'bs_unknown' };
}

function throwTagged(err) {
  const tagged = mapLibraryError(err);
  const e = new Error(tagged.code);
  e.code = tagged.code;
  throw e;
}

function safeAdToBs(adDateStr) {
  try {
    return adToBs(adDateStr);
  } catch (err) {
    throwTagged(err);
  }
}

/** bsToAd with round-trip correction for timezone-off-by-one bug. */
export function bsToAdFixed(bsY, bsM, bsD) {
  const input = `${bsY}-${pad2(bsM)}-${pad2(bsD)}`;
  let result;
  try {
    result = bsToAd(input);
  } catch (err) {
    throwTagged(err);
  }
  if (safeAdToBs(result) === input) return result;

  const base = new Date(`${result}T00:00:00.000Z`).getTime();
  for (const delta of [1, -1, 2, -2]) {
    const candidate = new Date(base + delta * 86_400_000).toISOString().slice(0, 10);
    try {
      if (adToBs(candidate) === input) return candidate;
    } catch {
      // try next offset
    }
  }
  return result;
}

/** UTC ISO → Bikram Sambat { y, m, d } using farm-day boundaries. */
export function isoToBs(iso) {
  const ad = farmDayParts(iso);
  const bsStr = safeAdToBs(adStr(ad));
  const [y, m, d] = bsStr.split('-').map(Number);
  return { y, m, d };
}

/** Bikram Sambat { y, m, d } → UTC ISO at farm-day start. */
export function bsToIso({ y, m, d }) {
  const adStr = bsToAdFixed(y, m, d);
  const [ay, am, ad] = adStr.split('-').map(Number);
  return farmDayStartIso({ y: ay, m: am, d: ad });
}

/** Days in a BS month (29–32), derived from AD day difference. */
export function bsMonthLength(y, m) {
  const start = bsToIso({ y, m, d: 1 });
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const end = bsToIso({ y: next.y, m: next.m, d: 1 });
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
}

export function bsMonthNames(lang) {
  return lang === 'ne' ? BS_MONTHS_NE : BS_MONTHS_EN;
}

/** Today's BS date in farm timezone. */
export function todayBs(nowIso = new Date().toISOString()) {
  return isoToBs(nowIso);
}

/** "२०८३ भदौ २४" / "2083 Bhadra 24" */
export function formatBs({ y, m, d }, lang) {
  const months = bsMonthNames(lang);
  const month = months[m - 1] ?? String(m);
  if (lang === 'ne') {
    const nf = new Intl.NumberFormat('ne-NP');
    return `${nf.format(y)} ${month} ${nf.format(d)}`;
  }
  return `${y} ${month} ${d}`;
}

/** Age from a BS date to today (throws on future dates). */
export function bsAge(bsDate) {
  try {
    const str = typeof bsDate === 'string'
      ? bsDate
      : `${bsDate.y}-${pad2(bsDate.m)}-${pad2(bsDate.d)}`;
    return calculateAge(str);
  } catch (err) {
    throwTagged(err);
  }
}

/** AD date string bounds for native <input type="date">. */
export function adInputBounds() {
  return { min: `${AD_MIN_YEAR}-04-13`, max: `${AD_MAX_YEAR}-12-31` };
}

/** Convert AD picker value to farm-day start ISO. */
export function adDateToIso(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return farmDayStartIso({ y, m, d });
}

/** Farm-day start ISO → YYYY-MM-DD for AD picker. */
export function isoToAdInput(iso) {
  const { y, m, d } = farmDayParts(iso);
  return adStr({ y, m, d });
}

export { farmAddDays };
