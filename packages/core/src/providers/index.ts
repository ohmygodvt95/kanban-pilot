import type { ProviderId } from '@agent-kanban/shared';
import { GitHubIssueProvider } from './github.js';
import { GitLabIssueProvider } from './gitlab.js';
import type { IssueProvider } from './types.js';

export { GitHubIssueProvider } from './github.js';
export { GitLabIssueProvider } from './gitlab.js';
export * from './types.js';

export type ProviderRegistry = Partial<Record<ProviderId, IssueProvider>>;

/** GitHub and GitLab are implemented; add Jira here when available. */
export function createDefaultProviders(): ProviderRegistry {
  return { github: new GitHubIssueProvider(), gitlab: new GitLabIssueProvider() };
}

export interface DetectedProvider {
  provider: IssueProvider;
  projectRef: string;
}

/**
 * Resolve the tracker of a project: an explicit override (`issue_provider` +
 * `issue_project_ref`) wins, otherwise the provider hosting the origin remote.
 */
export function detectProvider(
  registry: ProviderRegistry,
  remoteUrl: string | null,
  override?: { provider: ProviderId | null; projectRef: string | null },
): DetectedProvider | null {
  if (override?.provider && override.projectRef) {
    const provider = registry[override.provider];
    return provider ? { provider, projectRef: override.projectRef } : null;
  }
  if (!remoteUrl) return null;
  for (const provider of Object.values(registry)) {
    if (!provider) continue;
    const ref = provider.detectProjectRef(remoteUrl);
    if (ref) return { provider, projectRef: ref };
  }
  return null;
}
