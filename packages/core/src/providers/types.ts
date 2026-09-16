import type { ProviderId } from '@agent-kanban/shared';

export interface ExternalIssue {
  externalId: string;
  url: string;
  title: string;
  body: string;
  labels: string[];
}

/** Issue tracker integration (v2). v1 ships the interface and an empty registry. */
export interface IssueProvider {
  readonly id: ProviderId;
  listIssues(projectRef: string, filter: { labels?: string[]; query?: string }): Promise<ExternalIssue[]>;
  getIssue(ref: string): Promise<ExternalIssue>;
  syncStatus(ref: string, status: 'in_progress' | 'in_review' | 'done'): Promise<void>;
  addComment(ref: string, body: string): Promise<void>;
}
