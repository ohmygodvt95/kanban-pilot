/**
 * Boots the API server (fake executor, temp DB, temp git repo) and serves the
 * production web build. State is shared with tests through e2e/.state.json.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 3799;

export default async function globalSetup() {
  const root = mkdtempSync(join(tmpdir(), 'ak-e2e-'));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  await execa('git', ['config', 'user.name', 'e2e'], { cwd: repo });
  await execa('git', ['config', 'user.email', 'e2e@example.com'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# e2e\n');
  await execa('git', ['add', '-A'], { cwd: repo });
  await execa('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

  const serverDir = join(here, '..', '..', 'server');
  const child = spawn('pnpm', ['exec', 'tsx', '--conditions=@agent-kanban/source', 'src/dev.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      AK_FAKE: '1',
      AK_DB: join(root, 'db.sqlite'),
      AK_WORKTREES: join(root, 'wt'),
      AK_LOGS: join(root, 'logs'),
      AK_WEB_DIST: join(here, '..', 'dist'),
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout?.on('data', (d) => process.env.AK_E2E_VERBOSE && process.stdout.write(d));
  child.stderr?.on('data', (d) => process.env.AK_E2E_VERBOSE && process.stderr.write(d));
  child.unref();

  // wait for /api/health
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error('agent-kanban server did not start');
    await new Promise((r) => setTimeout(r, 300));
  }
  writeFileSync(join(here, '.state.json'), JSON.stringify({ root, repo, pid: child.pid, port: PORT }));
}
