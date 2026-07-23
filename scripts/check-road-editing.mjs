import assert from 'node:assert/strict';

import { RoadSegmentIndex } from '../frontend/src/geometry.js';
import {
  canSnapRoadCoordinate,
  resolveSelectedGeometry,
  RoadEditSession,
  ROAD_SNAP_DEGREES,
  snapRoadEndpoints,
  validateRoadLineString,
} from '../frontend/src/road-editing.js';
import { buildRoadConnectivityState } from '../frontend/src/road-connectivity-ui.js';

const road = (id, coordinates) => ({
  id,
  geometry: { type: 'LineString', coordinates },
  properties: { feature_type: 'road' },
});

const host = road(1, [[71.7798, 40.3840], [71.7802, 40.3840]]);
const edited = road(2, [[71.77995, 40.38405], [71.7800, 40.3843], [71.7803, 40.3843]]);
const index = RoadSegmentIndex.fromFeatures([host, edited]);

// Endpoints project onto the middle of the nearest host segment within 8 m.
const snapped = snapRoadEndpoints(edited.geometry, index, edited.id);
assert.ok(Math.abs(snapped.coordinates[0][0] - 71.77995) < 1e-9);
assert.ok(Math.abs(snapped.coordinates[0][1] - 40.3840) < 1e-9);
assert.deepEqual(snapped.coordinates.at(-1), edited.geometry.coordinates.at(-1));

// Existing road endpoint editing excludes interior vertices and the road itself.
const geometryContext = (currentCoordinate) => ({
  currentCoordinate,
  getCurrentGeometrySnapshot: () => edited.geometry,
});
assert.equal(canSnapRoadCoordinate(geometryContext(0), true), true);
assert.equal(canSnapRoadCoordinate(geometryContext(1), true), false);
assert.equal(canSnapRoadCoordinate(geometryContext(2), true), true);
assert.equal(index.nearestCoordinate(71.7800, 40.3843, ROAD_SNAP_DEGREES, 2), undefined);

// Invalid, duplicate, and zero-length lines never reach persistence.
assert.equal(validateRoadLineString({ type: 'Point', coordinates: [0, 0] }).valid, false);
assert.equal(validateRoadLineString({ type: 'LineString', coordinates: [[1, 1]] }).valid, false);
assert.equal(validateRoadLineString({ type: 'LineString', coordinates: [[1, 1], [1, 1]] }).valid, false);
assert.equal(validateRoadLineString({ type: 'LineString', coordinates: [[1, 1], [2, 2], [2, 2]] }).valid, false);
assert.equal(validateRoadLineString({ type: 'LineString', coordinates: [[1, 1], [2, 2]] }).valid, true);

// Cancel restores the original and double-finish claims one server save.
const session = new RoadEditSession();
session.begin(2, edited.geometry);
session.stage(snapped);
assert.equal(session.isDirty(2), true);
assert.deepEqual(session.cancel(), edited.geometry);
assert.equal(session.claimNewDraw('draw-1'), true);
assert.equal(session.claimNewDraw('draw-1'), false);

// Save reads Terra Draw's live geometry before an older staged/stored copy.
const visiblyMoved = {
  type: 'LineString',
  coordinates: [[71.77995, 40.38405], [71.7801, 40.3845], [71.7803, 40.3843]],
};
const resolved = resolveSelectedGeometry([{
  type: 'Feature',
  id: 'draw-road-2',
  geometry: visiblyMoved,
  properties: { serverId: 2, mode: 'linestring' },
}], '2', snapped, edited.geometry);
assert.deepEqual(resolved, visiblyMoved);
assert.notEqual(resolved, visiblyMoved);

// A partial selection keeps the full way in the snap index while endpoint
// markers and the connectivity count belong only to the visible span.
const longRoad = road(10, [[71.0, 40.0], [71.001, 40.0], [71.002, 40.0]]);
const sideA = road(11, [[71.001, 40.0], [71.001, 40.001]]);
const sideB = road(12, [[71.002, 40.0], [71.002, 40.001]]);
const selectedSpanGeometry = {
  type: 'LineString',
  coordinates: [[71.001, 40.0], [71.002, 40.0]],
};
const connectivity = buildRoadConnectivityState(
  [longRoad, sideA, sideB],
  {
    serverId: '10',
    geometry: selectedSpanGeometry,
    fullGeometry: longRoad.geometry,
    roadSpan: { start: [71.001, 40.0], end: [71.002, 40.0] },
    properties: { feature_type: 'road' },
  },
  selectedSpanGeometry,
);
assert.equal(
  connectivity.segmentIndex.segments.filter((segment) => segment.owner === '10').length,
  2,
);
const selectedMarkers = connectivity.markers.filter(
  (marker) => marker.properties.road_id === '10',
);
assert.deepEqual(
  selectedMarkers.map((marker) => marker.geometry.coordinates),
  selectedSpanGeometry.coordinates,
);
assert.equal(selectedMarkers.every((marker) => marker.properties.connected), true);

// The durable state renderer distinguishes stale, rebuilding, and fresh graphs.
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.window = { location: { search: '' } };
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { languages: ['en'], language: 'en' },
});
globalThis.document = { documentElement: {} };
const { networkStatePresentation } = await import('../frontend/src/road-network-ui.js');
assert.equal(networkStatePresentation({ published_at: 'now', is_stale: true }).tone, 'stale');
assert.equal(networkStatePresentation({ status: 'running', is_stale: true }).tone, 'rebuilding');
assert.equal(networkStatePresentation({ published_at: 'now', is_stale: false }).tone, 'fresh');

console.log('Road editing workflow checks passed');
