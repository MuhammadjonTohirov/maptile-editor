import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../frontend/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../frontend/src/app.css', import.meta.url), 'utf8');

const controls = html.match(/<aside class="panel controls"[\s\S]*?<\/aside>/)?.[0];
assert.ok(controls, 'editor controls panel is present');
assert.ok(controls.includes('<div class="controls-scroll">'), 'controls have an inner scroll region');
assert.ok(controls.includes('class="control-section-content route-controls"'), 'route controls have dedicated spacing');
assert.ok(controls.includes('id="route-details"'), 'route details action is present');
assert.ok(html.includes('id="route-details-modal"'), 'route details modal is present');
assert.ok(html.includes('id="route-details-json"'), 'route details expose the drawable JSON output');

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
assert.match(css, /\.route-controls \{[^}]*display: grid[^}]*gap: 10px/);
assert.match(css, /\.route-action-grid > :last-child \{[^}]*grid-column: 1 \/ -1/);

console.log('Scrollable and collapsible editor controls checks passed');
