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

console.log('editor.json is valid and all referenced layer ids exist');
