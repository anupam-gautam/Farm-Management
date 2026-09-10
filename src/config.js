// Central constants. Values here are referenced across phases — change once, apply everywhere.

export const CONFIG = {
  // Phase 4 — worker cannot complete a task more than this many minutes before its due time.
  COMPLETION_WINDOW_MINUTES: 30,

  // Phase 6 — photos are purged after this many hours (7 days).
  PHOTO_TTL_HOURS: 168,

  // Phase 7 — state polling interval while the page is visible.
  POLL_INTERVAL_MS: 5_000,

  // Phase 5 — client-side image compression targets.
  IMAGE_MAX_DIMENSION: 1024,
  IMAGE_JPEG_QUALITY: 0.7,

  // Local storage keys (single prefix keeps devtools tidy).
  STORAGE_PREFIX: 'farm.',

  // Phase 10 — farm wall-clock (Asia/Kathmandu, UTC+5:45). Nepal has no DST.
  FARM_TZ_OFFSET_MINUTES: 345,
};

export function storageKey(name) {
  return CONFIG.STORAGE_PREFIX + name;
}

/** Farm-local calendar fields { y, m, d } for a UTC ISO instant (m is 1-based). */
export function farmDayParts(iso) {
  const shifted = new Date(new Date(iso).getTime() + CONFIG.FARM_TZ_OFFSET_MINUTES * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  };
}

/** UTC ISO instant at farm-day start (00:00 farm time) for calendar fields. */
export function farmDayStartIso({ y, m, d }) {
  return new Date(
    Date.UTC(y, m - 1, d, 0, 0, 0) - CONFIG.FARM_TZ_OFFSET_MINUTES * 60_000
  ).toISOString();
}

/** Add n calendar days in farm time; returns { y, m, d }. */
export function farmAddDays({ y, m, d }, n) {
  const ms = new Date(farmDayStartIso({ y, m, d })).getTime() + n * 86_400_000;
  return farmDayParts(new Date(ms).toISOString());
}
