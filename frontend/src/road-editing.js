// Focused road drawing/editing state and geometry rules (architecture F1).
export const ROAD_SNAP_METRES = 8;
export const ROAD_SNAP_DEGREES = ROAD_SNAP_METRES / 111_320;

function cloneGeometry(geometry) {
  return geometry ? structuredClone(geometry) : null;
}

export function validateRoadLineString(geometry) {
  if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) {
    return { valid: false, reason: 'roadGeometryLineString' };
  }
  if (geometry.coordinates.length < 2) {
    return { valid: false, reason: 'roadGeometryTooShort' };
  }
  let hasLength = false;
  for (let index = 0; index < geometry.coordinates.length; index += 1) {
    const position = geometry.coordinates[index];
    if (!Array.isArray(position) || position.length < 2
      || !Number.isFinite(position[0]) || !Number.isFinite(position[1])
      || position[0] < -180 || position[0] > 180
      || position[1] < -90 || position[1] > 90) {
      return { valid: false, reason: 'roadGeometryInvalid' };
    }
    if (index === 0) continue;
    const previous = geometry.coordinates[index - 1];
    if (position[0] === previous[0] && position[1] === previous[1]) {
      return { valid: false, reason: 'roadGeometryDuplicatePoint' };
    }
    if (position[0] !== previous[0] || position[1] !== previous[1]) hasLength = true;
  }
  return hasLength
    ? { valid: true }
    : { valid: false, reason: 'roadGeometryZeroLength' };
}

export function snapRoadEndpoints(
  geometry,
  segmentIndex,
  excludedOwner,
  threshold = ROAD_SNAP_DEGREES,
) {
  if (geometry?.type !== 'LineString' || geometry.coordinates.length < 2) return cloneGeometry(geometry);
  const coordinates = geometry.coordinates.map((position) => [...position]);
  for (const index of [0, coordinates.length - 1]) {
    const position = coordinates[index];
    const target = segmentIndex.nearestCoordinate(
      position[0], position[1], threshold, excludedOwner,
    );
    if (target) coordinates[index] = [...target];
  }
  return { type: 'LineString', coordinates };
}

// Terra Draw supplies the coordinate being dragged. Existing roads snap only
// their endpoints; interior vertices remain freely shapeable.
export function canSnapRoadCoordinate(context, editingExistingRoad) {
  if (!editingExistingRoad) return true;
  const geometry = context?.getCurrentGeometrySnapshot?.();
  const index = context?.currentCoordinate;
  if (geometry?.type !== 'LineString' || !Number.isInteger(index)) return false;
  return index === 0 || index === geometry.coordinates.length - 1;
}

export class RoadEditSession {
  constructor() {
    this.session = null;
    this.savedDrawIds = new Set();
  }

  begin(serverId, geometry) {
    this.session = {
      serverId: String(serverId),
      original: cloneGeometry(geometry),
      draft: cloneGeometry(geometry),
      dirty: false,
      history: [],
    };
  }

  isEditing(serverId) {
    return Boolean(this.session && this.session.serverId === String(serverId));
  }

  stage(geometry) {
    if (!this.session) return;
    if (JSON.stringify(this.session.draft) === JSON.stringify(geometry)) return;
    this.session.history.push(cloneGeometry(this.session.draft));
    this.session.draft = cloneGeometry(geometry);
    this.session.dirty = JSON.stringify(this.session.draft) !== JSON.stringify(this.session.original);
  }

  geometry(serverId) {
    return this.isEditing(serverId) ? cloneGeometry(this.session.draft) : null;
  }

  original(serverId) {
    return this.isEditing(serverId) ? cloneGeometry(this.session.original) : null;
  }

  isDirty(serverId) {
    return this.isEditing(serverId) && this.session.dirty;
  }

  undoDraft(serverId) {
    if (!this.isEditing(serverId) || !this.session.history.length) return null;
    this.session.draft = this.session.history.pop();
    this.session.dirty = JSON.stringify(this.session.draft) !== JSON.stringify(this.session.original);
    return cloneGeometry(this.session.draft);
  }

  cancel() {
    const original = cloneGeometry(this.session?.original);
    this.session = null;
    return original;
  }

  clear() {
    this.session = null;
  }

  claimNewDraw(drawId) {
    const key = String(drawId);
    if (this.savedDrawIds.has(key)) return false;
    this.savedDrawIds.add(key);
    if (this.savedDrawIds.size > 100) {
      this.savedDrawIds.delete(this.savedDrawIds.values().next().value);
    }
    return true;
  }

  releaseNewDraw(drawId) {
    this.savedDrawIds.delete(String(drawId));
  }
}
