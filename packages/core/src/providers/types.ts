import type { ProviderId, TaskKind, TaskPriority } from '@agent-kanban/shared';

export interface ExternalIssue {
  externalId: string;
  url: string;
  title: string;
  body: string;
  labels: string[];
  /** Guessed from labels; null when the labels say nothing. */
  kind?: TaskKind | null;
  priority?: TaskPriority | null;
}

export interface PullRequestInput {
  head: string;
  base: string;
  title: string;
  body: string;
}

export type IssueStatus = 'in_progress' | 'in_review' | 'done';

/** Extra context for status comments (branch, PR link). */
export interface IssueStatusContext {
  branch?: string | null;
  prUrl?: string | null;
  taskTitle?: string;
}

/**
 * Issue tracker integration. `projectRef` identifies the remote project:
 * GitHub "owner/repo", GitLab the full project URL ("https://gitlab.com/group/project").
 * Issue refs are "<projectRef>#<number>".
 */
export interface IssueProvider {
  readonly id: ProviderId;
  /** Whether credentials are available; `message` explains what is missing. */
  check(): Promise<{ ok: boolean; message?: string }>;
  /** Derive `projectRef` from a git remote URL, or null if this provider does not host it. */
  detectProjectRef(remoteUrl: string): string | null;
  listIssues(projectRef: string, filter: { labels?: string[]; query?: string }): Promise<ExternalIssue[]>;
  getIssue(ref: string): Promise<ExternalIssue>;
  /** Mirror a task milestone on the issue (comment; `done` also closes it). */
  syncStatus(ref: string, status: IssueStatus, ctx?: IssueStatusContext): Promise<void>;
  addComment(ref: string, body: string): Promise<void>;
  /** Open a pull/merge request and return its URL. */
  createPullRequest?(projectRef: string, input: PullRequestInput): Promise<string>;
}

/** Map tracker labels to a task kind / priority (shared by all providers). */
export function classifyLabels(labels: string[]): { kind: TaskKind | null; priority: TaskPriority | null } {
  const norm = labels.map((l) => l.toLowerCase());
  let kind: TaskKind | null = null;
  if (norm.some((l) => /\b(bug|defect|regression)\b/.test(l))) kind = 'bug';
  else if (norm.some((l) => /\b(feature|enhancement|epic)\b/.test(l))) kind = 'feature';
  else if (norm.some((l) => /\b(chore|maintenance|refactor|dependencies|docs)\b/.test(l))) kind = 'chore';
  let priority: TaskPriority | null = null;
  for (const l of norm) {
    if (/(urgent|critical|blocker|p0|priority::?\s*(0|critical|urgent))/.test(l)) priority = 'urgent';
    else if (/(\bhigh\b|p1|priority::?\s*(1|high))/.test(l) && priority !== 'urgent') priority = 'high';
    else if (/(\blow\b|p3|priority::?\s*(3|low))/.test(l) && !priority) priority = 'low';
    else if (/(\bmedium\b|p2|priority::?\s*(2|medium))/.test(l) && !priority) priority = 'medium';
  }
  return { kind, priority };
}

/** Text of the status comment posted on the issue. */
export function statusComment(status: IssueStatus, ctx: IssueStatusContext = {}): string {
  const branch = ctx.branch ? ` (branch \`${ctx.branch}\`)` : '';
  switch (status) {
    case 'in_progress':
      return `🤖 agent-kanban: an agent started working on this${branch}.`;
    case 'in_review':
      return `🤖 agent-kanban: changes are ready for review${branch}.${ctx.prUrl ? ` ${ctx.prUrl}` : ''}`;
    case 'done':
      return `🤖 agent-kanban: done${branch}.${ctx.prUrl ? ` ${ctx.prUrl}` : ' Merged locally.'}`;
  }
}
