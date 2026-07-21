import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../frontend/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../frontend/src/app.css', import.meta.url), 'utf8');

const controls = html.match(/<aside class="panel controls"[\s\S]*?<\/aside>/)?.[0];
assert.ok(controls, 'editor controls panel is present');
assert.ok(controls.includes('<div class="controls-scroll">'), 'controls have an inner scroll region');

const sections = [...controls.matchAll(/<details(?<open> open)?\s*>\s*<summary><h2 data-i18n="(?<key>[^"]+)"/g)];
assert.deepEqual(
  sections.map((section) => section.groups.key),
  ['sectionEditing', 'sectionFind', 'sectionRoute', 'sectionLayers', 'sectionData', 'sectionHidden'],
);
assert.deepEqual(
  sections.filter((section) => section.groups.open).map((section) => section.groups.key),
  ['sectionEditing', 'sectionFind', 'sectionRoute'],
);

assert.match(css, /\.controls \{[^}]*max-height: calc\(100dvh - 32px\)[^}]*overflow: hidden/);
assert.match(css, /\.controls-scroll \{[^}]*overflow-y: auto/);
assert.match(css, /\.control-section details\[open\] summary::after/);

console.log('Scrollable and collapsible editor controls checks passed');
