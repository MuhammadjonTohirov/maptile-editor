import assert from 'node:assert/strict';

import {
  findRoadBendTarget,
  moveRoadBendVertex,
  RoadBendGesture,
} from '../frontend/src/road-bending.js';

const project = ([x, y]) => ({ x: x * 10, y: y * 10 });
const unproject = ({ x, y }) => ({ lng: x / 10, lat: y / 10 });
const geometry = {
  type: 'LineString',
  coordinates: [[0, 0], [10, 0]],
};

// Alt/Option-drag can start at an arbitrary rendered point, inserting exactly
// one vertex at the closest point on that road segment.
const inserted = findRoadBendTarget(
  geometry,
  { x: 25, y: 4 },
  project,
  unproject,
  { hitTolerance: 12, vertexTolerance: 6 },
);
assert.equal(inserted.inserted, true);
assert.equal(inserted.vertexIndex, 1);
assert.deepEqual(inserted.geometry.coordinates, [[0, 0], [2.5, 0], [10, 0]]);
assert.deepEqual(geometry.coordinates, [[0, 0], [10, 0]]);

// Dragging bends the inserted position without mutating the preview baseline.
const moved = moveRoadBendVertex(inserted.geometry, inserted.vertexIndex, [2.5, 3]);
assert.deepEqual(moved.coordinates, [[0, 0], [2.5, 3], [10, 0]]);
assert.deepEqual(inserted.geometry.coordinates, [[0, 0], [2.5, 0], [10, 0]]);

// Starting near an existing vertex moves that vertex rather than creating a
// duplicate consecutive point.
const shaped = {
  type: 'LineString',
  coordinates: [[0, 0], [5, 0], [10, 0]],
};
const existing = findRoadBendTarget(
  shaped,
  { x: 53, y: 2 },
  project,
  unproject,
  { hitTolerance: 12, vertexTolerance: 6 },
);
assert.equal(existing.inserted, false);
assert.equal(existing.vertexIndex, 1);
assert.deepEqual(existing.geometry, shaped);

// The nearest segment determines the insertion index on a multi-segment road.
const corner = {
  type: 'LineString',
  coordinates: [[0, 0], [10, 0], [10, 10]],
};
const vertical = findRoadBendTarget(
  corner,
  { x: 96, y: 35 },
  project,
  unproject,
  { hitTolerance: 12, vertexTolerance: 6 },
);
assert.equal(vertical.vertexIndex, 2);
assert.deepEqual(vertical.geometry.coordinates, [[0, 0], [10, 0], [10, 3.5], [10, 10]]);

// A modifier-drag away from the selected road is left to normal map controls.
assert.equal(findRoadBendTarget(
  geometry,
  { x: 25, y: 20 },
  project,
  unproject,
  { hitTolerance: 12, vertexTolerance: 6 },
), null);

// The pointer controller previews continuously but commits a completed drag
// exactly once, so MapEditor's RoadEditSession receives one undo operation.
const windowListeners = new Map();
globalThis.window = {
  addEventListener: (type, listener) => windowListeners.set(type, listener),
  removeEventListener: (type, listener) => {
    if (windowListeners.get(type) === listener) windowListeners.delete(type);
  },
};
const canvasListeners = new Map();
const canvasClasses = new Set();
const canvas = {
  addEventListener: (type, listener) => canvasListeners.set(type, listener),
  removeEventListener: (type, listener) => {
    if (canvasListeners.get(type) === listener) canvasListeners.delete(type);
  },
  getBoundingClientRect: () => ({ left: 0, top: 0 }),
  classList: {
    add: (name) => canvasClasses.add(name),
    remove: (name) => canvasClasses.delete(name),
  },
};
let dragPanEnabled = true;
const map = {
  getCanvas: () => canvas,
  project: ([x, y]) => ({ x, y }),
  unproject: ({ x, y }) => ({ lng: x, lat: y }),
  dragPan: {
    isEnabled: () => dragPanEnabled,
    disable: () => { dragPanEnabled = false; },
    enable: () => { dragPanEnabled = true; },
  },
};
const pointerEvent = (x, y, altKey = true) => ({
  button: 0,
  altKey,
  clientX: x,
  clientY: y,
  preventDefault() {},
  stopPropagation() {},
  stopImmediatePropagation() {},
});
const previews = [];
const commits = [];
const gesture = new RoadBendGesture({
  map,
  getRoad: () => ({ drawId: 'draw-road', geometry }),
  onPreview: (change) => previews.push(change),
  onCommit: (change) => commits.push(change),
  vertexTolerance: 1,
});
gesture.bind();
gesture.handleMouseDown(pointerEvent(5, 1, false));
assert.equal(gesture.isActive(), false);
gesture.handleMouseDown(pointerEvent(5, 1));
assert.equal(gesture.isActive(), true);
assert.equal(dragPanEnabled, false);
gesture.handleMouseMove(pointerEvent(5, 3));
assert.equal(previews.length, 0);
gesture.handleMouseMove(pointerEvent(5, 20));
gesture.handleMouseUp(pointerEvent(5, 20));
assert.equal(commits.length, 1);
assert.equal(previews.length, 2);
assert.deepEqual(commits[0].geometry.coordinates, [[0, 0], [5, 20], [10, 0]]);
assert.equal(commits[0].inserted, true);
assert.equal(dragPanEnabled, true);
assert.equal(gesture.consumeMapClick(), true);
assert.equal(gesture.consumeMapClick(), false);
gesture.destroy();

console.log('Road bend gesture checks passed');
