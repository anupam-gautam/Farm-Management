// UTC ISO range query parsing for GET /api/tasks and GET /api/logs.

const MAX_SPAN_MS = 366 * 86_400_000;

function isValidIso(s) {
  if (!s || typeof s !== 'string') return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}T/.test(s);
}

/**
 * Parse ?from=&to= query params.
 * Returns { fromIso, toIso, useDefault } or { error: 'invalid_range' }.
 * When both absent, useDefault is true (caller applies its own default window).
 */
export function parseRangeQuery(query = {}) {
  const from = query.from;
  const to = query.to;

  if (!from && !to) {
    return { fromIso: null, toIso: null, useDefault: true };
  }

  const fromIso = from ? (isValidIso(from) ? from : null) : null;
  const toIso = to ? (isValidIso(to) ? to : null) : null;

  if ((from && !fromIso) || (to && !toIso)) {
    return { error: 'invalid_range' };
  }

  if (fromIso && toIso) {
    const span = new Date(toIso).getTime() - new Date(fromIso).getTime();
    if (span < 0 || span > MAX_SPAN_MS) {
      return { error: 'invalid_range' };
    }
  }

  return { fromIso, toIso, useDefault: false };
}
