// Alt/Option-drag bending for a selected road. The gesture owns only pointer
// handling and geometry preview; persistence, snapping, and draft history stay
// with MapEditor so one drag remains one undoable road edit.

const DEFAULT_HIT_TOLERANCE = 12;
const DEFAULT_VERTEX_TOLERANCE = 6;
const DEFAULT_DRAG_THRESHOLD = 3;

function cloneGeometry(geometry) {
  return geometry ? structuredClone(geometry) : null;
}

function pixelPoint(value) {
  if (Array.isArray(value)) return { x: value[0], y: value[1] };
  return { x: value?.x, y: value?.y };
}

function coordinate(value) {
  const lng = Array.isArray(value) ? value[0] : value?.lng;
  const lat = Array.isArray(value) ? value[1] : value?.lat;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [Number(lng.toFixed(9)), Number(lat.toFixed(9))];
}

function closestPixelPoint(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const closest = {
    x: start.x + fraction * dx,
    y: start.y + fraction * dy,
  };
  const distanceX = point.x - closest.x;
  const distanceY = point.y - closest.y;
  return {
    closest,
    fraction,
    distanceSquared: distanceX * distanceX + distanceY * distanceY,
  };
}

function interpolatedCoordinate(start, end, fraction) {
  return coordinate([
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ]);
}

export function moveRoadBendVertex(geometry, vertexIndex, nextCoordinate) {
  if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)
    || !Number.isInteger(vertexIndex)
    || vertexIndex < 0 || vertexIndex >= geometry.coordinates.length) return null;
  const next = coordinate(nextCoordinate);
  if (!next) return null;
  const coordinates = geometry.coordinates.map((position) => [...position]);
  coordinates[vertexIndex] = [...next, ...coordinates[vertexIndex].slice(2)];
  return { ...cloneGeometry(geometry), coordinates };
}

// Finds the selected road position under the pointer in rendered screen
// space. A nearby existing vertex is moved; otherwise one new vertex is
// inserted at the exact closest point on the displayed segment.
export function findRoadBendTarget(
  geometry,
  pointer,
  project,
  unproject,
  {
    hitTolerance = DEFAULT_HIT_TOLERANCE,
    vertexTolerance = DEFAULT_VERTEX_TOLERANCE,
  } = {},
) {
  if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)
    || geometry.coordinates.length < 2 || typeof project !== 'function') return null;
  const point = pixelPoint(pointer);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  const projected = geometry.coordinates.map((position) => pixelPoint(project(position)));
  if (projected.some((position) => !Number.isFinite(position.x) || !Number.isFinite(position.y))) {
    return null;
  }

  let closestVertex = null;
  for (let index = 0; index < projected.length; index += 1) {
    const dx = point.x - projected[index].x;
    const dy = point.y - projected[index].y;
    const distanceSquared = dx * dx + dy * dy;
    if (!closestVertex || distanceSquared < closestVertex.distanceSquared) {
      closestVertex = { index, distanceSquared };
    }
  }
  if (closestVertex && closestVertex.distanceSquared <= vertexTolerance * vertexTolerance) {
    return {
      geometry: cloneGeometry(geometry),
      vertexIndex: closestVertex.index,
      inserted: false,
      distancePixels: Math.sqrt(closestVertex.distanceSquared),
    };
  }

  let best = null;
  for (let index = 0; index < projected.length - 1; index += 1) {
    const candidate = closestPixelPoint(point, projected[index], projected[index + 1]);
    if (!best || candidate.distanceSquared < best.distanceSquared) {
      best = { ...candidate, segmentIndex: index };
    }
  }
  if (!best || best.distanceSquared > hitTolerance * hitTolerance) return null;

  const projectedCoordinate = typeof unproject === 'function'
    ? coordinate(unproject(best.closest))
    : interpolatedCoordinate(
      geometry.coordinates[best.segmentIndex],
      geometry.coordinates[best.segmentIndex + 1],
      best.fraction,
    );
  if (!projectedCoordinate) return null;
  const coordinates = geometry.coordinates.map((position) => [...position]);
  coordinates.splice(best.segmentIndex + 1, 0, projectedCoordinate);
  return {
    geometry: { ...cloneGeometry(geometry), coordinates },
    vertexIndex: best.segmentIndex + 1,
    inserted: true,
    distancePixels: Math.sqrt(best.distanceSquared),
  };
}

