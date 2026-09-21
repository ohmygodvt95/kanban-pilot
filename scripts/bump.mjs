#!/usr/bin/env node
/**
 * Bump the published CLI version (packages/cli/package.json), commit and tag.
 *
 *   node scripts/bump.mjs patch|minor|major|1.2.3 [--no-git]
 *
 * Only the CLI package is published (core/server/shared/web are private and inlined
 * into its bundle), so this is the single version users see: `kanban-pilot --version`,
 * /api/health and the menu row in the UI all read it from the build.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'packages/cli/package.json');
const args = process.argv.slice(2);
const noGit = args.includes('--no-git');
const spec = args.find((a) => !a.startsWith('--'));
if (!spec) {
  console.error('usage: node scripts/bump.mjs patch|minor|major|<x.y.z> [--no-git]');
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(file, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map((n) => Number.parseInt(n, 10));
const next =
  spec === 'major'
    ? `${major + 1}.0.0`
    : spec === 'minor'
      ? `${major}.${minor + 1}.0`
      : spec === 'patch'
        ? `${major}.${minor}.${patch + 1}`
        : spec;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(next)) {
  console.error(`not a version: ${next}`);
  process.exit(2);
}

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
if (!noGit) {
  if (git('status', '--porcelain')) {
    console.error('working tree is not clean; commit or stash first (or pass --no-git)');
    process.exit(1);
  }
  if (git('tag', '-l', `v${next}`)) {
    console.error(`tag v${next} already exists`);
    process.exit(1);
  }
}

pkg.version = next;
writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`${pkg.name}: ${major}.${minor}.${patch} -> ${next}`);
if (!noGit) {
  git('add', 'packages/cli/package.json');
  git('commit', '-m', `chore(release): v${next}`);
  git('tag', '-a', `v${next}`, '-m', `v${next}`);
  console.log(`committed and tagged v${next}; next: pnpm release`);
}
