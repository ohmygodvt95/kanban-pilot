/**
 * Bundle the CLI (core + server + shared inlined, third-party deps external),
 * copy the web build and instruction templates next to it.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
  dependencies: Record<string, string>;
};
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(root, 'src/bin.ts')],
  outfile: join(dist, 'bin.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  conditions: ['@agent-kanban/source'],
  external: Object.keys(pkg.dependencies),
  define: { __VERSION__: JSON.stringify(pkg.version) },
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
  },
  sourcemap: false,
  logLevel: 'info',
});
// keep the shebang exactly once
const out = readFileSync(join(dist, 'bin.js'), 'utf8').replace(/^#!.*\n#!/, '#!');
writeFileSync(join(dist, 'bin.js'), out);

const webDist = join(root, '..', 'web', 'dist');
if (!existsSync(join(webDist, 'index.html'))) {
  throw new Error(`web build missing at ${webDist}; run pnpm --filter @agent-kanban/web build first`);
}
cpSync(webDist, join(dist, 'web'), { recursive: true });
rmSync(join(root, 'templates'), { recursive: true, force: true });
cpSync(join(root, '..', 'core', 'templates'), join(root, 'templates'), { recursive: true });
cpSync(join(root, '..', '..', 'README.md'), join(root, 'README.md'));
console.log('cli built: dist/bin.js + dist/web + templates/');
