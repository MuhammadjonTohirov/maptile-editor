import assert from 'node:assert/strict';

import {
  RoadSegmentIndex,
  collectRoadSegments,
  roadConnectivity,
} from '../frontend/src/geometry.js';

const road = (id, coordinates) => ({
  id,
  geometry: { type: 'LineString', coordinates },
  properties: { feature_type: 'road' },
});

const host = road(1, [[71.0, 40.0], [71.01, 40.0]]);
const manual = road(2, [[71.005, 40.0], [71.005, 40.005]]);
const continuation = road(3, [[71.01, 40.0], [71.015, 40.0]]);
const roads = [host, manual, continuation];
const index = new RoadSegmentIndex(collectRoadSegments(roads));

const snapped = index.nearestCoordinate(71.004, 40.00002, 0.001);
assert.ok(Math.abs(snapped[0] - 71.004) < 1e-9);
assert.ok(Math.abs(snapped[1] - 40.0) < 1e-9);

const markers = roadConnectivity(roads, index);
const connected = (id) => markers
  .filter((marker) => marker.properties.road_id === String(id))
  .map((marker) => marker.properties.connected);
assert.deepEqual(connected(1), [false, true]);
assert.deepEqual(connected(2), [true, false]);
assert.deepEqual(connected(3), [true, false]);

assert.equal(index.nearestCoordinate(71.005, 40.0, 0.001, 1)?.[0], 71.005);
assert.equal(index.nearestCoordinate(72.0, 41.0, 0.001), undefined);

// Longitude degrees represent fewer metres away from the equator. Candidate
// lookup must expand across the neighboring grid cell before exact distance
// calculation, or a valid high-latitude snap can disappear at a cell edge.
const highLatitude = RoadSegmentIndex.fromFeatures([
  road(4, [[71.00051, 60.0], [71.00051, 60.001]]),
]);
assert.ok(highLatitude.nearestCoordinate(71.00042, 60.0, 8 / 111_320));

console.log('Road snapping and connectivity checks passed');
