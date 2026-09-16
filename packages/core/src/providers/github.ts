import type { ExternalIssue, IssueProvider } from './types.js';

/** Placeholder: every method throws until v2 implements the GitHub API calls. */
export class GitHubIssueProvider implements IssueProvider {
  readonly id = 'github' as const;
  private unsupported(): never {
    throw new Error('GitHub issue provider is not implemented yet (planned for v2)');
  }
  listIssues(): Promise<ExternalIssue[]> {
    return this.unsupported();
  }
  getIssue(): Promise<ExternalIssue> {
    return this.unsupported();
  }
  syncStatus(): Promise<void> {
    return this.unsupported();
  }
  addComment(): Promise<void> {
    return this.unsupported();
  }
}
