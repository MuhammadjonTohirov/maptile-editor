function copyCoordinate(coordinate) {
  return Array.isArray(coordinate) ? coordinate.map(Number) : null;
}

export function routeExportPayload(result, profile, points) {
  if (result?.geometry?.type !== 'LineString'
    || !Array.isArray(result.geometry.coordinates)
    || result.geometry.coordinates.length < 2) {
    throw new TypeError('A drawable LineString route result is required');
  }

  return {
    schema_version: 1,
    profile,
    points: {
      a: copyCoordinate(points?.a),
      b: copyCoordinate(points?.b),
    },
    geometry: result.geometry,
    distance_m: result.distance_m,
    duration_s: result.duration_s,
    network_stale: Boolean(result.network_stale),
    steps: result.steps || [],
  };
}

export function routeExportJson(result, profile, points) {
  return `${JSON.stringify(routeExportPayload(result, profile, points), null, 2)}\n`;
}

export function routeExportFilename(profile) {
  return `route-${profile || 'unknown'}.json`;
}
