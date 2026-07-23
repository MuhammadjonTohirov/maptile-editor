import assert from 'node:assert/strict';

import {
  routeExportFilename,
  routeExportJson,
  routeExportPayload,
} from '../frontend/src/route-export.js';

const result = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [71.7797, 40.3840],
      [71.7798, 40.3841],
      [71.7801, 40.3844],
    ],
  },
  distance_m: 52.5,
  duration_s: 12.25,
  network_stale: false,
  steps: [{
    maneuver: 'depart',
    coordinate: [71.7797, 40.3840],
    distance_m: 52.5,
  }],
};

const payload = routeExportPayload(result, 'car', {
  a: [71.7797, 40.3840],
  b: [71.7801, 40.3844],
});

assert.equal(payload.schema_version, 1);
assert.equal(payload.profile, 'car');
assert.deepEqual(payload.points.a, result.geometry.coordinates[0]);
assert.deepEqual(payload.points.b, result.geometry.coordinates.at(-1));
assert.deepEqual(payload.geometry.coordinates, result.geometry.coordinates);
assert.deepEqual(JSON.parse(routeExportJson(result, 'car', payload.points)), payload);
assert.equal(routeExportFilename('car'), 'route-car.json');
assert.throws(
  () => routeExportPayload({ geometry: { type: 'Point', coordinates: [0, 0] } }, 'foot', {}),
  /drawable LineString/,
);

console.log('Drawable route JSON export checks passed');
