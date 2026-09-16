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

/** GitLab.com or self-hosted; `projectRef` is the project path ("group/sub/project"). */
class GitLabProvider implements IssueProvider {
  readonly id = 'gitlab' as const;
  private readonly api: string;
  private readonly project: string;
  private readonly token: string | null;

  constructor(private readonly cfg: ProviderConfig) {
    const base = (cfg.baseUrl || 'https://gitlab.com').replace(/\/+$/, '').replace(/\/api\/v4$/, '');
    this.api = `${base}/api/v4`;
    this.project = encodeURIComponent(cfg.projectRef.replace(/^\/+|\/+$/g, ''));
    this.token = cfg.token || process.env.GITLAB_TOKEN || null;
  }

  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.token) throw new Error('GitLab token is not configured');
    return jsonRequest<T>(
      `${this.api}${path}`,
      {
        ...init,
        headers: {
          'PRIVATE-TOKEN': this.token,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      `GitLab ${init.method ?? 'GET'} ${path}`,
    );
  }

  async check() {
    if (!this.token)
      return { ok: false, message: 'no token: enter an access token (scope api) or set GITLAB_TOKEN' };
    try {
      const p = await this.request<{ path_with_namespace: string }>(`/projects/${this.project}`);
      return { ok: true, message: `connected to ${p.path_with_namespace}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  private toIssue(raw: GitLabIssue): ExternalIssue {
    const labels = raw.labels ?? [];
    const known = this.cfg.statusNames.map((s) => s.toLowerCase());
    const status =
      labels.find((l) => known.includes(l.toLowerCase())) ?? (raw.state === 'closed' ? 'closed' : null);
    return {
      externalId: String(raw.iid),
      url: raw.web_url,
      title: raw.title,
      body: raw.description ?? '',
      labels,
      status,
      ...classifyLabels(labels),
    };
  }

  async listIssues(filter: { query?: string } = {}): Promise<ExternalIssue[]> {
    const params = new URLSearchParams({ state: 'opened', per_page: '50', order_by: 'updated_at' });
    const labels = (this.cfg.importFilter ?? '')
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
    if (labels.length) params.set('labels', labels.join(','));
    if (filter.query) params.set('search', filter.query);
    return (await this.request<GitLabIssue[]>(`/projects/${this.project}/issues?${params}`)).map((i) =>
      this.toIssue(i),
    );
  }

  async getIssue(externalId: string): Promise<ExternalIssue> {
    return this.toIssue(await this.request<GitLabIssue>(`/projects/${this.project}/issues/${externalId}`));
  }

  async listStatuses(): Promise<string[]> {
    const labels = await this.request<{ name: string }[]>(`/projects/${this.project}/labels?per_page=100`);
    return labels.map((l) => l.name);
  }

  async setStatus(externalId: string, status: string, ctx: SyncContext): Promise<void> {
    const issue = await this.request<GitLabIssue>(`/projects/${this.project}/issues/${externalId}`);
    const alreadyThere =
      (issue.labels ?? []).some((l) => l.toLowerCase() === status.toLowerCase()) &&
      (issue.state === 'closed') === (ctx.column === 'done');
    if (alreadyThere) return;
    const workflow = this.cfg.statusNames.map((s) => s.toLowerCase());
    const labels = [...(issue.labels ?? []).filter((l) => !workflow.includes(l.toLowerCase())), status];
    await this.request(`/projects/${this.project}/issues/${externalId}`, {
      method: 'PUT',
      body: JSON.stringify({
        labels: labels.join(','),
        state_event: ctx.column === 'done' ? 'close' : 'reopen',
      }),
    });
  }

  async addComment(externalId: string, body: string): Promise<void> {
    await this.request(`/projects/${this.project}/issues/${externalId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  /** Merge request (GitLab's pull request). */
  async createPullRequest(input: PullRequestInput): Promise<string> {
    const mr = await this.request<{ web_url: string }>(`/projects/${this.project}/merge_requests`, {
      method: 'POST',
      body: JSON.stringify({
        source_branch: input.head,
        target_branch: input.base,
        title: input.title,
        description: input.body,
      }),
    });
    return mr.web_url;
  }
}

interface GitLabIssue {
  iid: number;
  web_url: string;
  title: string;
  description: string | null;
  state: 'opened' | 'closed';
  labels?: string[];
}

const DEFAULT_STATUS_MAP: Record<Column, string[]> = {
  backlog: ['workflow::backlog'],
  todo: ['workflow::ready'],
  doing: ['workflow::in progress'],
  review: ['workflow::in review'],
  done: ['workflow::done'],
};

export const gitlabModule: ProviderModule = {
  info: {
    id: 'gitlab',
    displayName: 'GitLab',
    description:
      'GitLab.com or self-hosted. Statuses are (scoped) labels such as workflow::in progress; Done also closes the issue.',
    statusModel: 'labels',
    supportsPullRequests: true,
    defaultStatusMap: DEFAULT_STATUS_MAP,
    fields: [
      {
        key: 'base_url',
        label: 'GitLab URL',
        type: 'url',
        placeholder: 'https://gitlab.com',
        help: 'Self-hosted: https://gitlab.example.com',
        required: true,
      },
      {
        key: 'project_ref',
        label: 'Project path',
        type: 'text',
        placeholder: 'group/subgroup/project',
        required: true,
      },
      {
        key: 'token',
        label: 'Access token',
        type: 'password',
        help: 'Personal or project access token with scope api. Falls back to GITLAB_TOKEN when empty.',
      },
      {
        key: 'import_filter',
        label: 'Import labels',
        type: 'text',
        placeholder: 'agent',
        help: 'Comma-separated; empty = all open issues.',
      },
    ],
  },
  detectFromRemote(remoteUrl) {
    const ssh = remoteUrl.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?\/?$/i);
    const http = remoteUrl.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/i);
    const m = ssh ?? http;
    if (!m || !/gitlab/i.test(m[1]!)) return null;
    return { baseUrl: `https://${m[1]}`, projectRef: m[2]! };
  },
  create(cfg) {
    return new GitLabProvider(cfg);
  },
};
