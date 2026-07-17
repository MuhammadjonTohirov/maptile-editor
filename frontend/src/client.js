import maplibregl from 'maplibre-gl';
import { featuresApi } from './api.js';
import { enableEmojiIcons, featureAnchors } from './emoji-icons.js';
import { BASE_DETAIL_LAYERS, IMPORT_LAYERS, setLayerVisibility } from './layers.js';
import { createMap, addBaseControls } from './map-setup.js';
import { localizeDocument, t } from './strings.js';

localizeDocument();

const REFRESH_INTERVAL_MS = 15_000;

const map = createMap();

class ThreeDToggle {
  onAdd(mapInstance) {
    this.map = mapInstance;
    this.enabled = false;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.textContent = '3D';
    this.button.title = t('threeDToggleTitle');
    this.button.addEventListener('click', () => this.toggle());
    this.container.appendChild(this.button);
    return this.container;
  }

  toggle() {
    this.enabled = !this.enabled;
    this.button.style.fontWeight = this.enabled ? '700' : '400';
    setLayerVisibility(this.map, ['client-3d-buildings'], this.enabled);
    this.map.easeTo({ pitch: this.enabled ? 55 : 0, duration: 600 });
  }

  onRemove() {
    this.container.remove();
  }
}

addBaseControls(map);
map.addControl(new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
}), 'bottom-right');
map.addControl(new ThreeDToggle(), 'bottom-right');
enableEmojiIcons(map);

// The shared style paints editor features in editing colors. The client is a
// finished map (rule F8), so edits are repainted with the basemap palette.
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
const FILL_COLOR = ['match', ['coalesce', ['get', 'feature_type'], ''], 'landuse', '#f3f0ea', '#dcd6cf'];

function setPaint(layerId, properties) {
  if (!map.getLayer(layerId)) return;
  for (const [name, value] of Object.entries(properties)) {
    map.setPaintProperty(layerId, name, value);
  }
}

function blendEditsIntoBasemap() {
  // The client renders detail exclusively from editor data; the basemap only
  // supplies large-scale context (terrain, water, boundaries, place names).
  setLayerVisibility(map, BASE_DETAIL_LAYERS, false);
  // The editor hides imported features behind a toggle; the client is the
  // finished map, so everything stored renders.
  setLayerVisibility(map, IMPORT_LAYERS, true);
  // Extrudes the editor's buildings; the basemap 3D layer stays hidden with
  // the rest of the base detail. Toggled by the 3D control.
  map.addLayer({
    id: 'client-3d-buildings',
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
  map.addLayer({
    id: 'client-edit-road-casing',
    type: 'line',
    source: 'editor',
    'source-layer': 'features',
    filter: ['all',
      ['==', ['geometry-type'], 'LineString'],
      ['==', ['get', 'feature_type'], 'road'],
      ['!=', ['get', 'source_kind'], 'base_tombstone'],
    ],
    paint: {
      'line-color': '#c8c2b9',
      'line-width': ROAD_CASING_WIDTH,
    },
  }, 'editor-import-line');
  for (const layerId of ['editor-manual-fill', 'editor-import-fill']) {
    setPaint(layerId, {
      'fill-color': FILL_COLOR,
      'fill-opacity': 0.9,
      'fill-outline-color': '#c8c0b8',
    });
  }
  setPaint('editor-manual-outline', { 'line-color': '#c8c0b8', 'line-width': 1 });
  for (const layerId of ['editor-manual-lines', 'editor-import-line']) {
    setPaint(layerId, { 'line-color': LINE_COLOR, 'line-width': LINE_WIDTH });
  }
  for (const layerId of ['editor-manual-points', 'editor-import-point']) {
    setPaint(layerId, {
      'circle-color': '#66778b',
      'circle-radius': 3,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
    });
  }
}

let revision = 0;
let lastSnapshot = null;

async function refreshEdits() {
  try {
    const collection = await featuresApi.list();
    const snapshot = JSON.stringify(collection);
    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;
    map.getSource('editor_anchors')?.setData(featureAnchors(collection.features));
    revision += 1;
    map.getSource('editor')?.setTiles([`/tiles/editor/{z}/{x}/{y}?revision=${revision}`]);
  } catch (error) {
    console.error('Unable to refresh edits', error);
  }
}

map.on('load', async () => {
  blendEditsIntoBasemap();
  await refreshEdits();
  // A hidden tab skips polling; returning to the tab refreshes immediately.
  setInterval(() => {
    if (!document.hidden) refreshEdits();
  }, REFRESH_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshEdits();
  });
});
