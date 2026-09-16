import type { ProviderId } from '@agent-kanban/shared';

export interface ExternalIssue {
  externalId: string;
  url: string;
  title: string;
  body: string;
  labels: string[];
}

export interface PullRequestInput {
  head: string;
  base: string;
  title: string;
  body: string;
}

/**
 * Issue tracker integration. `projectRef` identifies the remote project
 * (GitHub: "owner/repo", derived from the origin remote).
 */
export interface IssueProvider {
  readonly id: ProviderId;
  /** Whether credentials are available; `message` explains what is missing. */
  check(): Promise<{ ok: boolean; message?: string }>;
  /** Derive `projectRef` from a git remote URL, or null if this provider does not host it. */
  detectProjectRef(remoteUrl: string): string | null;
  listIssues(projectRef: string, filter: { labels?: string[]; query?: string }): Promise<ExternalIssue[]>;
  getIssue(ref: string): Promise<ExternalIssue>;
  syncStatus(ref: string, status: 'in_progress' | 'in_review' | 'done'): Promise<void>;
  addComment(ref: string, body: string): Promise<void>;
  /** Open a pull/merge request and return its URL. */
  createPullRequest?(projectRef: string, input: PullRequestInput): Promise<string>;
}
