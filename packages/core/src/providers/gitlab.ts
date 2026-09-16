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
 * GitLab provider (gitlab.com and self-hosted) over REST API v4. Authenticates
 * with a personal/project access token from `GITLAB_TOKEN` (scope `api`).
 * `projectRef` is the full project URL ("https://gitlab.example.com/group/sub/project")
 * so self-hosted instances work; issue refs are "<projectRef>#<iid>".
 */
export class GitLabIssueProvider implements IssueProvider {
  readonly id = 'gitlab' as const;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  private get token(): string | undefined {
    return this.env.GITLAB_TOKEN;
  }

  async check() {
    if (!this.token)
      return {
        ok: false,
        message: 'set GITLAB_TOKEN (scope: api) to import issues, sync status and open merge requests',
      };
    return { ok: true };
  }

  /**
   * git@gitlab.com:group/project.git, https://gitlab.example.com/group/sub/project.git →
   * "https://<host>/group/sub/project". Any host containing "gitlab" is accepted.
   */
  detectProjectRef(remoteUrl: string): string | null {
    const ssh = remoteUrl.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?\/?$/i);
    const http = remoteUrl.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/i);
    const m = ssh ?? http;
    if (!m || !/gitlab/i.test(m[1]!)) return null;
    return `https://${m[1]}/${m[2]}`;
  }

  /** Split a projectRef into API base + URL-encoded project path. */
  private static parseProject(projectRef: string): { api: string; project: string } {
    const m = projectRef.match(/^(https?:\/\/[^/]+)\/(.+)$/);
    if (!m)
      throw new CoreError(
        'VALIDATION',
        `invalid GitLab project ref "${projectRef}" (expected https://host/group/project)`,
      );
    return { api: `${m[1]}/api/v4`, project: encodeURIComponent(m[2]!) };
  }

  private static parseRef(ref: string): { projectRef: string; iid: string } {
    const m = ref.match(/^(.+)#(\d+)$/);
    if (!m)
      throw new CoreError(
        'VALIDATION',
        `invalid GitLab issue ref "${ref}" (expected https://host/group/project#123)`,
      );
    return { projectRef: m[1]!, iid: m[2]! };
  }

  private async request<T>(api: string, path: string, init: RequestInit = {}): Promise<T> {
    if (!this.token) throw new CoreError('VALIDATION', 'GITLAB_TOKEN is not set');
    const res = await fetch(`${api}${path}`, {
      ...init,
      headers: {
        'PRIVATE-TOKEN': this.token,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new CoreError(
        'EXECUTOR_ERROR',
        `GitLab API ${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as T;
  }

  private static toIssue(projectRef: string, raw: GitLabIssue): ExternalIssue {
    const labels = raw.labels ?? [];
    return {
      externalId: `${projectRef}#${raw.iid}`,
      url: raw.web_url,
      title: raw.title,
      body: raw.description ?? '',
      labels,
      ...classifyLabels(labels),
    };
  }

  async listIssues(
    projectRef: string,
    filter: { labels?: string[]; query?: string },
  ): Promise<ExternalIssue[]> {
    const { api, project } = GitLabIssueProvider.parseProject(projectRef);
    const params = new URLSearchParams({ state: 'opened', per_page: '50', order_by: 'updated_at' });
    if (filter.labels?.length) params.set('labels', filter.labels.join(','));
    if (filter.query) params.set('search', filter.query);
    const raw = await this.request<GitLabIssue[]>(api, `/projects/${project}/issues?${params}`);
    return raw.map((i) => GitLabIssueProvider.toIssue(projectRef, i));
  }

  async getIssue(ref: string): Promise<ExternalIssue> {
    const { projectRef, iid } = GitLabIssueProvider.parseRef(ref);
    const { api, project } = GitLabIssueProvider.parseProject(projectRef);
    return GitLabIssueProvider.toIssue(
      projectRef,
      await this.request<GitLabIssue>(api, `/projects/${project}/issues/${iid}`),
    );
  }

  async syncStatus(ref: string, status: IssueStatus, ctx: IssueStatusContext = {}): Promise<void> {
    await this.addComment(ref, statusComment(status, ctx));
    if (status === 'done') {
      const { projectRef, iid } = GitLabIssueProvider.parseRef(ref);
      const { api, project } = GitLabIssueProvider.parseProject(projectRef);
      await this.request(api, `/projects/${project}/issues/${iid}`, {
        method: 'PUT',
        body: JSON.stringify({ state_event: 'close' }),
      });
    }
  }

  async addComment(ref: string, body: string): Promise<void> {
    const { projectRef, iid } = GitLabIssueProvider.parseRef(ref);
    const { api, project } = GitLabIssueProvider.parseProject(projectRef);
    await this.request(api, `/projects/${project}/issues/${iid}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  /** Merge request (GitLab's pull request). */
  async createPullRequest(projectRef: string, input: PullRequestInput): Promise<string> {
    const { api, project } = GitLabIssueProvider.parseProject(projectRef);
    const mr = await this.request<{ web_url: string }>(api, `/projects/${project}/merge_requests`, {
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
  labels?: string[];
}
