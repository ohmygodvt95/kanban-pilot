import type { Column } from '@agent-kanban/shared';
import type {
  ExternalIssue,
  IssueProvider,
  ProviderConfig,
  ProviderModule,
  PullRequestInput,
  SyncContext,
} from './types.js';
import { classifyLabels, jsonRequest } from './types.js';

const DEFAULT_API = 'https://api.github.com';

/** Labels treated as "status" by the status map are workflow labels on the repo. */
class GitHubProvider implements IssueProvider {
  readonly id = 'github' as const;
  private readonly api: string;
  private readonly token: string | null;

  constructor(private readonly cfg: ProviderConfig) {
    this.api = (cfg.baseUrl?.replace(/\/+$/, '') || DEFAULT_API).replace(/\/api\/v3$/, '/api/v3');
    this.token = cfg.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  }

  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.token) throw new Error('GitHub token is not configured');
    return jsonRequest<T>(
      `${this.api}${path}`,
      {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      `GitHub ${init.method ?? 'GET'} ${path}`,
    );
  }

  async check() {
    if (!this.token)
      return {
        ok: false,
        message: 'no token: enter a personal access token (repo scope) or set GITHUB_TOKEN',
      };
    try {
      const repo = await this.request<{ full_name: string; permissions?: { push?: boolean } }>(
        `/repos/${this.cfg.projectRef}`,
      );
      return {
        ok: true,
        message: `connected to ${repo.full_name}${repo.permissions?.push === false ? ' (read-only)' : ''}`,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  private toIssue(raw: GitHubIssue): ExternalIssue {
    const labels = (raw.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
    const known = this.cfg.statusNames.map((s) => s.toLowerCase());
    const status =
      labels.find((l) => known.includes(l.toLowerCase())) ?? (raw.state === 'closed' ? 'closed' : null);
    return {
      externalId: String(raw.number),
      url: raw.html_url,
      title: raw.title,
      body: raw.body ?? '',
      labels,
      status,
      ...classifyLabels(labels),
    };
  }

  async listIssues(filter: { query?: string } = {}): Promise<ExternalIssue[]> {
    const params = new URLSearchParams({ state: 'open', per_page: '50', sort: 'updated' });
    const labels = (this.cfg.importFilter ?? '')
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
    if (labels.length) params.set('labels', labels.join(','));
    const raw = await this.request<GitHubIssue[]>(`/repos/${this.cfg.projectRef}/issues?${params}`);
    const q = filter.query?.toLowerCase();
    return raw
      .filter((i) => !i.pull_request) // the issues endpoint also returns PRs
      .filter((i) => !q || i.title.toLowerCase().includes(q) || (i.body ?? '').toLowerCase().includes(q))
      .map((i) => this.toIssue(i));
  }

  async getIssue(externalId: string): Promise<ExternalIssue> {
    return this.toIssue(
      await this.request<GitHubIssue>(`/repos/${this.cfg.projectRef}/issues/${externalId}`),
    );
  }

  /** Repository labels double as statuses. */
  async listStatuses(): Promise<string[]> {
    const labels = await this.request<{ name: string }[]>(
      `/repos/${this.cfg.projectRef}/labels?per_page=100`,
    );
    return labels.map((l) => l.name);
  }

  /** Swap workflow labels; closing/reopening follows the column. */
  async setStatus(externalId: string, status: string, ctx: SyncContext): Promise<void> {
    const issue = await this.request<GitHubIssue>(`/repos/${this.cfg.projectRef}/issues/${externalId}`);
    const current = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
    const workflow = this.cfg.statusNames.map((s) => s.toLowerCase());
    const labels = [...current.filter((l) => !workflow.includes(l.toLowerCase())), status];
    await this.request(`/repos/${this.cfg.projectRef}/issues/${externalId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        labels,
        state: ctx.column === 'done' ? 'closed' : 'open',
        ...(ctx.column === 'done' ? { state_reason: 'completed' } : {}),
      }),
    });
  }

  async addComment(externalId: string, body: string): Promise<void> {
    await this.request(`/repos/${this.cfg.projectRef}/issues/${externalId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  async createPullRequest(input: PullRequestInput): Promise<string> {
    const pr = await this.request<{ html_url: string }>(`/repos/${this.cfg.projectRef}/pulls`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return pr.html_url;
  }
}

interface GitHubIssue {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels?: ({ name: string } | string)[];
  pull_request?: unknown;
}

const DEFAULT_STATUS_MAP: Record<Column, string[]> = {
  backlog: ['backlog'],
  todo: ['ready'],
  doing: ['in progress'],
  review: ['in review'],
  done: ['done'],
};

export const githubModule: ProviderModule = {
  info: {
    id: 'github',
    displayName: 'GitHub',
    description:
      'GitHub.com or GitHub Enterprise. Statuses are workflow labels on the repository; Done also closes the issue.',
    statusModel: 'labels',
    supportsPullRequests: true,
    defaultStatusMap: DEFAULT_STATUS_MAP,
    fields: [
      {
        key: 'base_url',
        label: 'API URL',
        type: 'url',
        placeholder: 'https://api.github.com',
        help: 'GitHub Enterprise: https://ghe.example.com/api/v3',
      },
      { key: 'project_ref', label: 'Repository', type: 'text', placeholder: 'owner/repo', required: true },
      {
        key: 'token',
        label: 'Personal access token',
        type: 'password',
        help: 'Scope: repo. Falls back to GITHUB_TOKEN / GH_TOKEN from the environment when empty.',
      },
      {
        key: 'import_filter',
        label: 'Import labels',
        type: 'text',
        placeholder: 'agent, ready-for-ai',
        help: 'Comma-separated; open issues with one of these labels are imported. Empty = all open issues.',
      },
    ],
  },
  detectFromRemote(remoteUrl) {
    const m = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    return m ? { projectRef: `${m[1]}/${m[2]}`, baseUrl: null } : null;
  },
  create(cfg) {
    return new GitHubProvider(cfg);
  },
};
