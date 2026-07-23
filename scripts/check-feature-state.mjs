import assert from 'node:assert/strict';

import {
  extraProperties,
  mergeFeatureProperties,
  rawFeaturePayload,
} from '../frontend/src/feature-form.js';
import { EditorData } from '../frontend/src/editor-data.js';
import { featuresApi } from '../frontend/src/api.js';
import { UndoStack } from '../frontend/src/undo-stack.js';

const geometry = {
  type: 'LineString',
  coordinates: [[71.0, 40.0], [71.1, 40.1]],
};
const properties = {
  name: 'Old name',
  feature_type: 'road',
  road_type: 'residential',
  max_speed: 30,
  created_by: { id: 1, username: 'creator' },
  routing_access: 'destination',
  osm_tags: { highway: 'residential' },
};

assert.deepEqual(extraProperties(properties), {
  routing_access: 'destination',
  osm_tags: { highway: 'residential' },
});

const payload = rawFeaturePayload(geometry, properties);
assert.equal(payload.name, 'Old name');
assert.equal(payload.feature_type, 'road');
assert.equal(payload.road_type, 'residential');
assert.equal(payload.max_speed, 30);
assert.deepEqual(payload.properties, {
  routing_access: 'destination',
  osm_tags: { highway: 'residential' },
});

const merged = mergeFeatureProperties({
  id: 42,
  geometry,
  properties: { routing_access: 'destination' },
  name: 'Server name',
  description: '',
  source_kind: 'manual',
  feature_type: 'road',
  road_type: 'primary',
  max_speed: 70,
  updated_at: '2026-07-23T09:00:00+00:00',
});
assert.equal(merged.name, 'Server name');
assert.equal(merged.road_type, 'primary');
assert.equal(merged.routing_access, 'destination');
assert.equal(merged.updated_at, '2026-07-23T09:00:00+00:00');

const undo = new UndoStack(2);
const first = () => {};
const second = () => {};
const third = () => {};
undo.push(first);
undo.push(second, { roadMutation: true });
undo.push(third);
assert.equal(undo.length, 2);
assert.equal(undo.take().revert, third);
const retryable = undo.take();
assert.equal(retryable.revert, second);
assert.equal(retryable.roadMutation, true);
undo.restore(retryable);
assert.equal(undo.take(), retryable);

// Overlapping viewport reads apply only the newest response.
const requests = [];
globalThis.fetch = (path) => new Promise((resolve) => requests.push({ path, resolve }));
const featureCount = { textContent: '' };
const map = {
  getZoom: () => 18,
  getBounds: () => ({
    getWest: () => 71.0,
    getSouth: () => 40.0,
    getEast: () => 72.0,
    getNorth: () => 41.0,
  }),
};
const editorData = new EditorData({ map, featureCount });
const oldRefresh = editorData.refresh({ fullBase: true, totalFeatureCount: 10 });
const newRefresh = editorData.refresh({ fullBase: true, totalFeatureCount: 10 });
assert.equal(requests.length, 2);
requests[1].resolve({
  ok: true,
  json: async () => ({
    type: 'FeatureCollection',
    features: [{
      id: 2,
      geometry: { type: 'Point', coordinates: [72, 41] },
      properties: { feature_type: 'point' },
    }],
  }),
});
assert.equal((await newRefresh).visible[0].id, 2);
requests[0].resolve({
  ok: true,
  json: async () => ({
    type: 'FeatureCollection',
    features: [{
      id: 1,
      geometry: { type: 'Point', coordinates: [71, 40] },
      properties: { feature_type: 'point' },
    }],
  }),
});
assert.equal(await oldRefresh, null);

const mutationCalls = [];
globalThis.fetch = async (path, options) => {
  mutationCalls.push({ path, options });
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({}),
  };
};
const updatedAt = '2026-07-23T10:00:00+00:00';
await featuresApi.update(
  7,
  { name: 'Concurrency-safe edit' },
  { expectedUpdatedAt: updatedAt },
);
assert.equal(mutationCalls[0].options.headers['If-Match'], `"${updatedAt}"`);
assert.throws(
  () => featuresApi.update(7, { name: 'Blind overwrite' }),
  /feature version is required/i,
);

console.log('Feature payload, undo-state, and concurrency checks passed');
