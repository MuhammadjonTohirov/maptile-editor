import maplibregl from 'maplibre-gl';
import { featuresApi } from './api.js';
import { enableEmojiIcons, featureAnchors } from './emoji-icons.js';
import { setLayerVisibility } from './layers.js';
import { addTileSymbolLayers, paintEditorAsBasemap, EDITOR_3D_LAYER } from './basemap-render.js';
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
    setLayerVisibility(this.map, [EDITOR_3D_LAYER], this.enabled);
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

// Full base: at country scale every icon and label comes from the vector
// tiles; the small-data overlay draws them from the GeoJSON anchor source.
let fullBase = false;

let revision = 0;
let lastVersion = null;

// Polling asks only for a change stamp (count + latest timestamp); the tile
// source (and, in overlay mode, the anchor source) reload only when an edit
// actually happened, so an idle map never repaints. In full-base mode the
// whole-collection fetch is skipped entirely — nothing scales it to 2.2M rows.
async function refreshEdits() {
  try {
    const version = await featuresApi.version();
    const stamp = `${version.count}:${version.updated_at}`;
    if (stamp === lastVersion) return;
    if (!fullBase) {
      const collection = await featuresApi.list();
      map.getSource('editor_anchors')?.setData(featureAnchors(collection.features));
    }
    revision += 1;
    map.getSource('editor')?.setTiles([`/tiles/editor/{z}/{x}/{y}?revision=${revision}`]);
    lastVersion = stamp;
  } catch (error) {
    console.error('Unable to refresh edits', error);
  }
}

map.on('load', async () => {
  paintEditorAsBasemap(map);
  try {
    fullBase = (await featuresApi.meta()).full_base;
  } catch (error) {
    console.error('Unable to read map metadata', error);
  }
  if (fullBase) addTileSymbolLayers(map);
  await refreshEdits();
  // A hidden tab skips polling; returning to the tab refreshes immediately.
  setInterval(() => {
    if (!document.hidden) refreshEdits();
  }, REFRESH_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshEdits();
  });
});
