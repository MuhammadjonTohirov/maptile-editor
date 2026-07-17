// The one HTTP client for the editor API (rule F2). Callers branch on
// ApiError.status — most importantly 404, which means the map is showing a
// ghost feature from a stale overlay tile.
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function isMissing(error) {
  return error instanceof ApiError && error.status === 404;
}

async function errorDetail(response) {
  try {
    const payload = await response.json();
    if (payload?.detail) {
      return typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail);
    }
  } catch {
    // Non-JSON error body; the HTTP status below is still meaningful.
  }
  return response.statusText || `HTTP ${response.status}`;
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
  return response.json();
}

export const featuresApi = {
  list: () => request('/api/features'),
  get: (id) => request(`/api/features/${id}`),
  create: (payload) => request('/api/features', { method: 'POST', body: payload }),
  update: (id, payload) => request(`/api/features/${id}`, { method: 'PUT', body: payload }),
  remove: (id) => request(`/api/features/${id}`, { method: 'DELETE' }),
  clearAll: () => request('/api/features/clear-all', { method: 'DELETE' }),
  importOsm: (kind, bounds) => request(`/api/load-osm-${kind}`, { method: 'POST', body: bounds }),
};
