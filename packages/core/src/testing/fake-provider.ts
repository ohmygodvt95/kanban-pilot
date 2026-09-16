import type {
  ExternalIssue,
  IssueProvider,
  IssueStatus,
  IssueStatusContext,
  PullRequestInput,
} from '../providers/types.js';
import { classifyLabels, statusComment } from '../providers/types.js';

/** In-memory issue tracker for tests: records comments/closes and serves canned issues. */
export class FakeIssueProvider implements IssueProvider {
  readonly id = 'github' as const;
  readonly comments: { ref: string; body: string }[] = [];
  readonly closed: string[] = [];
  readonly prs: PullRequestInput[] = [];
  issues: ExternalIssue[] = [];

  constructor(private readonly projectRef = 'acme/app') {}

  async check() {
    return { ok: true };
  }
  detectProjectRef(remoteUrl: string): string | null {
    return remoteUrl.includes('fake-tracker') ? this.projectRef : null;
  }
  async listIssues(_ref: string, filter: { labels?: string[]; query?: string }): Promise<ExternalIssue[]> {
    return this.issues
      .filter((i) => !filter.labels?.length || filter.labels.some((l) => i.labels.includes(l)))
      .map((i) => ({ ...i, ...classifyLabels(i.labels) }));
  }
  async getIssue(ref: string): Promise<ExternalIssue> {
    const issue = this.issues.find((i) => i.externalId === ref);
    if (!issue) throw new Error(`no issue ${ref}`);
    return { ...issue, ...classifyLabels(issue.labels) };
  }
  async syncStatus(ref: string, status: IssueStatus, ctx?: IssueStatusContext): Promise<void> {
    this.comments.push({ ref, body: statusComment(status, ctx) });
    if (status === 'done') this.closed.push(ref);
  }
  async addComment(ref: string, body: string): Promise<void> {
    this.comments.push({ ref, body });
  }
  async createPullRequest(_ref: string, input: PullRequestInput): Promise<string> {
    this.prs.push(input);
    return `https://fake-tracker/pr/${this.prs.length}`;
  }
}
