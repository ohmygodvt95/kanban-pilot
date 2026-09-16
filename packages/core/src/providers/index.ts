import type { ProviderId } from '@agent-kanban/shared';
import { GitHubIssueProvider } from './github.js';
import type { IssueProvider } from './types.js';

export { GitHubIssueProvider } from './github.js';
export * from './types.js';

export type ProviderRegistry = Partial<Record<ProviderId, IssueProvider>>;

/** GitHub is implemented; add GitLab/Jira here when available. */
export function createDefaultProviders(): ProviderRegistry {
  return { github: new GitHubIssueProvider() };
}

/** Find the provider hosting `remoteUrl` and its project ref. */
export function detectProvider(
  registry: ProviderRegistry,
  remoteUrl: string | null,
): { provider: IssueProvider; projectRef: string } | null {
  if (!remoteUrl) return null;
  for (const provider of Object.values(registry)) {
    if (!provider) continue;
    const ref = provider.detectProjectRef(remoteUrl);
    if (ref) return { provider, projectRef: ref };
  }
  return null;
}
