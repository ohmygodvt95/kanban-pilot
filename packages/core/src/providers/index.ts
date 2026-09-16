import type { ProviderId } from '@agent-kanban/shared';
import type { IssueProvider } from './types.js';

export { GitHubIssueProvider } from './github.js';
export * from './types.js';

/** v1: intentionally empty. Register providers here when implemented. */
export const providerRegistry: Partial<Record<ProviderId, IssueProvider>> = {};