function stopEvent(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

export class RoadBendGesture {
  constructor({
    map,
    getRoad,
    onPreview,
    onCommit,
    onCancel,
    hitTolerance = DEFAULT_HIT_TOLERANCE,
    vertexTolerance = DEFAULT_VERTEX_TOLERANCE,
    dragThreshold = DEFAULT_DRAG_THRESHOLD,
  }) {
    this.map = map;
    this.canvas = map.getCanvas();
    this.getRoad = getRoad;
    this.onPreview = onPreview;
    this.onCommit = onCommit;
    this.onCancel = onCancel;
    this.hitTolerance = hitTolerance;
    this.vertexTolerance = vertexTolerance;
    this.dragThreshold = dragThreshold;
    this.active = null;
    this.suppressClick = false;
    this.suppressClickTimer = null;
    this.boundMouseDown = (event) => this.handleMouseDown(event);
    this.boundMouseMove = (event) => this.handleMouseMove(event);
    this.boundMouseUp = (event) => this.handleMouseUp(event);
  }

  bind() {
    // Capture runs before MapLibre/Terra Draw's drag handlers. Ordinary drags
    // are untouched because only Alt/Option + primary-button is intercepted.
    this.canvas.addEventListener('mousedown', this.boundMouseDown, true);
  }

  destroy() {
    this.cancel({ restore: false });
    this.canvas.removeEventListener('mousedown', this.boundMouseDown, true);
    clearTimeout(this.suppressClickTimer);
  }

  isActive() {
    return Boolean(this.active);
  }

  consumeMapClick() {
    if (!this.suppressClick) return false;
    this.suppressClick = false;
    clearTimeout(this.suppressClickTimer);
    return true;
  }

  canvasPoint(event) {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  handleMouseDown(event) {
    if (event.button !== 0 || !event.altKey || this.active) return;
    const road = this.getRoad?.();
    if (!road?.geometry || road.drawId === undefined || road.drawId === null) return;
    const point = this.canvasPoint(event);
    const target = findRoadBendTarget(
      road.geometry,
      point,
      (position) => this.map.project(position),
      (pixel) => this.map.unproject(pixel),
      { hitTolerance: this.hitTolerance, vertexTolerance: this.vertexTolerance },
    );
    if (!target) return;

    stopEvent(event);
    const dragPanEnabled = Boolean(this.map.dragPan?.isEnabled?.());
    if (dragPanEnabled) this.map.dragPan.disable();
    this.canvas.classList.add('road-bending-active');
    this.active = {
      drawId: road.drawId,
      originalGeometry: cloneGeometry(road.geometry),
      bendGeometry: target.geometry,
      geometry: target.geometry,
      vertexIndex: target.vertexIndex,
      inserted: target.inserted,
      startPoint: point,
      moved: false,
      dragPanEnabled,
    };
    window.addEventListener('mousemove', this.boundMouseMove, true);
    window.addEventListener('mouseup', this.boundMouseUp, true);
  }

  geometryAtEvent(event) {
    const nextCoordinate = coordinate(this.map.unproject(this.canvasPoint(event)));
    return moveRoadBendVertex(
      this.active.bendGeometry,
      this.active.vertexIndex,
      nextCoordinate,
    );
  }

  handleMouseMove(event) {
    if (!this.active) return;
    stopEvent(event);
    const point = this.canvasPoint(event);
    if (!this.active.moved) {
      const dx = point.x - this.active.startPoint.x;
      const dy = point.y - this.active.startPoint.y;
      if (dx * dx + dy * dy < this.dragThreshold * this.dragThreshold) return;
      this.active.moved = true;
    }
    const geometry = this.geometryAtEvent(event);
    if (!geometry) return;
    this.active.geometry = geometry;
    this.onPreview?.({
      drawId: this.active.drawId,
      geometry: cloneGeometry(geometry),
      vertexIndex: this.active.vertexIndex,
      inserted: this.active.inserted,
    });
  }

  handleMouseUp(event) {
    if (!this.active) return;
    stopEvent(event);
    if (this.active.moved) {
      const geometry = this.geometryAtEvent(event);
      if (geometry) {
        this.active.geometry = geometry;
        this.onPreview?.({
          drawId: this.active.drawId,
          geometry: cloneGeometry(geometry),
          vertexIndex: this.active.vertexIndex,
          inserted: this.active.inserted,
        });
      }
    }
    const completed = this.active;
    this.finishInteraction();
    this.armClickSuppression();
    if (completed.moved) {
      this.onCommit?.({
        drawId: completed.drawId,
        geometry: cloneGeometry(completed.geometry),
        originalGeometry: cloneGeometry(completed.originalGeometry),
        vertexIndex: completed.vertexIndex,
        inserted: completed.inserted,
      });
    }
  }

  armClickSuppression() {
    this.suppressClick = true;
    clearTimeout(this.suppressClickTimer);
    this.suppressClickTimer = setTimeout(() => { this.suppressClick = false; }, 250);
  }

  finishInteraction() {
    const active = this.active;
    this.active = null;
    window.removeEventListener('mousemove', this.boundMouseMove, true);
    window.removeEventListener('mouseup', this.boundMouseUp, true);
    this.canvas.classList.remove('road-bending-active');
    if (active?.dragPanEnabled) this.map.dragPan.enable();
  }

  cancel({ restore = true } = {}) {
    if (!this.active) return false;
    const cancelled = this.active;
    this.finishInteraction();
    if (restore && cancelled.moved) {
      this.onCancel?.({
        drawId: cancelled.drawId,
        geometry: cloneGeometry(cancelled.originalGeometry),
      });
    }
    return true;
  }
}
