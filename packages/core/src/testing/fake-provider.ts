import type { Column } from '@agent-kanban/shared';
import type {
  ExternalIssue,
  IssueProvider,
  ProviderConfig,
  ProviderModule,
  PullRequestInput,
  SyncContext,
} from '../providers/types.js';
import { classifyLabels } from '../providers/types.js';

/** In-memory tracker for tests: records status changes/comments and serves canned issues. */
export class FakeIssueProvider implements IssueProvider {
  readonly id = 'github' as const;
  readonly comments: { ref: string; body: string }[] = [];
  readonly statuses: { ref: string; status: string; column: Column }[] = [];
  readonly prs: PullRequestInput[] = [];
  issues: ExternalIssue[] = [];
  remoteStatuses = ['Backlog', 'Ready', 'In Progress', 'In Review', 'Done'];
  lastConfig: ProviderConfig | null = null;

  async check() {
    return this.lastConfig?.token === 'bad'
      ? { ok: false, message: 'bad token' }
      : { ok: true, message: 'fake ok' };
  }
  async listIssues(): Promise<ExternalIssue[]> {
    const labels = (this.lastConfig?.importFilter ?? '')
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
    return this.issues
      .filter((i) => !labels.length || labels.some((l) => i.labels.includes(l)))
      .map((i) => ({ ...i, ...classifyLabels(i.labels) }));
  }
  async getIssue(id: string): Promise<ExternalIssue> {
    const issue = this.issues.find((i) => i.externalId === id);
    if (!issue) throw new Error(`no issue ${id}`);
    return { ...issue, ...classifyLabels(issue.labels) };
  }
  async listStatuses() {
    return this.remoteStatuses;
  }
  async setStatus(ref: string, status: string, ctx: SyncContext) {
    this.statuses.push({ ref, status, column: ctx.column });
  }
  async addComment(ref: string, body: string) {
    this.comments.push({ ref, body });
  }
  async createPullRequest(input: PullRequestInput): Promise<string> {
    this.prs.push(input);
    return `https://fake-tracker/pr/${this.prs.length}`;
  }
}

/** Module wrapper so tests can register the fake provider under the "github" id. */
export function fakeProviderModule(instance: FakeIssueProvider): ProviderModule {
  return {
    info: {
      id: 'github',
      displayName: 'Fake tracker',
      description: 'test double',
      statusModel: 'labels',
      supportsPullRequests: true,
      defaultStatusMap: {
        backlog: ['Backlog'],
        todo: ['Ready'],
        doing: ['In Progress'],
        review: ['In Review'],
        done: ['Done'],
      },
      fields: [{ key: 'project_ref', label: 'Project', type: 'text', required: true }],
    },
    detectFromRemote: (url) =>
      url.includes('fake-tracker') ? { projectRef: 'acme/app', baseUrl: null } : null,
    create: (cfg) => {
      instance.lastConfig = cfg;
      return instance;
    },
  };
}
