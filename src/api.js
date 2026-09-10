// Fetch wrapper for all API calls.
//   - normalises errors into ApiError with a translation-friendly code
//   - captures server time from the Date response header so Phase 4's
//     30-minute rule can't be defeated by changing the phone's clock
//   - detects network failure vs HTTP failure distinctly

let clockOffsetMs = 0;

/** Server-adjusted current time. Use this instead of `new Date()` for
 *  any business-rule comparison (Phase 4 completion window). */
export function serverNow() {
  return new Date(Date.now() + clockOffsetMs);
}

export class ApiError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;     // e.g. 'network', 'unauthorized', 'username_taken'
    this.status = status; // HTTP status, 0 for network failure
  }
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }

  // Track server clock skew on every response.
  const dateHeader = res.headers.get('Date');
  if (dateHeader) {
    const serverMs = new Date(dateHeader).getTime();
    if (!Number.isNaN(serverMs)) clockOffsetMs = serverMs - Date.now();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'generic', res.status);
  return data;
}
