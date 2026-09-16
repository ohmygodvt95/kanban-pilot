import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default async function globalTeardown() {
  const file = join(here, '.state.json');
  if (!existsSync(file)) return;
  const state = JSON.parse(readFileSync(file, 'utf8')) as { root: string; pid: number };
  try {
    process.kill(-state.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  rmSync(state.root, { recursive: true, force: true });
  rmSync(file, { force: true });
}
