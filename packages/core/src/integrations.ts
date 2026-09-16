/**
 * Tracker connections (one per project): CRUD with secret retention, connection
 * tests, remote status discovery and form prefill from the origin remote.
 */
import type {
  CreateMeta,
  Integration,
  ProviderId,
  ProviderModuleInfo,
  RemoteUser,
  StatusMap,
} from '@agent-kanban/shared';
import { COLUMNS } from '@agent-kanban/shared';
import type { CoreContext } from './context.js';
import { remoteUrl } from './git/git.js';
import {
  buildProvider,
  detectFromRemote,
  type IssueProvider,
  listProviderModules,
  toPublicIntegration,
} from './providers/index.js';
import type { IntegrationRowFull } from './store/store.js';
import { CoreError } from './util/errors.js';

export interface IntegrationInput {
  provider: ProviderId;
  base_url?: string | null;
  project_ref: string;
  username?: string | null;
  /** Empty/undefined keeps the stored secret. */
  token?: string | null;
  password?: string | null;
  import_filter?: string | null;
  status_map?: StatusMap;
  sync_status?: boolean;
  sync_comments?: boolean;
  poll_interval_seconds?: number;
  push_defaults?: {
    issue_type_by_kind?: Record<string, string | null>;
    priority_map?: Record<string, string | null>;
    fields?: Record<string, unknown>;
  };
  push_on_todo?: boolean;
}

export class IntegrationService {
  constructor(private readonly ctx: CoreContext) {}

  modules(): ProviderModuleInfo[] {
    return listProviderModules(this.ctx.providers);
  }

  private module(id: ProviderId) {
    const m = this.ctx.providers[id];
    if (!m) throw new CoreError('VALIDATION', `unknown provider ${id}`);
    return m;
  }

  /** Public (masked) integration of a project, or null. */
  async get(projectId: string): Promise<Integration | null> {
    const row = await this.ctx.store.findIntegration(projectId);
    return row ? toPublicIntegration(row) : null;
  }

  /** Suggested provider + refs derived from the origin remote (for a fresh form). */
  async suggest(
    projectId: string,
  ): Promise<{ provider: ProviderId; base_url: string | null; project_ref: string } | null> {
    const project = await this.ctx.store.getProject(projectId);
    const d = detectFromRemote(this.ctx.providers, await remoteUrl(project.repo_path));
    return d ? { provider: d.provider, base_url: d.baseUrl, project_ref: d.projectRef } : null;
  }

  /** Create or replace the project's integration. Blank secrets keep what is stored. */
  async upsert(projectId: string, input: IntegrationInput): Promise<Integration> {
    await this.ctx.store.getProject(projectId);
    const module = this.module(input.provider);
    const existing = await this.ctx.store.findIntegration(projectId);
    const keep = existing && existing.provider === input.provider ? existing.auth : {};
    const statusMap = normalizeStatusMap(
      input.status_map ?? existing?.status_map ?? module.info.defaultStatusMap,
    );
    const row = await this.ctx.store.upsertIntegration({
      project_id: projectId,
      provider: input.provider,
      base_url: input.base_url?.trim() || null,
      project_ref: input.project_ref.trim(),
      auth: {
        username: input.username?.trim() || null,
        token: input.token?.trim() || keep.token || null,
        password: input.password?.trim() || keep.password || null,
      },
      import_filter: input.import_filter?.trim() || null,
      status_map: statusMap,
      sync_status: input.sync_status ?? existing?.sync_status ?? true,
      sync_comments: input.sync_comments ?? existing?.sync_comments ?? true,
      poll_interval_seconds: input.poll_interval_seconds ?? existing?.poll_interval_seconds ?? 30,
      push_defaults: {
        issue_type_by_kind:
          input.push_defaults?.issue_type_by_kind ?? existing?.push_defaults.issue_type_by_kind ?? {},
        priority_map: input.push_defaults?.priority_map ?? existing?.push_defaults.priority_map ?? {},
        fields: input.push_defaults?.fields ?? existing?.push_defaults.fields ?? {},
      },
      push_on_todo: input.push_on_todo ?? existing?.push_on_todo ?? false,
      last_polled_at: null,
      last_error: null,
    });
    return toPublicIntegration(row);
  }

  /** Issue types + fields the tracker needs when creating an issue. */
  async createMeta(projectId: string): Promise<CreateMeta> {
    const p = await this.provider(projectId);
    if (!p) throw new CoreError('CONFLICT', 'no tracker configured for this project');
    return p.provider.createMeta();
  }

  /** Tracker users matching `query` (user-picker fields of the push form). */
  async searchUsers(projectId: string, query: string): Promise<RemoteUser[]> {
    const p = await this.provider(projectId);
    if (!p) throw new CoreError('CONFLICT', 'no tracker configured for this project');
    return p.provider.searchUsers(query);
  }

  async remove(projectId: string): Promise<void> {
    await this.ctx.store.deleteIntegration(projectId);
  }

  /** Build a live provider for a project (null when nothing is configured). */
  async provider(projectId: string): Promise<{ provider: IssueProvider; row: IntegrationRowFull } | null> {
    const row = await this.ctx.store.findIntegration(projectId);
    if (!row) return null;
    return { provider: buildProvider(this.ctx.providers, row), row };
  }

  /** Verify credentials without saving (uses stored secrets for blank fields). */
  async test(projectId: string, input: IntegrationInput): Promise<{ ok: boolean; message?: string }> {
    const existing = await this.ctx.store.findIntegration(projectId);
    const keep = existing && existing.provider === input.provider ? existing.auth : {};
    const provider = buildProvider(this.ctx.providers, {
      provider: input.provider,
      base_url: input.base_url?.trim() || null,
      project_ref: input.project_ref.trim(),
      auth: {
        username: input.username?.trim() || null,
        token: input.token?.trim() || keep.token || null,
        password: input.password?.trim() || keep.password || null,
      },
      import_filter: input.import_filter?.trim() || null,
      status_map: normalizeStatusMap(input.status_map ?? this.module(input.provider).info.defaultStatusMap),
      push_defaults: { issue_type_by_kind: {}, priority_map: {}, fields: {} },
    });
    return provider.check();
  }

  /** Remote statuses (workflow states or labels) for the status-map editor. */
  async statuses(projectId: string): Promise<string[]> {
    const p = await this.provider(projectId);
    if (!p) throw new CoreError('CONFLICT', 'no tracker configured for this project');
    return p.provider.listStatuses();
  }
}

/** Trim entries and guarantee an array for every column. */
export function normalizeStatusMap(map: Partial<StatusMap>): StatusMap {
  const out = {} as StatusMap;
  for (const c of COLUMNS) out[c] = (map[c] ?? []).map((s) => s.trim()).filter(Boolean);
  return out;
}
