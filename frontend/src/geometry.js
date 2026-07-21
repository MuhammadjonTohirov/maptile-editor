// Pure geometry helpers shared by the editor (rule F1).

// Terra Draw validates against its store precision and rejects coordinates
// with more decimals, which is what raw vector-tile geometry always carries.
const COORDINATE_PRECISION = 9;

function eachPosition(coordinates, visit) {
  if (typeof coordinates[0] === 'number') {
    visit(coordinates);
    return;
  }
  for (const nested of coordinates) eachPosition(nested, visit);
}

export function collectVertices(features) {
  const vertices = [];
  for (const feature of features) {
    if (feature.geometry?.coordinates) eachPosition(feature.geometry.coordinates, (p) => vertices.push(p));
  }
  return vertices;
}

function coordinateKey([lng, lat]) {
  return `${lng},${lat}`;
}

function closestPointOnSegment([lng, lat], [aLng, aLat], [bLng, bLat]) {
  const scale = Math.cos((lat * Math.PI) / 180);
  const px = lng * scale;
  const ax = aLng * scale;
  const bx = bLng * scale;
  const abX = bx - ax;
  const abY = bLat - aLat;
  const lengthSquared = abX * abX + abY * abY;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((px - ax) * abX + (lat - aLat) * abY) / lengthSquared))
    : 0;
  const coordinate = [aLng + (bLng - aLng) * t, aLat + (bLat - aLat) * t];
  const dLng = (coordinate[0] - lng) * scale;
  const dLat = coordinate[1] - lat;
  return { coordinate, distanceSquared: dLng * dLng + dLat * dLat };
}

export function collectRoadSegments(features) {
  return features
    .filter((feature) => feature.properties?.feature_type === 'road' && feature.geometry?.type === 'LineString')
    .flatMap((feature) => feature.geometry.coordinates.slice(1).map((position, index) => ({
      owner: String(feature.id),
      a: feature.geometry.coordinates[index],
      b: position,
      west: Math.min(feature.geometry.coordinates[index][0], position[0]),
      south: Math.min(feature.geometry.coordinates[index][1], position[1]),
      east: Math.max(feature.geometry.coordinates[index][0], position[0]),
      north: Math.max(feature.geometry.coordinates[index][1], position[1]),
    })));
}

// Mousemove snapping and endpoint connectivity both ask for segments close to
// one point. A small grid avoids rescanning every road segment on every frame.
export class RoadSegmentIndex {
  constructor(segments = [], cellSize = 0.0005) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.longSegments = [];
    for (const segment of segments) this.add(segment);
  }

  static fromFeatures(features) {
    return new RoadSegmentIndex(collectRoadSegments(features));
  }

  cell(value) {
    return Math.floor(value / this.cellSize);
  }

  key(x, y) {
    return `${x}:${y}`;
  }

  add(segment) {
    const west = this.cell(segment.west);
    const east = this.cell(segment.east);
    const south = this.cell(segment.south);
    const north = this.cell(segment.north);
    const cellCount = (east - west + 1) * (north - south + 1);
    if (cellCount > 200) {
      this.longSegments.push(segment);
      return;
    }
    for (let x = west; x <= east; x += 1) {
      for (let y = south; y <= north; y += 1) {
        const key = this.key(x, y);
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(segment);
      }
    }
  }

  candidates(lng, lat, threshold) {
    const found = new Set(this.longSegments);
    const longitudeThreshold = threshold / Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
    for (let x = this.cell(lng - longitudeThreshold); x <= this.cell(lng + longitudeThreshold); x += 1) {
      for (let y = this.cell(lat - threshold); y <= this.cell(lat + threshold); y += 1) {
        for (const segment of this.cells.get(this.key(x, y)) || []) found.add(segment);
      }
    }
    return found;
  }

  nearest(lng, lat, threshold, excludedOwner) {
    let best;
    let bestDistance = threshold * threshold;
    for (const segment of this.candidates(lng, lat, threshold)) {
      if (excludedOwner && segment.owner === String(excludedOwner)) continue;
      const candidate = closestPointOnSegment([lng, lat], segment.a, segment.b);
      if (candidate.distanceSquared < bestDistance) {
        bestDistance = candidate.distanceSquared;
        best = { ...candidate, segment };
      }
    }
    return best;
  }

  nearestCoordinate(lng, lat, threshold, excludedOwner) {
    return this.nearest(lng, lat, threshold, excludedOwner)?.coordinate;
  }

  hasOtherRoadAt(position, owner, threshold) {
    return Boolean(this.nearest(position[0], position[1], threshold, owner));
  }
}

