// Layer-id lists shared by the editor, the client, and the style check
// (rule X3). Every id here must exist in frontend/styles/editor.json;
// scripts/check-style.mjs enforces that.

export const EDITOR_LAYERS = [
  'editor-import-fill',
  'editor-import-line',
  'editor-import-point',
  'editor-import-icons',
  'editor-import-labels',
  'editor-import-line-labels',
  'editor-manual-fill',
  'editor-manual-outline',
  'editor-manual-lines',
  'editor-manual-points',
  'editor-manual-icons',
  'editor-manual-labels',
  'editor-manual-line-labels',
];

export const IMPORT_LAYERS = [
  'editor-import-fill',
  'editor-import-line',
  'editor-import-point',
  'editor-import-icons',
  'editor-import-labels',
  'editor-import-line-labels',
];

// Basemap layers whose features can be copied into the editor by clicking.
export const BASE_EDITABLE_LAYERS = ['buildings', 'transportation', 'waterway', 'poi'];

// Basemap detail hidden in the client: it renders detail exclusively from
// editor data, and drawing both would double every object present in both.
export const BASE_DETAIL_LAYERS = [
  'buildings',
  'base-buildings-3d',
  'transportation',
  'transportation-casing',
  'waterway',
  'poi',
  'road-labels',
];

// Guarded visibility switch so a style edit cannot crash the app (rule F6).
export function setLayerVisibility(map, layerIds, visible) {
  for (const layerId of layerIds) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  }
}
