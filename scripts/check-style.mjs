// Validates the map style against the MapLibre style spec and verifies that
// every layer id the scripts reference exists in the style (rule F10).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import {
  BASE_DETAIL_LAYERS,
  BASE_EDITABLE_LAYERS,
  EDITOR_LAYERS,
  IMPORT_LAYERS,
} from '../frontend/src/layers.js';
import { BASE_MASK_LAYERS } from '../frontend/src/base-masks.js';

const stylePath = fileURLToPath(new URL('../frontend/styles/editor.json', import.meta.url));
const style = JSON.parse(await readFile(stylePath, 'utf8'));

const errors = validateStyleMin(style);
if (errors.length) {
  for (const error of errors) console.error(`style-spec: ${error.message}`);
  process.exit(1);
}

const styleLayerIds = new Set(style.layers.map((layer) => layer.id));
const referenced = new Set([
  ...EDITOR_LAYERS,
  ...IMPORT_LAYERS,
  ...BASE_EDITABLE_LAYERS,
  ...BASE_DETAIL_LAYERS,
  ...Object.values(BASE_MASK_LAYERS).flat(),
  'base-buildings-3d',
]);
const missing = [...referenced].filter((id) => !styleLayerIds.has(id));
if (missing.length) {
  console.error(`layer ids referenced in scripts but missing from editor.json: ${missing.join(', ')}`);
  process.exit(1);
}

const layerById = new Map(style.layers.map((layer) => [layer.id, layer]));
if (!layerById.get('editor-route-line-foot')?.paint?.['line-dasharray']) {
  console.error('walking route layer must use a dashed line');
  process.exit(1);
}
if (layerById.get('editor-route-line')?.paint?.['line-dasharray']) {
  console.error('car route layer must remain solid');
  process.exit(1);
}
if (!layerById.has('editor-route-point-labels')) {
  console.error('route endpoints must have A/B labels');
  process.exit(1);
}
for (const layerId of ['editor-road-direction-arrows', 'editor-road-turn-arrows']) {
  if (!layerById.has(layerId)) {
    console.error(`road editing guidance layer is missing: ${layerId}`);
    process.exit(1);
  }
}
if (layerById.has('editor-road-guidance-turns') || layerById.has('editor-road-guidance-turn-casing')) {
  console.error('junction guidance must not draw connector-arm line layers');
  process.exit(1);
}
const turnArrowLayout = layerById.get('editor-road-turn-arrows')?.layout;
if (turnArrowLayout?.['icon-anchor'] !== 'center' || turnArrowLayout?.['icon-size'] !== 0.625) {
  console.error('junction arrows must be half-size and centred around their offset');
  process.exit(1);
}
const turnArrowOffsets = JSON.stringify(turnArrowLayout?.['icon-offset']);
if (!turnArrowOffsets.includes('uturn') || !turnArrowOffsets.includes('56') || !turnArrowOffsets.includes('-64')) {
  console.error('turn and restricted U-turn controls must stay separated from the node');
  process.exit(1);
}
if (layerById.get('editor-road-turn-arrows')?.minzoom !== 20) {
  console.error('junction arrows must stay hidden below zoom 20');
  process.exit(1);
}

console.log('editor.json is valid and all referenced layer ids exist');
