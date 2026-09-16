import { describe, expect, it } from 'vitest';
import { githubModule } from './github.js';
import { gitlabModule } from './gitlab.js';
import { buildProvider, createDefaultProviders, detectFromRemote, listProviderModules } from './index.js';
import { jiraModule, jiraWikiToMarkdown } from './jira.js';
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
      'token',
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
    expect((await jira.check()).message).toMatch(/username \+ password, or a personal access token/);
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
      if (/\/issue\/PROJ-7\?fields=status$/.test(u)) return json({ fields: { status: { name: 'To Do' } } });
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
        'project = "PROJ" AND resolution = Unresolved AND assignee = currentUser() AND (labels = agent) ORDER BY updated DESC',
      );
      expect(await jira.listStatuses()).toEqual(['To Do', 'In Progress', 'Done']);
      await jira.setStatus('PROJ-7', 'in progress', { column: 'doing' });
      const post = calls.find((c) => c.url.includes('/transitions') && c.init.method === 'POST')!;
      expect(JSON.parse(String(post.init.body))).toEqual({ transition: { id: '31' } });
      await expect(jira.setStatus('PROJ-7', 'Nowhere', { column: 'review' })).rejects.toThrow(
        /no transition to "Nowhere"/,
      );
      // already in the wanted status → no transition call
      const before = calls.length;
      await jira.setStatus('PROJ-7', 'to do', { column: 'todo' });
      expect(calls.slice(before).some((c) => c.init.method === 'POST')).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('explains Jira CAPTCHA lockouts and prefers a bearer token over basic auth', async () => {
    const original = globalThis.fetch;
    const seen: Record<string, string>[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>);
      return new Response('<html><head><title>Forbidden (403)</title></head></html>', {
        status: 403,
        headers: {
          'X-Authentication-Denied-Reason': 'CAPTCHA_CHALLENGE; login-url=https://jira.example.com/login.jsp',
        },
      });
    }) as typeof fetch;
    try {
      const basic = jiraModule.create(
        cfg({
          baseUrl: 'https://jira.example.com',
          projectRef: 'P',
          username: 'me',
          password: 'pw',
          token: null,
        }),
      );
      const res = await basic.check();
      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/CAPTCHA.*login\.jsp/);
      expect(seen[0]?.Authorization).toBe(`Basic ${Buffer.from('me:pw').toString('base64')}`);
      const pat = jiraModule.create(
        cfg({
          baseUrl: 'https://jira.example.com',
          projectRef: 'P',
          username: 'me',
          password: 'pw',
          token: 'pat-123',
        }),
      );
      await pat.check();
      expect(seen.at(-1)?.Authorization).toBe('Bearer pat-123');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('converts Jira wiki markup to markdown and respects an explicit assignee clause', async () => {
    expect(
      jiraWikiToMarkdown(
        'h2. Goal\r\n\r\n* one\r\n* two\r\n# first\r\n{code:js}\nconst a = 1;\n{code}\nSee [docs|https://x.y] and {{inline}} *bold* _it_',
      ),
    ).toBe(
      '## Goal\n\n- one\n- two\n1. first\n\n```\nconst a = 1;\n```\n\nSee [docs](https://x.y) and `inline` **bold** *it*',
    );
    const original = globalThis.fetch;
    let jql = '';
    globalThis.fetch = (async (_u: string | URL | Request, init?: RequestInit) => {
      jql = JSON.parse(String(init?.body)).jql;
      return new Response(JSON.stringify({ issues: [] }), { status: 200 });
    }) as typeof fetch;
    try {
      await jiraModule
        .create(
          cfg({
            baseUrl: 'https://j',
            projectRef: 'P',
            username: 'me',
            password: 'x',
            token: null,
            importFilter: 'assignee = jdoe',
          }),
        )
        .listIssues();
      expect(jql).not.toContain('currentUser()');
      expect(jql).toContain('(assignee = jdoe)');
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
