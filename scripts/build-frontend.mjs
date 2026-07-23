import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = new URL('../frontend/assets/', import.meta.url);
const workerSource = new URL(
  '../node_modules/maplibre-gl/dist/maplibre-gl-csp-worker.js',
  import.meta.url,
);
const workerContents = await readFile(workerSource);
const workerHash = createHash('sha256').update(workerContents).digest('hex').slice(0, 12);
const workerRelativePath = `chunks/maplibre-worker-${workerHash}.js`;

// Hashed chunks change whenever their content changes. Remove the generated
// directory first so a deployment never retains unreachable older chunks.
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(new URL('../frontend/assets/chunks/', import.meta.url), { recursive: true });
await writeFile(new URL(`../frontend/assets/${workerRelativePath}`, import.meta.url), workerContents);

const result = await build({
  absWorkingDir: root,
  entryPoints: {
    app: 'frontend/src/main.js',
    client: 'frontend/src/client.js',
  },
  outdir: 'frontend/assets',
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  format: 'esm',
  target: ['es2022'],
  loader: { '.css': 'css' },
  define: {
    MAPLIBRE_WORKER_URL: JSON.stringify(`/assets/${workerRelativePath}`),
  },
  minify: true,
  metafile: true,
  logLevel: 'info',
});

const outputs = Object.entries(result.metafile.outputs);
const editorEntry = outputs.find(([, metadata]) => metadata.entryPoint === 'frontend/src/main.js');
const sharedChunks = outputs.filter(([path, metadata]) => (
  path.endsWith('.js') && !metadata.entryPoint
));
const oversizedRuntime = outputs.filter(([path, metadata]) => (
  path.endsWith('.js') && metadata.bytes >= 1000 * 1024
));

if (!editorEntry || editorEntry[1].bytes > 400 * 1024) {
  throw new Error('The editor entry bundle must remain below 400 KiB');
}
if (!sharedChunks.length) {
  throw new Error('The frontend build must emit at least one shared JavaScript chunk');
}
if (oversizedRuntime.length || workerContents.byteLength >= 1000 * 1024) {
  throw new Error('Every production JavaScript file must remain below 1000 KiB');
}

console.log(
  `Editor entry ${(editorEntry[1].bytes / 1024).toFixed(1)} KiB; `
  + `${sharedChunks.length} shared JavaScript chunk(s) emitted`,
);
