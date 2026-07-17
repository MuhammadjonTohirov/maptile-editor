// MapLibre cannot render emoji through its glyph pipeline, so style layers
// reference them as `emoji:<char>` images and each one is drawn onto a canvas
// the first time the renderer requests it.
const EMOJI_IMAGE_PREFIX = 'emoji:';

// Tiled geometry is clipped per tile, and a symbol layer on it places one
// symbol per fragment. Icons and name labels therefore render from a
// client-side GeoJSON source holding exactly one anchor point per feature.
export function featureAnchors(features) {
  const points = [];
  for (const feature of features) {
    const properties = feature.properties || {};
    if (properties.source_kind === 'base_tombstone') continue;
    // Line features (streets, waterways) label along their tiled geometry
    // (the *-line-labels layers); their anchor carries only the icon.
    const name = feature.geometry?.type === 'LineString' ? '' : (properties.name || '');
    if (!properties.icon && !name) continue;
    const anchor = iconAnchor(feature.geometry);
    if (!anchor) continue;
    points.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: anchor },
      properties: {
        id: feature.id,
        icon: properties.icon || '',
        name,
        source_kind: properties.source_kind,
      },
    });
  }
  return { type: 'FeatureCollection', features: points };
}

function iconAnchor(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates;
  if (geometry.type === 'Polygon') return ringCentroid(geometry.coordinates[0]);
  if (geometry.type === 'LineString') return geometry.coordinates[Math.floor(geometry.coordinates.length / 2)];
  return null;
}

function ringCentroid(ring) {
  const isClosed = ring.length > 1
    && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1];
  const points = isClosed ? ring.slice(0, -1) : ring;
  let lng = 0;
  let lat = 0;
  for (const point of points) {
    lng += point[0];
    lat += point[1];
  }
  return [lng / points.length, lat / points.length];
}

export function enableEmojiIcons(map) {
  map.on('styleimagemissing', (event) => {
    if (!event.id.startsWith(EMOJI_IMAGE_PREFIX)) return;
    const emoji = event.id.slice(EMOJI_IMAGE_PREFIX.length);
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.font = `${size - 12}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(emoji, size / 2, size / 2 + 4);
    map.addImage(event.id, context.getImageData(0, 0, size, size), { pixelRatio: 2 });
  });
}
