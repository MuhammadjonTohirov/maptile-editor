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
