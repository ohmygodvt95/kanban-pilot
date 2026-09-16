import type { Column } from '@agent-kanban/shared';
import type {
  CreateIssueInput,
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
  /** A Jira-like type with a required select field, plus a plain one. */
  async createMeta() {
    return {
      issueTypes: [
        {
          id: '10001',
          name: 'Task',
          fields: [
            { key: 'summary', name: 'Summary', required: true, type: 'string' as const },
            { key: 'description', name: 'Description', required: false, type: 'text' as const },
            {
              key: 'priority',
              name: 'Priority',
              required: false,
              type: 'select' as const,
              allowedValues: [{ id: '1', name: 'High' }],
            },
            {
              key: 'components',
              name: 'Component',
              required: true,
              type: 'select' as const,
              allowedValues: [
                { id: 'c1', name: 'Backend' },
                { id: 'c2', name: 'Web' },
              ],
            },
            { key: 'reporter', name: 'Reporter', required: true, type: 'user' as const, hasDefault: true },
          ],
        },
        {
          id: '10004',
          name: 'Bug',
          fields: [{ key: 'summary', name: 'Summary', required: true, type: 'string' as const }],
        },
      ],
    };
  }
  readonly created: CreateIssueInput[] = [];
  async createIssue(input: CreateIssueInput): Promise<ExternalIssue> {
    this.created.push(input);
    const issue: ExternalIssue = {
      externalId: `NEW-${this.created.length}`,
      url: `https://fake-tracker/NEW-${this.created.length}`,
      title: input.title,
      body: input.body,
      labels: input.labels ?? [],
      status: 'Backlog',
    };
    this.issues.push(issue);
    return issue;
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
