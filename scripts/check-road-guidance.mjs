import assert from 'node:assert/strict';

import { RoadSegmentIndex } from '../frontend/src/geometry.js';
import {
  roadGuidanceCollection,
  sameRoadSpan,
  selectedRoadSpan,
  selectedRoadSpanSelection,
} from '../frontend/src/road-guidance.js';

const road = (id, coordinates, direction = 'bidirectional', sourceKind = 'osm_import') => ({
  id,
  geometry: { type: 'LineString', coordinates },
  properties: { feature_type: 'road', direction, source_kind: sourceKind },
});

const selected = road(1, [[71.0, 40.0], [71.001, 40.0]]);
const leftBranch = road(2, [[71.001, 40.0], [71.001, 40.001]]);
const overlappingLeftBranch = road(4, [[71.001, 40.0], [71.001001, 40.001]]);
// Close enough for drawing snap preview, but not actually joined. It must not
// become an "alien" turn option merely because it lies within eight metres.
const nearbyUnconnected = road(3, [[71.001, 40.000045], [71.002, 40.000045]]);
const roads = [selected, leftBranch, overlappingLeftBranch, nearbyUnconnected];
const index = RoadSegmentIndex.fromFeatures(roads);

const bidirectional = roadGuidanceCollection(selected, index);
assert.equal(bidirectional.features.filter((feature) => feature.properties.kind === 'direction').length, 0);
assert.ok(bidirectional.features.some((feature) =>
  feature.properties.kind === 'turn-arrow' && feature.properties.maneuver === 'left'));
assert.equal(
  bidirectional.features.some((feature) => feature.properties.kind === 'turn-line'),
  false,
  'turn guidance uses standalone arrows without connector arms',
);
assert.deepEqual(
  bidirectional.features.find((feature) => feature.properties.maneuver === 'left').geometry.coordinates,
  [71.001, 40.0],
  'turn arrows are anchored directly on the junction',
);
assert.equal(
  bidirectional.features.some((feature) => feature.properties.road_id === '3'),
  false,
  'nearby unconnected roads do not become turn options',
);
assert.equal(
  bidirectional.features.filter((feature) => feature.properties.maneuver === 'left').length,
  1,
  'overlapping road features produce one arrow for their shared direction',
);
assert.equal(
  bidirectional.features.filter((feature) => feature.properties.maneuver === 'uturn').length,
  2,
  'bidirectional roads expose one separate U-turn restriction at each end',
);
assert.ok(bidirectional.features
  .filter((feature) => feature.properties.maneuver === 'uturn')
  .every((feature) => feature.properties.allowed === false));

const oneWayRoad = road(1, selected.geometry.coordinates, 'oneway');
const oneWay = roadGuidanceCollection(oneWayRoad, index);
const direction = oneWay.features.find((feature) => feature.properties.kind === 'direction');
assert.deepEqual(direction.geometry.coordinates, selected.geometry.coordinates);
assert.equal(oneWay.features.some((feature) => feature.properties.maneuver === 'uturn'), false);
assert.ok(oneWay.features.some((feature) => feature.properties.maneuver === 'left'));

const reverseRoad = road(1, selected.geometry.coordinates, 'oneway_reverse');
const reverse = roadGuidanceCollection(reverseRoad, index);
assert.deepEqual(
  reverse.features.find((feature) => feature.properties.kind === 'direction').geometry.coordinates,
  [...selected.geometry.coordinates].reverse(),
);
assert.equal(reverse.features.some((feature) => feature.properties.maneuver === 'left'), false);