export function roadConnectivity(roadFeatures, segmentIndex = RoadSegmentIndex.fromFeatures(roadFeatures)) {
  const lines = roadFeatures.filter((feature) => feature.geometry?.type === 'LineString');
  const owners = new Map();
  for (const feature of lines) {
    const id = String(feature.id);
    for (const position of feature.geometry.coordinates) {
      const key = coordinateKey(position);
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(id);
    }
  }
  return lines.flatMap((feature) => {
    const coordinates = feature.geometry.coordinates;
    const ends = coordinates.length > 1
      ? [coordinates[0], coordinates[coordinates.length - 1]]
      : [coordinates[0]];
    return ends.map((position) => {
      const exactConnection = owners.get(coordinateKey(position)).size > 1;
      // Manual road endpoints may join the middle of an existing segment. The
      // topology builder nodes that host segment locally, so the overlay must
      // recognize the same connection even though the stored host line has no
      // explicit vertex there. Half a metre covers coordinate rounding only;
      // visible snapping itself uses the stricter zoom-aware threshold below.
      const segmentConnection = !exactConnection
        && segmentIndex.hasOtherRoadAt(position, feature.id, 0.5 / 111_320);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: position },
        properties: { connected: exactConnection || segmentConnection, road_id: String(feature.id) },
      };
    });
  });
}

export function offsetGeometry(geometry, delta = 0.00018) {
  const shift = (coordinates) => (typeof coordinates[0] === 'number'
    ? [coordinates[0] + delta, coordinates[1] + delta]
    : coordinates.map(shift));
  return { type: geometry.type, coordinates: shift(geometry.coordinates) };
}

export function geometryBounds(geometry) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  eachPosition(geometry.coordinates, ([lng, lat]) => {
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  });
  return [[west, south], [east, north]];
}

function roundCoordinates(value) {
  if (Array.isArray(value)) return value.map(roundCoordinates);
  return Number(value.toFixed(COORDINATE_PRECISION));
}

function averageLat(points) {
  return points.reduce((sum, [, lat]) => sum + lat, 0) / points.length;
}

// Longitude degrees shrink toward the poles; this keeps the ops below acting
// on roughly-Cartesian meters instead of distorting east-west distances
// (same correction the editor snapping code uses in main.js).
function toXY(points, originLat) {
  const scale = Math.cos((originLat * Math.PI) / 180);
  return points.map(([lng, lat]) => [lng * scale, lat]);
}

function toLngLat(points, originLat) {
  const scale = Math.cos((originLat * Math.PI) / 180);
  return points.map(([x, y]) => [x / scale, y]);
}

function centroid(points) {
  const [sx, sy] = points.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
  return [sx / points.length, sy / points.length];
}

// Circular mean of each edge's direction folded into a 90° wedge, weighted by
// edge length, so a building's own orientation is found even when it isn't
// aligned to true north.
function dominantAngle(ring) {
  const n = ring.length;
  let sinSum = 0;
  let cosSum = 0;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (!length) continue;
    const folded = Math.atan2(y2 - y1, x2 - x1) * 4;
    sinSum += Math.sin(folded) * length;
    cosSum += Math.cos(folded) * length;
  }
  return sinSum || cosSum ? Math.atan2(sinSum, cosSum) / 4 : 0;
}

