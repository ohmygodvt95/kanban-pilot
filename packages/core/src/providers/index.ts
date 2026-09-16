import type { Integration, ProviderId, ProviderModuleInfo, StatusMap } from '@agent-kanban/shared';
import type { IntegrationAuth } from '../db/schema.js';
import { githubModule } from './github.js';
import { gitlabModule } from './gitlab.js';
import { jiraModule } from './jira.js';
import type { IssueProvider, ProviderConfig, ProviderModule } from './types.js';

export { githubModule } from './github.js';
export { gitlabModule } from './gitlab.js';
export { jiraModule } from './jira.js';
export * from './types.js';

export type ProviderRegistry = Partial<Record<ProviderId, ProviderModule>>;

/** Register new trackers here; the settings UI and sync logic pick them up automatically. */
export function createDefaultProviders(): ProviderRegistry {
  return { github: githubModule, gitlab: gitlabModule, jira: jiraModule };
}

export function listProviderModules(registry: ProviderRegistry): ProviderModuleInfo[] {
  return Object.values(registry)
    .filter((m): m is ProviderModule => !!m)
    .map((m) => m.info);
}

/** Row shape needed to build a provider (the stored integration incl. secrets). */
export interface IntegrationRow {
  provider: ProviderId;
  base_url: string | null;
  project_ref: string;
  auth: IntegrationAuth;
  import_filter: string | null;
  status_map: StatusMap;
}

export function buildProvider(registry: ProviderRegistry, row: IntegrationRow): IssueProvider {
  const module = registry[row.provider];
  if (!module) throw new Error(`unknown provider ${row.provider}`);
  const config: ProviderConfig = {
    baseUrl: row.base_url,
    projectRef: row.project_ref,
    username: row.auth.username ?? null,
    token: row.auth.token ?? null,
    password: row.auth.password ?? null,
    importFilter: row.import_filter,
    statusNames: Object.values(row.status_map).flat(),
  };
  return module.create(config);
}

/** Prefill an integration form from the origin remote (first module that recognises the URL). */
export function detectFromRemote(
  registry: ProviderRegistry,
  remoteUrl: string | null,
): { provider: ProviderId; baseUrl: string | null; projectRef: string } | null {
  if (!remoteUrl) return null;
  for (const module of Object.values(registry)) {
    if (!module) continue;
    const d = module.detectFromRemote(remoteUrl);
    if (d?.projectRef)
      return { provider: module.info.id, baseUrl: d.baseUrl ?? null, projectRef: d.projectRef };
  }
  return null;
}

/** Public view of an integration: secrets replaced by flags. */
export function toPublicIntegration(
  row: IntegrationRow &
    Omit<Integration, 'auth' | 'provider' | 'base_url' | 'project_ref' | 'import_filter' | 'status_map'>,
): Integration {
  const { auth, ...rest } = row;
  return {
    ...rest,
    auth: { username: auth.username ?? null, has_token: !!auth.token, has_password: !!auth.password },
  };
}