const corridor = road(20, [
  [71.0, 40.0],
  [71.001, 40.0],
  [71.002, 40.0],
  [71.003, 40.0],
]);
const firstJunction = road(21, [[71.001, 40.0], [71.001, 40.001]]);
const secondJunction = road(22, [[71.002, 40.0], [71.002, 39.999]]);
const corridorIndex = RoadSegmentIndex.fromFeatures([corridor, firstJunction, secondJunction]);
const corridorSelection = selectedRoadSpanSelection(
  corridor,
  corridorIndex,
  [71.0015, 40.0],
);
assert.equal(corridorSelection.partial, true);
assert.deepEqual(corridorSelection.start, [71.001, 40.0]);
assert.deepEqual(corridorSelection.end, [71.002, 40.0]);
assert.deepEqual(
  corridorSelection.geometry.coordinates,
  [[71.001, 40.0], [71.002, 40.0]],
  'the geometry editor receives only the clicked node-to-node span',
);
const followingCorridorSelection = selectedRoadSpanSelection(
  corridor,
  corridorIndex,
  [71.0025, 40.0],
);
assert.equal(
  sameRoadSpan(corridorSelection, followingCorridorSelection),
  false,
  'a following span on the same stored road remains independently selectable',
);
assert.equal(
  sameRoadSpan(
    corridorSelection,
    selectedRoadSpanSelection(corridor, corridorIndex, [71.0016, 40.0]),
  ),
  true,
  'clicking the active span does not reset its vertex-editing session',
);
assert.deepEqual(
  followingCorridorSelection.geometry.coordinates,
  [[71.002, 40.0], [71.003, 40.0]],
  'switching spans selects the following node-to-node geometry only',
);
const corridorGuidance = roadGuidanceCollection(corridor, corridorIndex, [71.0015, 40.0]);
assert.deepEqual(
  corridorGuidance.features.find((feature) => feature.properties.kind === 'selected').geometry.coordinates,
  [[71.001, 40.0], [71.002, 40.0]],
  'a click highlights only the node-to-node span surrounding it',
);
assert.deepEqual(
  [...new Set(corridorGuidance.features
    .filter((feature) => feature.properties.kind === 'turn-arrow')
    .map((feature) => JSON.stringify(feature.geometry.coordinates)))]
    .map((coordinate) => JSON.parse(coordinate))
    .sort((left, right) => left[0] - right[0]),
  [[71.001, 40.0], [71.002, 40.0]],
  'turn controls are anchored only at the selected span junctions',
);

const host = road(30, [[71.0, 40.01], [71.003, 40.01]]);
const firstManualBranch = road(
  31,
  [[71.001, 40.01], [71.001, 40.011]],
  'bidirectional',
  'manual',
);
const secondManualBranch = road(
  32,
  [[71.002, 40.01], [71.002, 40.011]],
  'bidirectional',
  'manual',
);
assert.deepEqual(
  selectedRoadSpan(
    host,
    RoadSegmentIndex.fromFeatures([host, firstManualBranch, secondManualBranch]),
    [71.0015, 40.01],
  ).coordinates,
  [[71.001, 40.01], [71.002, 40.01]],
  'manual midpoint connections split only the clicked host span in guidance',
);

// A manually projected junction can differ from an existing host endpoint by
// sub-millimetre precision. It is still the same topology node and must not
// create the tiny partial span that previously made confirmed delete return
// 422 after its expected published-road confirmation.
const precisionHost = road(40, [
  [71.7848155, 40.385931],
  [71.7851776, 40.3860515],
]);
const precisionBranch = road(
  41,
  [
    [71.784815765, 40.385930535],
    [71.7844, 40.3855],
  ],
  'bidirectional',
  'manual',
);
const precisionSelection = selectedRoadSpanSelection(
  precisionHost,
  RoadSegmentIndex.fromFeatures([precisionHost, precisionBranch]),
  [71.78481570176561, 40.385931067586505],
);
assert.equal(precisionSelection.partial, false);
assert.deepEqual(
  precisionSelection.geometry.coordinates,
  precisionHost.geometry.coordinates,
  'near-endpoint projected cuts collapse to the canonical stored endpoint',
);

const tinyRemainder = road(42, [
  [71.7848155, 40.385931],
  [71.784815703, 40.385931068],
]);
const tinySelection = selectedRoadSpanSelection(
  tinyRemainder,
  RoadSegmentIndex.fromFeatures([tinyRemainder, precisionBranch]),
  [71.78481570176561, 40.385931067586505],
);
assert.equal(tinySelection.partial, false);
assert.deepEqual(
  tinySelection.geometry.coordinates,
  tinyRemainder.geometry.coordinates,
  'an existing precision remainder is selected as one full road, never as a zero-length subspan',
);

const midpointSelected = road(10, [[71.001, 39.999], [71.001, 40.0]]);
const midpointHost = road(11, [[71.0, 40.0], [71.002, 40.0]]);
const secondNearbyHost = road(12, [[71.0, 40.000003], [71.002, 40.000003]]);
const midpointGuidance = roadGuidanceCollection(
  midpointSelected,
  RoadSegmentIndex.fromFeatures([midpointSelected, midpointHost, secondNearbyHost]),
);
assert.ok(midpointGuidance.features.some((feature) => feature.properties.road_id === '11'));
assert.equal(
  midpointGuidance.features.some((feature) => feature.properties.road_id === '12'),
  false,
  'a midpoint junction selects only the affected nearest host road',
);

console.log('Road direction and junction guidance checks passed');
