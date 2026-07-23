import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const MAX_LINES = 600;
const PREFERRED_LINES = 500;
const ROOTS = ['backend', 'frontend/src', 'scripts'];
const SOURCE_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.jsx',
  '.mjs',
  '.py',
  '.sh',
  '.ts',
  '.tsx',
  '.vue',
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

function lineCount(source) {
  if (!source) return 0;
  const newlines = source.match(/\n/g)?.length || 0;
  return newlines + (source.endsWith('\n') ? 0 : 1);
}

const files = (await Promise.all(ROOTS.map(sourceFiles))).flat();
const sizes = await Promise.all(files.map(async (path) => ({
  path: relative('.', path),
  lines: lineCount(await readFile(path, 'utf8')),
})));
const violations = sizes.filter(({ lines }) => lines > MAX_LINES);

if (violations.length) {
  console.error(`Source files must not exceed ${MAX_LINES} lines:`);
  for (const { path, lines } of violations.sort((a, b) => b.lines - a.lines)) {
    console.error(`  ${lines}  ${path}`);
  }
  process.exit(1);
}

const nearLimit = sizes
  .filter(({ lines }) => lines > PREFERRED_LINES)
  .sort((a, b) => b.lines - a.lines);
console.log(
  `Source-size check passed: ${sizes.length} files are at or below ${MAX_LINES} lines.`,
);
if (nearLimit.length) {
  console.log(
    `Near the preferred ${PREFERRED_LINES}-line target: ${
      nearLimit.map(({ path, lines }) => `${path} (${lines})`).join(', ')
    }`,
  );
}
