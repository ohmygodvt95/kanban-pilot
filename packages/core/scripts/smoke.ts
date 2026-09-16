/**
 * Smoke test against the REAL Claude Code CLI (requires `claude` logged in).
 *   pnpm --filter @agent-kanban/core smoke
 * Creates a throwaway repo + project, runs TODO → DOING → REVIEW and prints the diff.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore } from '../src/core.js';
import { git } from '../src/git/git.js';
import { consoleLogger } from '../src/util/logger.js';

const root = await mkdtemp(join(tmpdir(), 'ak-smoke-'));
const repo = join(root, 'repo');
await mkdir(repo, { recursive: true });
await git(repo, ['init', '-q', '-b', 'main']);
await git(repo, ['config', 'user.name', 'smoke']);
await git(repo, ['config', 'user.email', 'smoke@example.com']);
await writeFile(join(repo, 'README.md'), '# smoke repo\n\nA tiny repo used by agent-kanban smoke test.\n');
await writeFile(join(repo, 'math.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
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
core.events.on('run.event', ({ event }) => {
  const p = event.payload as { type: string; text?: string; name?: string };
  if (p.type === 'assistant_text') console.log(`  [assistant] ${p.text?.slice(0, 200)}`);
  else if (p.type === 'tool_use') console.log(`  [tool] ${p.name}`);
  else if (event.type === 'stderr') console.log(`  [stderr] ${p.text}`);
});

try {
  const project = await core.projects.create({
    repo_path: repo,
    refinement_enabled: false,
    test_script: 'node --test',
  });
  const task = await core.tasks.create(project.id, {
    title: 'Add multiply function',
    description:
      'Add an exported `multiply(a, b)` function to math.js and a small test file math.test.js using node:test that covers add and multiply.',
  });
  await core.tasks.transition(task.id, 'todo', 'user');
  const review = core.events.waitFor(
    'task.updated',
    (p) => p.task.id === task.id && (p.task.column === 'review' || p.task.substate === 'error'),
    10 * 60_000,
  );
  console.log('starting attempt…');
  await core.tasks.transition(task.id, 'doing', 'user');
  const final = (await review).task;
  console.log(
    `\n=== task is ${final.column}/${final.substate} ${final.last_error ? `error: ${final.last_error}` : ''}`,
  );
  const detail = await core.tasks.detail(task.id);
  for (const r of detail.runs) {
    console.log(
      `run ${r.id} ${r.kind} ${r.status} session=${r.session_id} cost=$${r.cost_usd} turns=${r.num_turns}`,
    );
    console.log(`  cmd: ${r.command}`);
  }
  if (detail.current_attempt) {
    console.log(
      `attempt branch=${detail.current_attempt.branch} tests_ok=${detail.current_attempt.last_test_ok}`,
    );
    console.log(`test output:\n${detail.current_attempt.last_test_output?.slice(0, 800)}`);
    const diff = await core.attempts.diff(detail.current_attempt);
    console.log('\n=== diff files');
    for (const f of diff.files)
      console.log(`  ${f.status.padEnd(8)} +${f.additions} -${f.deletions} ${f.path}`);
    console.log('\n=== patch (first 3000 chars)');
    console.log(diff.patch.slice(0, 3000));
  }
  process.exitCode = final.column === 'review' ? 0 : 1;
} finally {
  await core.stop({ killProcesses: true });
  if (!process.env.KEEP) await rm(root, { recursive: true, force: true });
  else console.log(`kept ${root}`);
}
