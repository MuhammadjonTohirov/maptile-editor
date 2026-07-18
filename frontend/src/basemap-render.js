// Renders editor features as a finished basemap: the shared style paints them
// in editing colors, but the client view and the editor's full-base mode both
// want the basemap palette (rule X3/DRY — one place, two callers).
//
// Fills, lines, casing, and road labels come from the editor vector tiles, so
// they scale to a country-sized dataset. Icons and point labels come from the
// tiles too (addTileSymbolLayers), never from the per-feature GeoJSON anchor
// source, which is only viable for the small-data overlay.
import { BASE_DETAIL_LAYERS, IMPORT_LAYERS, setLayerVisibility } from './layers.js';
import { EMOJI_IMAGE_PREFIX } from './emoji-icons.js';

export const EDITOR_3D_LAYER = 'editor-basemap-3d';
const CASING_LAYER = 'editor-basemap-casing';

const ROAD_COLOR = ['match', ['coalesce', ['get', 'road_type'], ''],
  'motorway', '#ee9b77',
  'trunk', '#f1b184',
  'primary', '#f7cf9e',
  'secondary', '#f7e6a8',
  '#ffffff'];
const LINE_COLOR = ['match', ['coalesce', ['get', 'feature_type'], ''], 'waterway', '#8fc8e5', ROAD_COLOR];

// Widths per road class at zooms 5 / 14 / 18 / 20, mirroring the basemap's
// transportation layer. Stops continue past z14 (the base tiles' maxzoom) at
// an exponential rate so zoomed-in roads approach plausible ground widths
// instead of freezing at a few pixels.
const ROAD_WIDTH_ZOOMS = [5, 14, 18, 20];
const ROAD_WIDTH_CLASSES = [
  [['motorway', 'motorway_link'], [1.2, 7, 24, 48]],
  [['trunk', 'trunk_link'], [1, 5.8, 20, 40]],
  [['primary', 'primary_link'], [0.9, 5, 17, 34]],
  [['secondary', 'secondary_link'], [0.7, 3.7, 13, 26]],
  [['tertiary', 'tertiary_link'], [0.6, 3, 11, 22]],
  [['residential', 'unclassified', 'living_street', 'pedestrian'], [0.5, 2.4, 10, 20]],
  [['footway', 'path', 'steps', 'cycleway', 'track'], [0.3, 1, 3, 6]],
];
const ROAD_FALLBACK_WIDTHS = [0.45, 1.6, 7, 14];
const GENERIC_LINE_WIDTHS = [0.6, 3, 5, 8];

const roadWidthAt = (stop, scale = 1) => ['match', ['coalesce', ['get', 'road_type'], ''],
  ...ROAD_WIDTH_CLASSES.flatMap(([types, stops]) => [types, stops[stop] * scale]),
  ROAD_FALLBACK_WIDTHS[stop] * scale];

const zoomWidths = (widthAt) => ['interpolate', ['exponential', 1.5], ['zoom'],
  ...ROAD_WIDTH_ZOOMS.flatMap((zoom, stop) => [zoom, widthAt(stop)])];

const LINE_WIDTH = zoomWidths((stop) => ['match', ['coalesce', ['get', 'feature_type'], ''],
  'road', roadWidthAt(stop),
  GENERIC_LINE_WIDTHS[stop]]);
const ROAD_CASING_WIDTH = zoomWidths((stop) => roadWidthAt(stop, 1.35));

// Higher-class roads sort above lower ones at crossings; the style's road
// layers carry the same ordering for their own features.
const ROAD_SORT_KEY = ['match', ['coalesce', ['get', 'road_type'], ''],
  ['motorway', 'motorway_link'], 10,
  ['trunk', 'trunk_link'], 9,
  ['primary', 'primary_link'], 8,
  ['secondary', 'secondary_link'], 7,
  ['tertiary', 'tertiary_link'], 6,
  ['residential', 'unclassified', 'living_street', 'pedestrian'], 5,
  ['footway', 'path', 'steps', 'cycleway', 'track'], 2,
  4];
const FILL_COLOR = ['match', ['coalesce', ['get', 'feature_type'], ''], 'landuse', '#f3f0ea', '#dcd6cf'];

function setPaint(map, layerId, properties) {
  if (!map.getLayer(layerId)) return;
  for (const [name, value] of Object.entries(properties)) {
    map.setPaintProperty(layerId, name, value);
  }
}

