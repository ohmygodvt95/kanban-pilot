/**
 * Smoke test of the refinement loop against the REAL Claude Code CLI.
 *   pnpm --filter @agent-kanban/core smoke:refine
 * Ambiguous task → questions → generic answers → plan → TODO.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore } from '../src/core.js';
import { git } from '../src/git/git.js';
import { consoleLogger } from '../src/util/logger.js';

const root = await mkdtemp(join(tmpdir(), 'ak-smoke-refine-'));
const repo = join(root, 'repo');
await mkdir(repo, { recursive: true });
await git(repo, ['init', '-q', '-b', 'main']);
await git(repo, ['config', 'user.name', 'smoke']);
await git(repo, ['config', 'user.email', 'smoke@example.com']);
await writeFile(join(repo, 'README.md'), '# smoke repo\n');
await writeFile(
  join(repo, 'server.js'),
  "import http from 'node:http';\nhttp.createServer((req, res) => res.end('ok')).listen(3000);\n",
);
await git(repo, ['add', '-A']);
await git(repo, ['commit', '-q', '-m', 'init']);

const core = createCore({
  paths: {
    dbPath: join(root, 'db.sqlite'),
    worktreesRoot: join(root, 'wt'),
    userTemplatesDir: join(root, 'tpl'),
    configDir: root,
  },
  logger: consoleLogger('smoke'),
  runner: { pollIntervalMs: 200 },
});
await core.start();
try {
  const project = await core.projects.create({ repo_path: repo });
  const task = await core.tasks.create(project.id, {
    title: 'Add authentication',
    description: 'Add authentication to the server.',
  });
  const settled = core.events.waitFor(
    'task.updated',
    (p) =>
      p.task.id === task.id &&
      ((p.task.column === 'backlog' && p.task.substate === 'needs_answer') || p.task.column === 'todo'),
    10 * 60_000,
  );
  await core.tasks.transition(task.id, 'todo', 'user');
  let t = (await settled).task;
  console.log(`\n=== after round 1: ${t.column}/${t.substate}`);
  if (t.substate === 'needs_answer') {
    const detail = await core.tasks.detail(task.id);
    console.log('questions:');
    for (const q of detail.questions) console.log(`  - ${q.question}`);
    const ready = core.events.waitFor(
      'task.updated',
      (p) => p.task.id === task.id && p.task.column === 'todo',
      10 * 60_000,
    );
    for (const q of detail.questions) {
      await core.refinement.answer(
        task.id,
        q.id,
        'Use a simple hard-coded bearer token read from the AUTH_TOKEN env var; no users, no sessions; reject with 401.',
      );
    }
    t = (await ready).task;
  }
  console.log(`\n=== final: ${t.column}/${t.substate} refinement_incomplete=${t.refinement_incomplete}`);
  console.log(`plan:\n${t.plan}`);
  const detail = await core.tasks.detail(task.id);
  for (const r of detail.runs)
    console.log(
      `run ${r.kind} ${r.status} session=${r.session_id} resumed=${r.resumed_from_session_id} cost=$${r.cost_usd}`,
    );
  process.exitCode = t.column === 'todo' ? 0 : 1;
} finally {
  await core.stop({ killProcesses: true });
  await rm(root, { recursive: true, force: true });
}
