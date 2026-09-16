import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task } from '@agent-kanban/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Core, createCore } from './core.js';
import { git } from './git/git.js';
import { FakeClaudeAdapter } from './testing/fake-executor.js';
import { CoreError } from './util/errors.js';
import { consoleLogger } from './util/logger.js';

async function makeRepo(dir: string) {
  await mkdir(dir, { recursive: true });
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.name', 'test']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await writeFile(join(dir, 'README.md'), '# demo\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'init']);
}

describe('core end-to-end with fake executor', () => {
  let root: string;
  let repo: string;
  let core: Core;

  const waitState = (
    id: string,
    column: Task['column'],
    substate: Task['substate'] | undefined = undefined,
    timeout = 15_000,
  ) =>
    core.events.waitFor(
      'task.updated',
      (p) =>
        p.task.id === id &&
        p.task.column === column &&
        (substate === undefined || p.task.substate === substate),
      timeout,
    );

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ak-core-'));
    repo = join(root, 'repo');
    await makeRepo(repo);
    core = createCore({
      paths: {
        dbPath: join(root, 'db.sqlite'),
        worktreesRoot: join(root, 'worktrees'),
        userTemplatesDir: join(root, 'templates'),
        configDir: root,
      },
      executors: { claude: new FakeClaudeAdapter() },
      runner: { pollIntervalMs: 50 },
      logger: process.env.AK_TEST_LOG ? consoleLogger('test') : undefined,
    });
    await core.start();
  });

  afterEach(async () => {
    await core.stop({ killProcesses: true });
    await rm(root, { recursive: true, force: true });
  });

  it('TODO → DOING → REVIEW → feedback loop → DONE', async () => {
    const project = await core.projects.create({
      repo_path: repo,
      refinement_enabled: false,
      test_script: 'test -f agent.txt',
    });
    expect(project.base_branch).toBe('main');
    const task = await core.tasks.create(project.id, {
      title: 'Add greeting file',
      description: 'Create agent.txt',
    });
    expect(task.column).toBe('backlog');

    // BACKLOG → TODO (refinement disabled → straight to ready)
    const todo = await core.tasks.transition(task.id, 'todo', 'user');
    expect(todo.substate).toBe('ready');

    // TODO → DOING: attempt + run created, runner picks it up
    const reviewP = waitState(task.id, 'review');
    const doing = await core.tasks.transition(task.id, 'doing', 'user');
    expect(doing.substate).toBe('queued');
    expect(doing.current_attempt_id).toBeTruthy();
    const review = (await reviewP).task;
    expect(review.substate).toBe('pending');

    const detail = await core.tasks.detail(task.id);
    expect(detail.runs).toHaveLength(1);
    const run = detail.runs[0]!;
    expect(run.status).toBe('succeeded');
    expect(run.session_id).toMatch(/[0-9a-f-]{36}/);
    expect(run.cost_usd).toBeCloseTo(0.05);
    expect(run.command).toContain('fake-agent.mjs');
    const events = await core.store.listRunEvents(run.id);
    expect(events.map((e) => e.type)).toEqual([
      'system',
      'raw',
      'assistant',
      'assistant',
      'user',
      'assistant',
      'result',
    ]);
    expect(detail.current_attempt?.last_test_ok).toBe(true);

    // diff shows the agent's files, committed on the attempt branch
    const diff = await core.attempts.diff(detail.current_attempt!);
    expect(diff.files.map((f) => f.path).sort()).toEqual(['agent.txt', 'generated/note.md']);
    const log = await git(detail.current_attempt!.worktree_path, ['log', '--oneline']);
    expect(log.stdout.split('\n')).toHaveLength(2);

    // REVIEW → DOING without feedback is rejected
    await expect(core.tasks.transition(task.id, 'doing', 'user')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });

    // feedback → followup resumes the session
    await core.tasks.addComment(task.id, {
      kind: 'feedback',
      body: 'append a line',
      file_path: 'agent.txt',
      line: 1,
    });
    const review2P = waitState(task.id, 'review');
    await core.tasks.transition(task.id, 'doing', 'user');
    await review2P;
    const detail2 = await core.tasks.detail(task.id);
    expect(detail2.runs).toHaveLength(2);
    const followup = detail2.runs[1]!;
    expect(followup.kind).toBe('followup');
    expect(followup.resumed_from_session_id).toBe(run.session_id);
    expect(followup.prompt).toContain('1. [agent.txt:1] append a line');
    expect(detail2.comments[0]?.consumed_by_run_id).toBe(followup.id);
    const content = await readFile(join(detail2.current_attempt!.worktree_path, 'agent.txt'), 'utf8');
    expect(content).toContain('followup: resumed');

    // second feedback round on the same session
    await core.tasks.addComment(task.id, { kind: 'feedback', body: 'one more' });
    const review3P = waitState(task.id, 'review');
    await core.tasks.transition(task.id, 'doing', 'user');
    await review3P;
    const detail3 = await core.tasks.detail(task.id);
    expect(detail3.runs[2]?.resumed_from_session_id).toBe(run.session_id);
    expect(
      (await readFile(join(detail3.current_attempt!.worktree_path, 'agent.txt'), 'utf8')).split('followup')
        .length,
    ).toBe(3);

    // REVIEW → DONE merges into main
    const done = await core.tasks.transition(task.id, 'done', 'user');
    expect(done.column).toBe('done');
    expect(await readFile(join(repo, 'agent.txt'), 'utf8')).toContain('hello from fake agent');
    const attempt = await core.store.getAttempt(detail3.current_attempt!.id);
    expect(attempt.status).toBe('merged');
    await expect(core.tasks.transition(task.id, 'todo', 'user')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('DOING(error) when the agent changes nothing; retry; discard back to TODO', async () => {
    const project = await core.projects.create({ repo_path: repo, refinement_enabled: false });
    const task = await core.tasks.create(project.id, { title: 'noop', description: 'FAKE:nochange' });
    await core.tasks.transition(task.id, 'todo', 'user');
    const errP = waitState(task.id, 'doing', 'error');
    await core.tasks.transition(task.id, 'doing', 'user');
    const err = (await errP).task;
    expect(err.last_error).toMatch(/không thay đổi file/);

    // retry resumes the failed session; still no change → error again
    const err2P = waitState(task.id, 'doing', 'error');
    const queued = await core.tasks.transition(task.id, 'doing', 'user', { action: 'retry' });
    expect(queued.substate).toBe('queued');
    await err2P;
    const detail = await core.tasks.detail(task.id);
    expect(detail.runs).toHaveLength(2);
    expect(detail.runs[1]?.kind).toBe('followup');
    expect(detail.runs[1]?.resumed_from_session_id).toBe(detail.runs[0]?.session_id);

    // drag back to TODO discards the attempt (worktree + branch gone)
    const attemptId = detail.current_attempt_id!;
    const wt = detail.current_attempt!.worktree_path;
    const todo = await core.tasks.transition(task.id, 'todo', 'user');
    expect(todo.current_attempt_id).toBeNull();
    expect((await core.store.getAttempt(attemptId)).status).toBe('discarded');
    expect((await git(repo, ['worktree', 'list'])).stdout).not.toContain(wt);
    expect((await git(repo, ['branch', '--list', 'ak/*'])).stdout.trim()).toBe('');
  });

  it('failed CLI exit and crash surface as DOING(error) with messages', async () => {
    const project = await core.projects.create({ repo_path: repo, refinement_enabled: false });
    const t1 = await core.tasks.create(project.id, { title: 'fails', description: 'FAKE:fail' });
    await core.tasks.transition(t1.id, 'todo', 'user');
    const e1 = waitState(t1.id, 'doing', 'error');
    await core.tasks.transition(t1.id, 'doing', 'user');
    expect((await e1).task.last_error).toMatch(/exited with code 1/);
    const t2 = await core.tasks.create(project.id, { title: 'crashes', description: 'FAKE:crash' });
    await core.tasks.transition(t2.id, 'todo', 'user');
    const e2 = waitState(t2.id, 'doing', 'error');
    await core.tasks.transition(t2.id, 'doing', 'user');
    expect((await e2).task.last_error).toMatch(/code 2[\s\S]*fake agent crashed/);
  });

  it('cancel kills the running agent → DOING(error), restart starts a fresh attempt with feedback', async () => {
    const project = await core.projects.create({ repo_path: repo, refinement_enabled: false });
    const task = await core.tasks.create(project.id, { title: 'slow', description: 'FAKE:sleep=60000' });
    await core.tasks.transition(task.id, 'todo', 'user');
    const runningP = waitState(task.id, 'doing', 'running');
    await core.tasks.transition(task.id, 'doing', 'user');
    await runningP;
    const runs = await core.store.listRuns(task.id);
    const errP = waitState(task.id, 'doing', 'error');
    await core.tasks.cancelRun(runs[0]!.id);
    const err = (await errP).task;
    expect(err.last_error).toMatch(/cancelled/);
    expect((await core.store.getRun(runs[0]!.id)).status).toBe('cancelled');

    // Restart: new attempt, prompt includes previous feedback, no resume
    await core.tasks.addComment(task.id, { kind: 'feedback', body: 'earlier note' });
    await core.store.updateTask(task.id, { description: 'now quick' });
    const firstAttempt = err.current_attempt_id!;
    const reviewP = waitState(task.id, 'review');
    const restarted = await core.tasks.restartAttempt(task.id);
    expect(restarted.current_attempt_id).not.toBe(firstAttempt);
    expect((await core.store.getAttempt(firstAttempt)).status).toBe('discarded');
    await reviewP;
    const detail = await core.tasks.detail(task.id);
    const execRun = detail.runs.at(-1)!;
    expect(execRun.kind).toBe('execute');
    expect(execRun.resumed_from_session_id).toBeNull();
    expect(execRun.prompt).toContain('Feedback từ các lần thử trước');
    expect(execRun.prompt).toContain('earlier note');
  });

  it('refinement: questions → answers → plan → execute resumes the refine session', async () => {
    const project = await core.projects.create({ repo_path: repo });
    expect(project.refinement_enabled).toBe(true);
    const task = await core.tasks.create(project.id, {
      title: 'ambiguous',
      description: 'FAKE:ask make a widget',
    });
    const needsP = waitState(task.id, 'backlog', 'needs_answer');
    const refining = await core.tasks.transition(task.id, 'todo', 'user');
    expect(refining.column).toBe('backlog');
    expect(refining.substate).toBe('refining');
    await expect(core.tasks.transition(task.id, 'todo', 'user')).rejects.toBeInstanceOf(CoreError);
    await needsP;
    const d1 = await core.tasks.detail(task.id);
    expect(d1.questions).toHaveLength(2);
    expect(d1.refinement_session_id).toBeTruthy();
    expect(d1.runs[0]?.kind).toBe('refine');
    expect(d1.runs[0]?.attempt_id).toBeNull();

    // dragging with open questions is rejected
    await expect(core.tasks.transition(task.id, 'todo', 'user')).rejects.toThrow(/answer the open/);

    const readyP = waitState(task.id, 'todo', 'ready');
    await core.refinement.answer(task.id, d1.questions[0]!.id, 'blue');
    expect((await core.store.getTask(task.id)).substate).toBe('needs_answer');
    await core.refinement.answer(task.id, d1.questions[1]!.id, 'yes');
    const ready = (await readyP).task;
    expect(ready.plan).toContain('Plan for');
    expect(ready.description).toContain('**A:** blue');
    const d2 = await core.tasks.detail(task.id);
    expect(d2.runs).toHaveLength(2);
    expect(d2.runs[1]?.resumed_from_session_id).toBe(d1.refinement_session_id);
    expect(d2.runs[1]?.prompt).toContain('A: blue');

    // execute resumes the refinement session
    const reviewP = waitState(task.id, 'review');
    await core.tasks.transition(task.id, 'doing', 'user');
    await reviewP;
    const d3 = await core.tasks.detail(task.id);
    const exec = d3.runs.find((r) => r.kind === 'execute')!;
    expect(exec.resumed_from_session_id).toBe(d1.refinement_session_id);
    expect(exec.prompt).toContain('Plan đã duyệt');
    expect(exec.prompt).toContain(d3.current_attempt!.worktree_path);
  });

  it('skip_refinement moves straight to TODO; any → BACKLOG requires confirmation with an attempt', async () => {
    const project = await core.projects.create({ repo_path: repo });
    const task = await core.tasks.create(project.id, {
      title: 'skip',
      description: 'x',
      skip_refinement: true,
    });
    expect((await core.tasks.transition(task.id, 'todo', 'user')).substate).toBe('ready');
    const reviewP = waitState(task.id, 'review');
    await core.tasks.transition(task.id, 'doing', 'user');
    await reviewP;
    await expect(core.tasks.transition(task.id, 'backlog', 'user')).rejects.toMatchObject({
      code: 'CONFIRM_REQUIRED',
    });
    const back = await core.tasks.transition(task.id, 'backlog', 'user', { confirm_discard: true });
    expect(back.substate).toBe('draft');
    expect(back.current_attempt_id).toBeNull();
    expect((await core.store.listActiveAttempts()).length).toBe(0);
  });

  it('respects max_concurrent_runs and setup_script', async () => {
    const project = await core.projects.create({
      repo_path: repo,
      refinement_enabled: false,
      max_concurrent_runs: 1,
      setup_script: 'echo setup > setup.log',
    });
    const a = await core.tasks.create(project.id, { title: 'a', description: 'FAKE:sleep=800' });
    const b = await core.tasks.create(project.id, { title: 'b', description: 'quick' });
    await core.tasks.transition(a.id, 'todo', 'user');
    await core.tasks.transition(b.id, 'todo', 'user');
    const aRunning = waitState(a.id, 'doing', 'running');
    await core.tasks.transition(a.id, 'doing', 'user');
    await core.tasks.transition(b.id, 'doing', 'user');
    await aRunning;
    await new Promise((r) => setTimeout(r, 300));
    expect((await core.store.getTask(b.id)).substate).toBe('queued');
    await waitState(b.id, 'review');
    const bDetail = await core.tasks.detail(b.id);
    expect(await readFile(join(bDetail.current_attempt!.worktree_path, 'setup.log'), 'utf8')).toBe('setup\n');
    // setup.log is untracked output of the setup script and ends up in the diff (expected: agent-kanban commits everything)
    await waitState(a.id, 'review', undefined, 5_000).catch(() => {});
    expect((await core.store.getTask(a.id)).column).toBe('review');
  });

  it('project creation validates the repo path and reads .agent-kanban.json', async () => {
    await expect(core.projects.create({ repo_path: root })).rejects.toMatchObject({ code: 'VALIDATION' });
    await writeFile(
      join(repo, '.agent-kanban.json'),
      JSON.stringify({ test_script: 'true', refinement_enabled: false }),
    );
    const p = await core.projects.create({ repo_path: repo });
    expect(p.test_script).toBe('true');
    expect(p.refinement_enabled).toBe(false);
    await expect(core.projects.create({ repo_path: repo })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('chat with the agent', () => {
  let root: string;
  let repo: string;
  let core: Core;
  const waitState = (id: string, column: Task['column'], substate?: Task['substate']) =>
    core.events.waitFor(
      'task.updated',
      (p) =>
        p.task.id === id &&
        p.task.column === column &&
        (substate === undefined || p.task.substate === substate),
      15_000,
    );
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ak-chat-'));
    repo = join(root, 'repo');
    await makeRepo(repo);
    core = createCore({
      paths: {
        dbPath: join(root, 'db.sqlite'),
        worktreesRoot: join(root, 'wt'),
        userTemplatesDir: join(root, 'tpl'),
        configDir: root,
      },
      executors: { claude: new FakeClaudeAdapter() },
      runner: { pollIntervalMs: 50 },
    });
    await core.start();
  });
  afterEach(async () => {
    await core.stop({ killProcesses: true });
    await rm(root, { recursive: true, force: true });
  });

  it('planner chat in TODO resumes the refinement session and can update the plan', async () => {
    const project = await core.projects.create({ repo_path: repo });
    const task = await core.tasks.create(project.id, { title: 'chatty', description: 'do something' });
    const readyP = waitState(task.id, 'todo', 'ready');
    await core.tasks.transition(task.id, 'todo', 'user');
    const ready = (await readyP).task;
    expect(ready.refinement_session_id).toBeTruthy();

    const done1 = core.events.waitFor(
      'run.updated',
      (p) => p.run.kind === 'chat' && p.run.status === 'succeeded',
      15_000,
    );
    await core.tasks.chat(task.id, 'Why did you choose agent.txt?');
    await expect(core.tasks.chat(task.id, 'again')).rejects.toMatchObject({ code: 'CONFLICT' });
    const run1 = (await done1).run;
    expect(run1.resumed_from_session_id).toBe(ready.refinement_session_id);
    expect(run1.result_text).toContain('Planner reply');
    await core.runner.idle();
    let detail = await core.tasks.detail(task.id);
    expect(detail.plan).toBe(ready.plan); // no plan change
    expect(detail.comments.at(-1)).toMatchObject({ kind: 'chat', consumed_by_run_id: run1.id });
    expect(detail.column).toBe('todo');

    const done2 = core.events.waitFor(
      'run.updated',
      (p) => p.run.kind === 'chat' && p.run.status === 'succeeded' && p.run.id !== run1.id,
      15_000,
    );
    await core.tasks.chat(task.id, 'Change the plan: also add tests');
    await done2;
    await core.runner.idle();
    detail = await core.tasks.detail(task.id);
    expect(detail.plan).toContain('Updated plan because');
    expect(detail.column).toBe('todo');
  });

  it('chat in REVIEW becomes feedback and resumes the attempt session; chat in DOING(error) retries with the message', async () => {
    const project = await core.projects.create({ repo_path: repo, refinement_enabled: false });
    const task = await core.tasks.create(project.id, { title: 'review chat', description: 'x' });
    await core.tasks.transition(task.id, 'todo', 'user');
    const reviewP = waitState(task.id, 'review');
    await core.tasks.transition(task.id, 'doing', 'user');
    await reviewP;
    const queued = await core.tasks.chat(task.id, 'please rename the file');
    expect(queued.column).toBe('doing');
    await waitState(task.id, 'review');
    const detail = await core.tasks.detail(task.id);
    const followup = detail.runs.at(-1)!;
    expect(followup.kind).toBe('followup');
    expect(followup.prompt).toContain('1. please rename the file');
    expect(followup.resumed_from_session_id).toBe(detail.runs[0]!.session_id);
    expect(detail.comments[0]).toMatchObject({ kind: 'chat', consumed_by_run_id: followup.id });
    expect(followup.result_text).toContain('Done');

    // error path
    const t2 = await core.tasks.create(project.id, { title: 'err chat', description: 'FAKE:nochange' });
    await core.tasks.transition(t2.id, 'todo', 'user');
    const errP = waitState(t2.id, 'doing', 'error');
    await core.tasks.transition(t2.id, 'doing', 'user');
    await errP;
    expect((await core.tasks.chat(t2.id, 'just try again')).substate).toBe('queued');
    await waitState(t2.id, 'doing', 'error');
    const d2 = await core.tasks.detail(t2.id);
    expect(d2.runs.at(-1)?.prompt).toContain('Người dùng bổ sung:\n1. just try again');
    expect(d2.comments[0]?.consumed_by_run_id).toBe(d2.runs.at(-1)?.id);
  });

  it('rejects chat on DONE tasks', async () => {
    const project = await core.projects.create({ repo_path: repo, refinement_enabled: false });
    const task = await core.tasks.create(project.id, { title: 'done', description: 'x' });
    await core.tasks.transition(task.id, 'todo', 'user');
    const reviewP = waitState(task.id, 'review');
    await core.tasks.transition(task.id, 'doing', 'user');
    await reviewP;
    await core.tasks.transition(task.id, 'done', 'user');
    await expect(core.tasks.chat(task.id, 'hi')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});
