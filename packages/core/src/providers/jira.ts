import type { Column, TaskKind, TaskPriority } from '@agent-kanban/shared';
import type { ExternalIssue, IssueProvider, ProviderConfig, ProviderModule, SyncContext } from './types.js';
import { classifyLabels, HttpError, jsonRequest } from './types.js';

/**
 * Jira Server / Data Center 8.x (self-hosted) over REST API v2. Two auth modes:
 *  - **basic auth**: username + password (Jira 8.x),
 *  - **personal access token** (Jira DC ≥ 8.14): `Authorization: Bearer <token>`; no password, immune to CAPTCHA.
 * `projectRef` is the project key (e.g. "PROJ"); statuses are the workflow statuses, changed through transitions.
 */
class JiraProvider implements IssueProvider {
  readonly id = 'jira' as const;
  private readonly api: string;
  private readonly authHeader: string | null;

  constructor(private readonly cfg: ProviderConfig) {
    this.api = `${(cfg.baseUrl ?? '').replace(/\/+$/, '')}/rest/api/2`;
    if (cfg.token) this.authHeader = `Bearer ${cfg.token}`;
    else if (cfg.username && cfg.password) {
      this.authHeader = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`;
    } else this.authHeader = null;
  }

  /**
   * Turn Jira's 401/403 into actionable text. Jira signals a locked account with
   * `X-Authentication-Denied-Reason: CAPTCHA_CHALLENGE; login-url=…` — basic auth
   * stays rejected until the user logs in once in a browser and solves the CAPTCHA.
   */
  private static explain(err: unknown): string {
    if (err instanceof HttpError) {
      const reason = err.headers.get('x-authentication-denied-reason');
      if (reason?.includes('CAPTCHA_CHALLENGE')) {
        const login = reason.match(/login-url=(\S+)/)?.[1] ?? 'the Jira login page';
        return `Jira requires a CAPTCHA for this account (too many failed logins). Log in once at ${login} in a browser, then test again — or use a personal access token instead of the password.`;
      }
      if (reason) return `${err.message} (Jira: ${reason})`;
      if (err.status === 401) return `${err.message} — wrong username/password or token`;
      if (err.status === 403)
        return `${err.message} — the account lacks permission for this project, or the API is blocked by a proxy`;
    }
    return (err as Error).message;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.cfg.baseUrl) throw new Error('Jira URL is not configured');
    if (!this.authHeader)
      throw new Error(
        'Jira credentials are not configured (username + password, or a personal access token)',
      );
    try {
      return await jsonRequest<T>(
        `${this.api}${path}`,
        {
          ...init,
          headers: {
            Authorization: this.authHeader,
            Accept: 'application/json',
            // Jira skips XSRF checks for REST calls carrying this header (harmless on GET).
            'X-Atlassian-Token': 'no-check',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          },
        },
        `Jira ${init.method ?? 'GET'} ${path}`,
      );
    } catch (err) {
      throw new Error(JiraProvider.explain(err));
    }
  }

  async check() {
    if (!this.cfg.baseUrl) return { ok: false, message: 'enter the Jira base URL' };
    if (!this.authHeader)
      return { ok: false, message: 'enter username + password, or a personal access token' };
    try {
      const me = await this.request<{ displayName?: string; name?: string }>('/myself');
      const project = await this.request<{ key: string; name: string }>(
        `/project/${encodeURIComponent(this.cfg.projectRef)}`,
      );
      return {
        ok: true,
        message: `connected as ${me.displayName ?? me.name ?? 'user'} to ${project.key} (${project.name})`,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  private toIssue(raw: JiraIssue): ExternalIssue {
    const f = raw.fields;
    const labels = f.labels ?? [];
    const fromLabels = classifyLabels(labels);
    const type = (f.issuetype?.name ?? '').toLowerCase();
    const kind: TaskKind | null =
      fromLabels.kind ??
      (type === 'bug'
        ? 'bug'
        : /story|feature|epic/.test(type)
          ? 'feature'
          : /task|sub-task/.test(type)
            ? 'task'
            : null);
    const prio = (f.priority?.name ?? '').toLowerCase();
    const priority: TaskPriority | null =
      fromLabels.priority ??
      (/highest|blocker|critical/.test(prio)
        ? 'urgent'
        : prio === 'high'
          ? 'high'
          : /low|lowest|minor|trivial/.test(prio)
            ? 'low'
            : prio
              ? 'medium'
              : null);
    const browse = `${(this.cfg.baseUrl ?? '').replace(/\/+$/, '')}/browse/${raw.key}`;
    return {
      externalId: raw.key,
      url: browse,
      title: f.summary,
      body: f.description ?? '',
      labels,
      status: f.status?.name ?? null,
      kind,
      priority,
    };
  }

  /**
   * `import_filter` is a JQL fragment; the project key and `resolution = Unresolved`
   * are always enforced, and issues are limited to the current user unless the
   * filter mentions `assignee` itself.
   */
  async listIssues(filter: { query?: string } = {}): Promise<ExternalIssue[]> {
    const parts = [`project = "${this.cfg.projectRef}"`, 'resolution = Unresolved'];
    const extra = this.cfg.importFilter?.trim();
    if (!/assignee/i.test(extra ?? '')) parts.push('assignee = currentUser()');
    if (extra) parts.push(`(${extra})`);
    if (filter.query?.trim()) parts.push(`text ~ "${filter.query.trim().replace(/"/g, '\\"')}"`);
    const jql = `${parts.join(' AND ')} ORDER BY updated DESC`;
    const res = await this.request<{ issues: JiraIssue[] }>('/search', {
      method: 'POST',
      body: JSON.stringify({
        jql,
        maxResults: 50,
        fields: ['summary', 'description', 'labels', 'status', 'priority', 'issuetype'],
      }),
    });
    return res.issues.map((i) => this.toIssue(i));
  }

  async getIssue(externalId: string): Promise<ExternalIssue> {
    return this.toIssue(
      await this.request<JiraIssue>(
        `/issue/${encodeURIComponent(externalId)}?fields=summary,description,labels,status,priority,issuetype`,
      ),
    );
  }

  /** Statuses of the project's workflows (deduplicated). */
  async listStatuses(): Promise<string[]> {
    const types = await this.request<{ statuses: { name: string }[] }[]>(
      `/project/${encodeURIComponent(this.cfg.projectRef)}/statuses`,
    );
    return [...new Set(types.flatMap((t) => t.statuses.map((s) => s.name)))];
  }

  /** Find the transition leading to `status` and execute it; a no-op when the issue is already there. */
  async setStatus(externalId: string, status: string, _ctx: SyncContext): Promise<void> {
    const key = encodeURIComponent(externalId);
    const wantedStatus = status.trim().toLowerCase();
    const current = await this.request<{ fields: { status?: { name: string } } }>(
      `/issue/${key}?fields=status`,
    );
    if (current.fields.status?.name.toLowerCase() === wantedStatus) return;
    const { transitions } = await this.request<{
      transitions: { id: string; name: string; to: { name: string } }[];
    }>(`/issue/${key}/transitions`);
    const wanted = status.trim().toLowerCase();
    const t =
      transitions.find((x) => x.to.name.toLowerCase() === wanted) ??
      transitions.find((x) => x.name.toLowerCase() === wanted);
    if (!t)
      throw new Error(
        `no transition to "${status}" from the current status (available: ${transitions.map((x) => x.to.name).join(', ') || 'none'})`,
      );
    await this.request(`/issue/${key}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: t.id } }),
    });
  }

  async addComment(externalId: string, body: string): Promise<void> {
    await this.request(`/issue/${encodeURIComponent(externalId)}/comment`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }
}

/**
 * Best-effort conversion of Jira wiki markup (Jira Server descriptions) to markdown:
 * headings, bold/italic, lists, {code}/{noformat} blocks, links and line endings.
 */
export function jiraWikiToMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(
      /\{code(?::[^}]*)?\}([\s\S]*?)\{code\}/g,
      (_m, body: string) => `\n\`\`\`\n${body.trim()}\n\`\`\`\n`,
    )
    .replace(
      /\{noformat\}([\s\S]*?)\{noformat\}/g,
      (_m, body: string) => `\n\`\`\`\n${body.trim()}\n\`\`\`\n`,
    )
    .replace(/\{quote\}([\s\S]*?)\{quote\}/g, (_m, body: string) =>
      body
        .trim()
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n'),
    )
    .replace(
      /^h([1-6])\.\s*(.*)$/gm,
      (_m, level: string, title: string) => `${'#'.repeat(Number(level))} ${title}`,
    )
    .replace(/^[ \t]*[*-][ \t]+/gm, '- ')
    .replace(/^[ \t]*#[ \t]+/gm, '1. ')
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '[$1]($2)')
    .replace(/\{\{([^}]+)\}\}/g, '`$1`')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:])/g, '$1**$2**')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:])/g, '$1*$2*')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description: string | null;
    labels?: string[];
    status?: { name: string };
    priority?: { name: string };
    issuetype?: { name: string };
  };
}