// Hide the base OSM detail and repaint the editor vector layers as a basemap.
// Adds the road casing and 3D building layers once (idempotent on re-call).
export function paintEditorAsBasemap(map) {
  setLayerVisibility(map, BASE_DETAIL_LAYERS, false);
  setLayerVisibility(map, IMPORT_LAYERS, true);
  if (!map.getLayer(EDITOR_3D_LAYER)) {
    map.addLayer({
      id: EDITOR_3D_LAYER,
      type: 'fill-extrusion',
      source: 'editor',
      'source-layer': 'features',
      filter: ['all',
        ['==', ['geometry-type'], 'Polygon'],
        ['==', ['get', 'feature_type'], 'building'],
        ['match', ['get', 'source_kind'], ['manual', 'osm_import'], true, false],
      ],
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': '#d5cec6',
        'fill-extrusion-height': ['coalesce', ['get', 'height_m'], 8],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.82,
      },
    }, 'editor-import-icons');
  }
  if (!map.getLayer(CASING_LAYER)) {
    map.addLayer({
      id: CASING_LAYER,
      type: 'line',
      source: 'editor',
      'source-layer': 'features',
      filter: ['all',
        ['==', ['geometry-type'], 'LineString'],
        ['==', ['get', 'feature_type'], 'road'],
        ['!=', ['get', 'source_kind'], 'base_tombstone'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ROAD_SORT_KEY },
      paint: { 'line-color': '#c8c2b9', 'line-width': ROAD_CASING_WIDTH },
    }, 'editor-import-line');
  }
  for (const layerId of ['editor-manual-fill', 'editor-import-fill']) {
    setPaint(map, layerId, { 'fill-color': FILL_COLOR, 'fill-opacity': 0.9, 'fill-outline-color': '#c8c0b8' });
  }
  setPaint(map, 'editor-manual-outline', { 'line-color': '#c8c0b8', 'line-width': 1 });
  for (const layerId of ['editor-manual-lines', 'editor-import-line']) {
    setPaint(map, layerId, { 'line-color': LINE_COLOR, 'line-width': LINE_WIDTH });
  }
  for (const layerId of ['editor-manual-points', 'editor-import-point']) {
    setPaint(map, layerId, {
      'circle-color': '#66778b', 'circle-radius': 3,
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1,
    });
  }
  // Place names and admin boundaries come from the base tiles and sit below the
  // editor detail in the style, so the opaque building fills would draw over
  // them. Lift them above the editor detail (place labels topmost) so city
  // names stay legible.
  for (const layerId of ['boundaries', 'place-labels']) {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  }
}

// Icon and point-name layers driven straight from the editor tiles, so they
// carry no per-feature GeoJSON payload and scale to the whole country. The
// anchor-based icon/label layers are hidden while these are active. Returns
// the added layer ids so callers can wire hit-testing to them.
export const TILE_SYMBOL_LAYERS = ['editor-basemap-icons', 'editor-basemap-point-labels'];
const ANCHOR_SYMBOL_LAYERS = [
  'editor-import-icons', 'editor-import-labels',
  'editor-manual-icons', 'editor-manual-labels',
];

export function addTileSymbolLayers(map) {
  setLayerVisibility(map, ANCHOR_SYMBOL_LAYERS, false);
  // Insert below the base place labels so city names keep priority over the
  // editor's own icons and point labels.
  const beforeId = map.getLayer('place-labels') ? 'place-labels' : undefined;
  if (!map.getLayer('editor-basemap-icons')) {
    map.addLayer({
      id: 'editor-basemap-icons',
      type: 'symbol',
      source: 'editor',
      'source-layer': 'features',
      minzoom: 15,
      filter: ['all',
        ['!=', ['coalesce', ['get', 'icon'], ''], ''],
        ['!=', ['get', 'source_kind'], 'base_tombstone'],
      ],
      layout: {
        'icon-image': ['concat', EMOJI_IMAGE_PREFIX, ['get', 'icon']],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.5, 17, 0.75],
        'icon-allow-overlap': false,
      },
    }, beforeId);
  }
  if (!map.getLayer('editor-basemap-point-labels')) {
    map.addLayer({
      id: 'editor-basemap-point-labels',
      type: 'symbol',
      source: 'editor',
      'source-layer': 'features',
      minzoom: 15,
      filter: ['all',
        ['==', ['geometry-type'], 'Point'],
        ['!=', ['coalesce', ['get', 'name'], ''], ''],
        ['!=', ['get', 'source_kind'], 'base_tombstone'],
      ],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['sans-serif'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: { 'text-color': '#4a5568', 'text-halo-color': '#ffffff', 'text-halo-width': 1 },
    }, beforeId);
  }
}
