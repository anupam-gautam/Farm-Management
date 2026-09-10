// Farm wall-clock time helper.
//
// Vercel functions run in UTC, but "feed the cows at 5 PM" means 5 PM at the
// farm, not 5 PM UTC. Recurring tasks are therefore expanded against a fixed
// farm timezone offset. Single-farm app → one offset, configurable via env.
// Default: Asia/Kathmandu (UTC+5:45 = 345 minutes).

export const FARM_TZ_OFFSET_MINUTES = Number(process.env.FARM_TZ_OFFSET_MINUTES ?? 345);

/** Current date/time expressed in farm wall-clock terms. */
export function farmNow() {
  return new Date(Date.now() + FARM_TZ_OFFSET_MINUTES * 60_000);
}

/**
 * Convert a farm wall-clock date + "HH:MM" to a UTC Date.
 * y/m/d are farm-local calendar fields (m is 0-based, matching Date.UTC).
 */
export function farmWallTimeToUtc(year, month, day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(year, month, day, h, m) - FARM_TZ_OFFSET_MINUTES * 60_000);
}

/** Farm-local calendar fields for a UTC instant (uses the shifted clock trick). */
export function farmLocalFields(utcDate) {
  const shifted = new Date(utcDate.getTime() + FARM_TZ_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(), // 0 = Sunday
  };
}
