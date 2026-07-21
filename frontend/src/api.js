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
  if (!response.ok) {
    // A 401 means the session is missing or expired. Broadcast it so the auth
    // controller can show the login overlay, wherever the call came from.
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:required'));
    }
    throw new ApiError(response.status, await errorDetail(response));
  }
  return response.json();
}

export const featuresApi = {
  list: () => request('/api/features'),
  version: () => request('/api/features/version'),
  meta: () => request('/api/meta'),
  businesses: (buildingId) => request(`/api/features/${buildingId}/businesses`),
  search: (query, limit = 20) => request(`/api/features/search?q=${encodeURIComponent(query)}&limit=${limit}`),
  listInBounds: (bbox, limit) => request(`/api/features?bbox=${bbox}&limit=${limit}`),
  get: (id) => request(`/api/features/${id}`),
  create: (payload) => request('/api/features', { method: 'POST', body: payload }),
  update: (id, payload) => request(`/api/features/${id}`, { method: 'PUT', body: payload }),
  remove: (id) => request(`/api/features/${id}`, { method: 'DELETE' }),
  clearAll: () => request('/api/features/clear-all', { method: 'DELETE' }),
  importOsm: (kind, bounds) => request(`/api/load-osm-${kind}`, { method: 'POST', body: bounds }),
};

// Admin-only, on-demand full-country OSM bulk load.
export const bulkApi = {
  countries: () => request('/api/bulk-load/countries'),
  status: () => request('/api/bulk-load/status'),
  start: (country) => request('/api/bulk-load', { method: 'POST', body: { country } }),
};

// A→B shortest path over the live road network (pgRouting), plus the
// admin-only rebuild that keeps that network in sync with edits.
export const routeApi = {
  find: (from, to, profile) => request(
    `/api/route?from_lng=${from[0]}&from_lat=${from[1]}&to_lng=${to[0]}&to_lat=${to[1]}&profile=${profile}`,
  ),
  rebuildStatus: () => request('/api/road-network/status'),
  rebuild: () => request('/api/road-network/rebuild', { method: 'POST' }),
};

// Auth + user management. The session lives in an httpOnly cookie the browser
// sends automatically, so there is no token to attach here.
export const authApi = {
  me: () => request('/api/auth/me'),
  login: (username, password) => request('/api/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  listUsers: () => request('/api/auth/users'),
  createUser: (payload) => request('/api/auth/users', { method: 'POST', body: payload }),
  updateUser: (id, payload) => request(`/api/auth/users/${id}`, { method: 'PATCH', body: payload }),
};
