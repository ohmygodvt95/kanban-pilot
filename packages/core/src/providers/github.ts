import { CoreError } from '../util/errors.js';
import {
  classifyLabels,
  type ExternalIssue,
  type IssueProvider,
  type IssueStatus,
  type IssueStatusContext,
  type PullRequestInput,
  statusComment,
} from './types.js';

/**
 * GitHub provider over the REST API. Authenticates with a personal access token
 * from `GITHUB_TOKEN` or `GH_TOKEN` (the same variables `gh` and Copilot use).
 * Issue refs are "owner/repo#123".
 */
export class GitHubIssueProvider implements IssueProvider {
  readonly id = 'github' as const;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly apiBase = env.GITHUB_API_URL || 'https://api.github.com',
  ) {}

  private get token(): string | undefined {
    return this.env.GITHUB_TOKEN || this.env.GH_TOKEN;
  }

  async check() {
    if (!this.token)
      return {
        ok: false,
        message: 'set GITHUB_TOKEN (or GH_TOKEN) to import issues, sync status and open pull requests',
      };
    return { ok: true };
  }

  /** git@github.com:owner/repo.git or https://github.com/owner/repo(.git) → "owner/repo" */
  detectProjectRef(remoteUrl: string): string | null {
    const m = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    return m ? `${m[1]}/${m[2]}` : null;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.token) throw new CoreError('VALIDATION', 'GITHUB_TOKEN is not set');
    const res = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new CoreError(
        'EXECUTOR_ERROR',
        `GitHub API ${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as T;
  }

  private static parseRef(ref: string): { repo: string; number: string } {
    const m = ref.match(/^([^#]+)#(\d+)$/);
    if (!m) throw new CoreError('VALIDATION', `invalid GitHub issue ref "${ref}" (expected owner/repo#123)`);
    return { repo: m[1]!, number: m[2]! };
  }

  private static toIssue(repo: string, raw: GitHubIssue): ExternalIssue {
    const labels = (raw.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
    return {
      externalId: `${repo}#${raw.number}`,
      url: raw.html_url,
      title: raw.title,
      body: raw.body ?? '',
      labels,
      ...classifyLabels(labels),
    };
  }

  async listIssues(
    projectRef: string,
    filter: { labels?: string[]; query?: string },
  ): Promise<ExternalIssue[]> {
    const params = new URLSearchParams({ state: 'open', per_page: '50', sort: 'updated' });
    if (filter.labels?.length) params.set('labels', filter.labels.join(','));
    const raw = await this.request<GitHubIssue[]>(`/repos/${projectRef}/issues?${params}`);
    const q = filter.query?.toLowerCase();
    return raw
      .filter((i) => !i.pull_request) // the issues endpoint also returns PRs
      .filter((i) => !q || i.title.toLowerCase().includes(q) || (i.body ?? '').toLowerCase().includes(q))
      .map((i) => GitHubIssueProvider.toIssue(projectRef, i));
  }

  async getIssue(ref: string): Promise<ExternalIssue> {
    const { repo, number } = GitHubIssueProvider.parseRef(ref);
    return GitHubIssueProvider.toIssue(
      repo,
      await this.request<GitHubIssue>(`/repos/${repo}/issues/${number}`),
    );
  }

  /** Comment on the issue; `done` also closes it. */
  async syncStatus(ref: string, status: IssueStatus, ctx: IssueStatusContext = {}): Promise<void> {
    await this.addComment(ref, statusComment(status, ctx));
    if (status === 'done') {
      const { repo, number } = GitHubIssueProvider.parseRef(ref);
      await this.request(`/repos/${repo}/issues/${number}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
      });
    }
  }

  async addComment(ref: string, body: string): Promise<void> {
    const { repo, number } = GitHubIssueProvider.parseRef(ref);
    await this.request(`/repos/${repo}/issues/${number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  async createPullRequest(projectRef: string, input: PullRequestInput): Promise<string> {
    const pr = await this.request<{ html_url: string }>(`/repos/${projectRef}/pulls`, {
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
  labels?: ({ name: string } | string)[];
  pull_request?: unknown;
}
