import { describe, expect, it } from 'vitest';
import { githubModule } from './github.js';
import { gitlabModule } from './gitlab.js';
import { buildProvider, createDefaultProviders, detectFromRemote, listProviderModules } from './index.js';
import { jiraModule } from './jira.js';
import { classifyLabels, columnForStatus, statusComment, statusForColumn } from './types.js';

const cfg = (over: Record<string, unknown> = {}) => ({
  baseUrl: null,
  projectRef: 'acme/app',
  username: null,
  token: 'tok',
  password: null,
  importFilter: null,
  statusNames: ['in progress', 'done'],
  ...over,
});

describe('provider modules', () => {
  it('lists modules with their form fields', () => {
    const infos = listProviderModules(createDefaultProviders());
    expect(infos.map((i) => i.id).sort()).toEqual(['github', 'gitlab', 'jira']);
    const jira = infos.find((i) => i.id === 'jira')!;
    expect(jira.fields.map((f) => f.key)).toEqual([
      'base_url',
      'project_ref',
      'username',
      'password',
      'import_filter',
    ]);
    expect(jira.statusModel).toBe('workflow');
  });

  it('prefills GitHub / GitLab (cloud + self-hosted) from remote URLs; Jira never', () => {
    expect(githubModule.detectFromRemote('git@github.com:acme/app.git')).toEqual({
      projectRef: 'acme/app',
      baseUrl: null,
    });
    expect(githubModule.detectFromRemote('https://gitlab.com/acme/app.git')).toBeNull();
    expect(gitlabModule.detectFromRemote('git@gitlab.com:group/sub/app.git')).toEqual({
      baseUrl: 'https://gitlab.com',
      projectRef: 'group/sub/app',
    });
    expect(gitlabModule.detectFromRemote('https://oauth2:tok@gitlab.example.com/g/app')).toEqual({
      baseUrl: 'https://gitlab.example.com',
      projectRef: 'g/app',
    });
    expect(jiraModule.detectFromRemote('https://jira.example.com/x')).toBeNull();
    const registry = createDefaultProviders();
    expect(detectFromRemote(registry, 'git@github.com:acme/app.git')?.provider).toBe('github');
    expect(detectFromRemote(registry, null)).toBeNull();
  });

  it('reports missing credentials without network access', async () => {
    const registry = createDefaultProviders();
    const gh = buildProvider(registry, {
      provider: 'github',
      base_url: null,
      project_ref: 'a/b',
      auth: {},
      import_filter: null,
      status_map: { backlog: [], todo: [], doing: [], review: [], done: [] },
    });
    const saved = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_TOKEN: process.env.GH_TOKEN };
    process.env.GITHUB_TOKEN = '';
    process.env.GH_TOKEN = '';
    expect((await gh.check()).ok).toBe(false);
    process.env.GITHUB_TOKEN = saved.GITHUB_TOKEN ?? '';
    process.env.GH_TOKEN = saved.GH_TOKEN ?? '';
    const jira = jiraModule.create(
      cfg({ baseUrl: 'https://jira.example.com', username: 'me', token: null, password: null }),
    );
    expect((await jira.check()).message).toMatch(/username and password/);
    const jiraNoUrl = jiraModule.create(cfg({ baseUrl: null }));
    expect((await jiraNoUrl.check()).message).toMatch(/base URL/);
  });

  it('talks to Jira with basic auth, JQL search and transitions (mocked fetch)', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const u = String(url);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.endsWith('/search')) {
        return json({
          issues: [
            {
              key: 'PROJ-7',
              fields: {
                summary: 'Crash',
                description: 'desc',
                labels: ['agent'],
                status: { name: 'To Do' },
                priority: { name: 'Highest' },
                issuetype: { name: 'Bug' },
              },
            },
          ],
        });
      }
      if (u.includes('/transitions') && init?.method === 'POST') return new Response(null, { status: 204 });
      if (u.includes('/transitions'))
        return json({ transitions: [{ id: '31', name: 'Start Progress', to: { name: 'In Progress' } }] });
      if (u.includes('/statuses'))
        return json([
          { statuses: [{ name: 'To Do' }, { name: 'In Progress' }] },
          { statuses: [{ name: 'In Progress' }, { name: 'Done' }] },
        ]);
      return new Response('nope', { status: 404 });
    }) as typeof fetch;
    try {
      const jira = jiraModule.create(
        cfg({
          baseUrl: 'https://jira.example.com/',
          projectRef: 'PROJ',
          username: 'me',
          password: 's3cret',
          token: null,
          importFilter: 'labels = agent',
        }),
      );
      const issues = await jira.listIssues();
      expect(issues).toEqual([
        {
          externalId: 'PROJ-7',
          url: 'https://jira.example.com/browse/PROJ-7',
          title: 'Crash',
          body: 'desc',
          labels: ['agent'],
          status: 'To Do',
          kind: 'bug',
          priority: 'urgent',
        },
      ]);
      const search = calls.find((c) => c.url.endsWith('/search'))!;
      expect((search.init.headers as Record<string, string>).Authorization).toBe(
        `Basic ${Buffer.from('me:s3cret').toString('base64')}`,
      );
      expect(JSON.parse(String(search.init.body)).jql).toBe(
        'project = "PROJ" AND resolution = Unresolved AND (labels = agent) ORDER BY updated DESC',
      );
      expect(await jira.listStatuses()).toEqual(['To Do', 'In Progress', 'Done']);
      await jira.setStatus('PROJ-7', 'in progress', { column: 'doing' });
      const post = calls.find((c) => c.url.includes('/transitions') && c.init.method === 'POST')!;
      expect(JSON.parse(String(post.init.body))).toEqual({ transition: { id: '31' } });
      await expect(jira.setStatus('PROJ-7', 'Nowhere', { column: 'review' })).rejects.toThrow(
        /no transition to "Nowhere"/,
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it('maps statuses ↔ columns and classifies labels', () => {
    const map = {
      backlog: ['Backlog'],
      todo: ['To Do', 'Selected'],
      doing: ['In Progress'],
      review: ['In Review'],
      done: ['Done'],
    };
    expect(columnForStatus(map, 'selected')).toBe('todo');
    expect(columnForStatus(map, 'unknown')).toBeNull();
    expect(statusForColumn(map, 'review')).toBe('In Review');
    expect(classifyLabels(['bug', 'priority::high'])).toEqual({ kind: 'bug', priority: 'high' });
    expect(classifyLabels(['story', 'P0'])).toEqual({ kind: 'feature', priority: 'urgent' });
    expect(statusComment({ column: 'review', branch: 'ak/x', prUrl: 'https://p/r/1' })).toContain(
      'https://p/r/1',
    );
  });
});