// Replaces the ring with points evenly spaced on the circle fit to its
// centroid and average radius (RapiD/iD's "Circularise").
export function circularise(geometry) {
  if (geometry.type !== 'Polygon') return null;
  const ring = geometry.coordinates[0].slice(0, -1);
  if (ring.length < 3) return null;
  const originLat = averageLat(ring);
  const xy = toXY(ring, originLat);
  const [cx, cy] = centroid(xy);
  const radius = xy.reduce((sum, [x, y]) => sum + Math.hypot(x - cx, y - cy), 0) / xy.length;
  const startAngle = Math.atan2(xy[0][1] - cy, xy[0][0] - cx);
  const count = Math.max(ring.length, 24);
  const circle = Array.from({ length: count }, (_, i) => {
    const angle = startAngle + (i / count) * 2 * Math.PI;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
  const points = toLngLat(circle, originLat);
  points.push(points[0]);
  return { type: 'Polygon', coordinates: [roundCoordinates(points)] };
}

// Squares a polygon's corners toward 90°/180° (RapiD/iD's "Orthogonalize"):
// rotate to the shape's own dominant angle, snap each edge to horizontal or
// vertical, then let each vertex take its shared coordinate from the two
// edges that meet there.
export function orthogonalize(geometry) {
  if (geometry.type !== 'Polygon') return null;
  const ring = geometry.coordinates[0].slice(0, -1);
  const n = ring.length;
  if (n < 4) return null;
  const originLat = averageLat(ring);
  const xy = toXY(ring, originLat);
  const theta = dominantAngle(xy);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const rotated = xy.map(([x, y]) => [x * cosT + y * sinT, -x * sinT + y * cosT]);

  const isHorizontal = rotated.map((point, i) => {
    const next = rotated[(i + 1) % n];
    return Math.abs(next[0] - point[0]) >= Math.abs(next[1] - point[1]);
  });
  const sum = rotated.map(() => [0, 0]);
  const count = rotated.map(() => [0, 0]);
  for (let i = 0; i < n; i += 1) {
    const a = i;
    const b = (i + 1) % n;
    const axis = isHorizontal[i] ? 1 : 0; // shared y for a horizontal edge, shared x for a vertical one
    const value = (rotated[a][axis] + rotated[b][axis]) / 2;
    sum[a][axis] += value; count[a][axis] += 1;
    sum[b][axis] += value; count[b][axis] += 1;
  }
  const squared = rotated.map((point, i) => [
    count[i][0] ? sum[i][0] / count[i][0] : point[0],
    count[i][1] ? sum[i][1] / count[i][1] : point[1],
  ]);
  const unrotated = squared.map(([x, y]) => [x * cosT - y * sinT, x * sinT + y * cosT]);
  const points = toLngLat(unrotated, originLat);
  points.push(points[0]);
  return { type: 'Polygon', coordinates: [roundCoordinates(points)] };
}

// Mirrors the geometry across the axis through its centroid, along its own
// long or short dimension (found the same way orthogonalize finds its
// dominant angle for a polygon; a line's axis is simply its own start→end
// direction).
function flip(geometry, mirrorLongAxis) {
  const isPolygon = geometry.type === 'Polygon';
  if (!isPolygon && geometry.type !== 'LineString') return null;
  const ring = isPolygon ? geometry.coordinates[0].slice(0, -1) : geometry.coordinates;
  if (ring.length < 2) return null;
  const originLat = averageLat(ring);
  const xy = toXY(ring, originLat);
  const [cx, cy] = centroid(xy);
  const theta = isPolygon
    ? dominantAngle(xy)
    : Math.atan2(xy[xy.length - 1][1] - xy[0][1], xy[xy.length - 1][0] - xy[0][0]);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const local = xy.map(([x, y]) => [(x - cx) * cosT + (y - cy) * sinT, -(x - cx) * sinT + (y - cy) * cosT]);
  const width = Math.max(...local.map(([x]) => x)) - Math.min(...local.map(([x]) => x));
  const height = Math.max(...local.map(([, y]) => y)) - Math.min(...local.map(([, y]) => y));
  const longIsX = width >= height;
  const mirrorY = mirrorLongAxis ? longIsX : !longIsX;
  const mirrored = local.map(([x, y]) => (mirrorY ? [x, -y] : [-x, y]));
  const world = mirrored.map(([x, y]) => [x * cosT - y * sinT + cx, x * sinT + y * cosT + cy]);
  const points = toLngLat(world, originLat);
  if (isPolygon) points.push(points[0]);
  return { type: geometry.type, coordinates: isPolygon ? [roundCoordinates(points)] : roundCoordinates(points) };
}

export function flipLong(geometry) { return flip(geometry, true); }
export function flipShort(geometry) { return flip(geometry, false); }

export function drawingModeForGeometry(geometry) {
  return {
    Point: 'point',
    LineString: 'linestring',
    Polygon: 'polygon',
  }[geometry.type];
}

// Tile geometry is clipped and quantized and may arrive as a single-part
// Multi*; the drawing tools only accept simple types at bounded precision
// (rule F4). Returns null when the geometry cannot be edited.
export function normalizeGeometry(geometry) {
  if (!geometry) return null;
  const singlePartType = {
    MultiPoint: 'Point',
    MultiLineString: 'LineString',
    MultiPolygon: 'Polygon',
  }[geometry.type];
  const type = singlePartType || geometry.type;
  const coordinates = singlePartType
    ? (geometry.coordinates.length === 1 ? geometry.coordinates[0] : null)
    : geometry.coordinates;
  if (!coordinates || !drawingModeForGeometry({ type })) return null;
  return { type, coordinates: roundCoordinates(coordinates) };
}