const DEFAULT_STATUS_MAP: Record<Column, string[]> = {
  backlog: ['Backlog', 'Open'],
  todo: ['To Do', 'Selected for Development'],
  doing: ['In Progress'],
  review: ['In Review', 'Code Review'],
  done: ['Done', 'Closed', 'Resolved'],
};

export const jiraModule: ProviderModule = {
  info: {
    id: 'jira',
    displayName: 'Jira (Server / Data Center)',
    description:
      'Self-hosted Jira 8.x via REST API v2 with basic auth. Statuses are workflow statuses; the status map drives transitions.',
    statusModel: 'workflow',
    supportsPullRequests: false,
    defaultStatusMap: DEFAULT_STATUS_MAP,
    fields: [
      {
        key: 'base_url',
        label: 'Jira URL',
        type: 'url',
        placeholder: 'https://jira.example.com',
        required: true,
      },
      { key: 'project_ref', label: 'Project key', type: 'text', placeholder: 'PROJ', required: true },
      { key: 'username', label: 'Username', type: 'text', help: 'For basic auth (username + password).' },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        help: 'Sent as HTTP basic auth. If Jira answers with a CAPTCHA challenge, log in once in a browser or use a token instead.',
      },
      {
        key: 'token',
        label: 'Personal access token (alternative)',
        type: 'password',
        help: 'Jira DC 8.14+: Profile → Personal Access Tokens. Sent as Bearer; wins over username/password when set. Stored locally.',
      },
      {
        key: 'import_filter',
        label: 'Import JQL',
        type: 'textarea',
        placeholder: 'labels = agent AND assignee = currentUser()',
        help: 'Appended to project = KEY AND resolution = Unresolved AND assignee = currentUser(). Mention assignee yourself to override that part.',
      },
    ],
  },
  detectFromRemote() {
    return null; // Jira is never derived from a git remote
  },
  create(cfg) {
    return new JiraProvider(cfg);
  },
};
