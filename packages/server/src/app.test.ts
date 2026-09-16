import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Core, createCore, git } from '@agent-kanban/core';
import { FakeClaudeAdapter } from '@agent-kanban/core/testing';
import type { Attempt, Comment, DiffResult, Project, RunEvent, Task, TaskDetail } from '@agent-kanban/shared';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { type RunningServer, startServer } from './server.js';

async function makeRepo(dir: string) {
  await mkdir(dir, { recursive: true });
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.name', 'test']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await writeFile(join(dir, 'README.md'), '# demo\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'init']);
}

describe('HTTP API', () => {
  let root: string;
  let repo: string;
  let core: Core;
  let app: Hono;
  let webDist: string;

  const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
  const post = (path: string, body?: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const waitState = (id: string, column: Task['column'], substate?: Task['substate']) =>
    core.events.waitFor(
      'task.updated',
      (p) =>
        p.task.id === id &&
        p.task.column === column &&
        (substate === undefined || p.task.substate === substate),
      15_000,
    );

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ak-server-'));
    repo = join(root, 'repo');
    await makeRepo(repo);
    webDist = join(root, 'web');
    await mkdir(join(webDist, 'assets'), { recursive: true });
    await writeFile(join(webDist, 'index.html'), '<!doctype html><title>ak</title>');
    await writeFile(join(webDist, 'assets', 'app.js'), 'console.log(1)');
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
    app = createApp({ core, webDistDir: webDist });
  });

  afterAll(async () => {
    await core.stop({ killProcesses: true });
    await rm(root, { recursive: true, force: true });
  });

  let project: Project;
  let task: Task;

  it('creates a project (validating the repo) and lists executors', async () => {
    const bad = await post('/api/projects', { repo_path: root });
    expect(bad.status).toBe(400);
    expect((await json<{ error: { code: string } }>(bad)).error.code).toBe('VALIDATION');
    const invalid = await post('/api/projects', { name: 'x' });
    expect(invalid.status).toBe(400);

    const res = await post('/api/projects', { repo_path: repo, refinement_enabled: false });
    expect(res.status).toBe(201);
    project = await json<Project>(res);
    expect(project.repo_path).toBe(repo);
    expect(await json<Project[]>(await app.request('/api/projects'))).toHaveLength(1);

    const execs = await json<{ id: string; ok: boolean }[]>(
      await app.request(`/api/projects/${project.id}/executors`),
    );
    expect(execs.find((e) => e.id === 'claude')?.ok).toBe(true);

    const patched = await app.request(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ test_script: 'test -f agent.txt', max_concurrent_runs: 3 }),
    });
    expect((await json<Project>(patched)).max_concurrent_runs).toBe(3);
  });

  it('runs the main flow through the API and rejects invalid transitions with 409', async () => {
    const created = await post(`/api/projects/${project.id}/tasks`, {
      title: 'API task',
      description: 'do it',
    });
    expect(created.status).toBe(201);
    task = await json<Task>(created);
    expect(await json<Task[]>(await app.request(`/api/projects/${project.id}/tasks`))).toHaveLength(1);

    // backlog → review is invalid
    const bad = await post(`/api/tasks/${task.id}/transition`, { target: 'review' });
    expect(bad.status).toBe(409);
    expect((await json<{ error: { code: string; message: string } }>(bad)).error.code).toBe(
      'INVALID_TRANSITION',
    );
    // unknown column → 400
    expect((await post(`/api/tasks/${task.id}/transition`, { target: 'nope' })).status).toBe(400);

    expect(
      (await json<Task>(await post(`/api/tasks/${task.id}/transition`, { target: 'todo' }))).substate,
    ).toBe('ready');
    const reviewP = waitState(task.id, 'review');
    const doing = await json<Task>(await post(`/api/tasks/${task.id}/transition`, { target: 'doing' }));
    expect(doing.substate).toBe('queued');
    await reviewP;

    const detail = await json<TaskDetail>(await app.request(`/api/tasks/${task.id}`));
    expect(detail.column).toBe('review');
    expect(detail.runs).toHaveLength(1);
    expect(detail.current_attempt?.last_test_ok).toBe(true);

    const diff = await json<DiffResult>(
      await app.request(`/api/attempts/${detail.current_attempt!.id}/diff`),
    );
    expect(diff.files.map((f) => f.path)).toContain('agent.txt');
    const tests = await json<{ ok: boolean }>(
      await app.request(`/api/attempts/${detail.current_attempt!.id}/tests`),
    );
    expect(tests.ok).toBe(true);

    const runId = detail.runs[0]!.id;
    const events = await json<RunEvent[]>(await app.request(`/api/runs/${runId}/events`));
    expect(events.length).toBeGreaterThan(3);
    const tail = await json<RunEvent[]>(
      await app.request(`/api/runs/${runId}/events?after=${events.length - 1}`),
    );
    expect(tail).toHaveLength(1);
    expect(tail[0]?.type).toBe('result');
    expect((await app.request(`/api/runs/${runId}/events?after=-1`)).status).toBe(400);
    expect((await app.request('/api/runs/missing')).status).toBe(404);

    // review → doing without feedback: 409
    expect((await post(`/api/tasks/${task.id}/transition`, { target: 'doing' })).status).toBe(409);
    const comment = await json<Comment>(
      await post(`/api/tasks/${task.id}/comments`, { body: 'tweak', file_path: 'agent.txt', line: 1 }),
    );
    expect(comment.kind).toBe('feedback');
    const review2 = waitState(task.id, 'review');
    expect((await post(`/api/tasks/${task.id}/transition`, { target: 'doing' })).status).toBe(200);
    await review2;
    // consumed comment cannot be deleted
    expect((await app.request(`/api/comments/${comment.id}`, { method: 'DELETE' })).status).toBe(409);
    const note = await json<Comment>(
      await post(`/api/tasks/${task.id}/comments`, { kind: 'note', body: 'n' }),
    );
    expect((await app.request(`/api/comments/${note.id}`, { method: 'DELETE' })).status).toBe(204);

    // clone + done
    const clone = await json<Task>(await post(`/api/tasks/${task.id}/clone`));
    expect(clone.title).toContain('(copy)');
    const done = await json<Task>(await post(`/api/tasks/${task.id}/transition`, { target: 'done' }));
    expect(done.column).toBe('done');
    expect((await post(`/api/tasks/${task.id}/transition`, { target: 'todo' })).status).toBe(409);
    // project delete refused while the clone... has no attempt → allowed only when no active attempts
    const attempts = await json<Attempt>(await app.request(`/api/attempts/${detail.current_attempt!.id}`));
    expect(attempts.status).toBe('merged');
  });

  it('cancels a running run and deletes tasks', async () => {
    const slow = await json<Task>(
      await post(`/api/projects/${project.id}/tasks`, { title: 'slow', description: 'FAKE:sleep=60000' }),
    );
    await post(`/api/tasks/${slow.id}/transition`, { target: 'todo' });
    const running = waitState(slow.id, 'doing', 'running');
    await post(`/api/tasks/${slow.id}/transition`, { target: 'doing' });
    await running;
    expect((await app.request(`/api/tasks/${slow.id}`, { method: 'DELETE' })).status).toBe(409);
    const d = await json<TaskDetail>(await app.request(`/api/tasks/${slow.id}`));
    const errP = waitState(slow.id, 'doing', 'error');
    expect((await post(`/api/runs/${d.runs[0]!.id}/cancel`)).status).toBe(200);
    await errP;
    const restarted = await json<Task>(await post(`/api/tasks/${slow.id}/attempts/discard`));
    expect(restarted.column).toBe('todo');
    expect((await app.request(`/api/tasks/${slow.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/api/tasks/${slow.id}`)).status).toBe(404);
  });

  it('serves the SPA with fallback and keeps /api JSON 404s', async () => {
    expect((await app.request('/api/nothing')).status).toBe(404);
    expect((await json<{ error: { code: string } }>(await app.request('/api/nothing'))).error.code).toBe(
      'NOT_FOUND',
    );
    const index = await app.request('/');
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(await index.text()).toContain('<title>ak</title>');
    expect(await (await app.request('/p/some-id')).text()).toContain('<title>ak</title>');
    const js = await app.request('/assets/app.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
  });

  describe('SSE over a real socket', () => {
    let server: RunningServer;
    beforeAll(async () => {
      server = await startServer({ core, port: 0, webDistDir: webDist });
    });
    afterAll(async () => {
      await server.close();
    });

    it('streams task.updated events filtered by project', async () => {
      const ctrl = new AbortController();
      const res = await fetch(`${server.url}/api/events?project_id=${project.id}`, { signal: ctrl.signal });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const readUntil = async (needle: string) => {
        const deadline = Date.now() + 10_000;
        while (!buffer.includes(needle) && Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value);
        }
        return buffer.includes(needle);
      };
      expect(await readUntil('event: ready')).toBe(true);
      const t = await json<Task>(await post(`/api/projects/${project.id}/tasks`, { title: 'sse task' }));
      expect(await readUntil('event: task.updated')).toBe(true);
      expect(buffer).toContain(`"id":"${t.id}"`);
      ctrl.abort();
    });
  });
});
