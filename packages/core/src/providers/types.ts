/**
 * Issue tracker provider modules.
 *
 * A `ProviderModule` describes how a tracker is configured (fields shown in the
 * integration screen, default status map) and builds an `IssueProvider` from a
 * project's stored integration. Adding a tracker = one module file + a line in
 * `index.ts`; the UI form and the sync/import logic are generic.
 */
import type {
  Column,
  CreateMeta,
  ProviderId,
  ProviderModuleInfo,
  StatusMap,
  TaskKind,
  TaskPriority,
} from '@agent-kanban/shared';

export interface ExternalIssue {
  /** Provider-local id: issue number (GitHub/GitLab) or issue key (Jira). */
  externalId: string;
  url: string;
  title: string;
  body: string;
  labels: string[];
  /** Remote status name (workflow status or the matching workflow label), if known. */
  status: string | null;
  /** Guessed from labels/issue type/priority; null when unknown. */
  kind?: TaskKind | null;
  priority?: TaskPriority | null;
}

export interface PullRequestInput {
  head: string;
  base: string;
  title: string;
  body: string;
}

/** Extra context for status updates / comments. */
export interface SyncContext {
  /** Kanban column the task just entered. */
  column: Column;
  branch?: string | null;
  prUrl?: string | null;
  taskTitle?: string;
}

/** Everything a provider needs to talk to one tracker project. */
export interface ProviderConfig {
  baseUrl: string | null;
  projectRef: string;
  username: string | null;
  token: string | null;
  password: string | null;
  /** Labels (GitHub/GitLab) or JQL (Jira) selecting the issues to import. */
  importFilter: string | null;
  /** Every remote status named in the project's status map (label-based providers use it to spot workflow labels). */
  statusNames: string[];
}

/** What a provider needs to create an issue from a local task. */
export interface CreateIssueInput {
  title: string;
  /** Markdown body; providers convert to their own markup. */
  body: string;
  /** Remote issue type id (Jira); ignored by label-based trackers. */
  issueTypeId?: string | null;
  /** Remote priority name (Jira) when the integration maps it. */
  priority?: string | null;
  labels?: string[];
  /** Extra remote fields keyed by their remote key (custom fields, components…). */
  fields?: Record<string, unknown>;
}

export interface IssueProvider {
  readonly id: ProviderId;
  /** Verify credentials and project access; `message` explains failures. */
  check(): Promise<{ ok: boolean; message?: string }>;
  /** Issues matching the configured import filter (open ones). */
  listIssues(filter?: { query?: string }): Promise<ExternalIssue[]>;
  getIssue(externalId: string): Promise<ExternalIssue>;
  /** Remote statuses available for the status map (workflow states or labels). */
  listStatuses(): Promise<string[]>;
  /** Move the issue to a remote status (workflow transition or label swap). */
  setStatus(externalId: string, status: string, ctx: SyncContext): Promise<void>;
  addComment(externalId: string, body: string): Promise<void>;
  /** Open a pull/merge request and return its URL. */
  createPullRequest?(input: PullRequestInput): Promise<string>;
  /** Issue types and their (required) fields, so the UI can ask for what the tracker needs. */
  createMeta(): Promise<CreateMeta>;
  /** Create an issue from a local task and return it (with externalId/url). */
  createIssue(input: CreateIssueInput): Promise<ExternalIssue>;
}

export interface ProviderModule {
  readonly info: ProviderModuleInfo;
  /** Prefill `projectRef`/`baseUrl` from a git remote URL, if this tracker hosts it. */
  detectFromRemote(remoteUrl: string): Partial<Pick<ProviderConfig, 'baseUrl' | 'projectRef'>> | null;
  create(config: ProviderConfig): IssueProvider;
}

/** Map tracker labels to a task kind / priority (shared by all providers). */
export function classifyLabels(labels: string[]): { kind: TaskKind | null; priority: TaskPriority | null } {
  const norm = labels.map((l) => l.toLowerCase());
  let kind: TaskKind | null = null;
  if (norm.some((l) => /\b(bug|defect|regression)\b/.test(l))) kind = 'bug';
  else if (norm.some((l) => /\b(feature|enhancement|epic|story)\b/.test(l))) kind = 'feature';
  else if (norm.some((l) => /\b(chore|maintenance|refactor|dependencies|docs)\b/.test(l))) kind = 'chore';
  let priority: TaskPriority | null = null;
  for (const l of norm) {
    if (/(urgent|critical|blocker|highest|p0|priority::?\s*(0|critical|urgent))/.test(l)) priority = 'urgent';
    else if (/(\bhigh\b|p1|priority::?\s*(1|high))/.test(l) && priority !== 'urgent') priority = 'high';
    else if (/(\blow\b|lowest|p3|p4|priority::?\s*(3|4|low))/.test(l) && !priority) priority = 'low';
    else if (/(\bmedium\b|p2|priority::?\s*(2|medium))/.test(l) && !priority) priority = 'medium';
  }
  return { kind, priority };
}

/** Text of the milestone comment posted on the issue. */
export function statusComment(ctx: SyncContext): string {
  const branch = ctx.branch ? ` (branch \`${ctx.branch}\`)` : '';
  switch (ctx.column) {
    case 'doing':
      return `🤖 agent-kanban: an agent started working on this${branch}.`;
    case 'review':
      return `🤖 agent-kanban: changes are ready for review${branch}.${ctx.prUrl ? ` ${ctx.prUrl}` : ''}`;
    case 'done':
      return `🤖 agent-kanban: done${branch}.${ctx.prUrl ? ` ${ctx.prUrl}` : ' Merged locally.'}`;
    case 'todo':
      return '🤖 agent-kanban: queued for an agent.';
    case 'backlog':
      return '🤖 agent-kanban: moved back to the backlog.';
  }
}

/** Column an imported remote status lands in (reverse lookup of the status map). */
export function columnForStatus(map: StatusMap, status: string | null): Column | null {
  if (!status) return null;
  const wanted = status.trim().toLowerCase();
  for (const [column, statuses] of Object.entries(map) as [Column, string[]][]) {
    if (statuses.some((s) => s.trim().toLowerCase() === wanted)) return column;
  }
  return null;
}

/** Remote status written back when a task enters `column` (first mapped entry). */
export function statusForColumn(map: StatusMap, column: Column): string | null {
  return map[column]?.[0]?.trim() || null;
}

/** Error raised for non-2xx responses; keeps the status and headers for provider-specific hints. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly headers: Headers,
    readonly body: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Create metadata of label-based trackers: one issue type whose only optional field is `labels`. */
export function labelsCreateMeta(labels: string[]): CreateMeta {
  return {
    issueTypes: [
      {
        id: 'issue',
        name: 'Issue',
        fields: [
          {
            key: 'labels',
            name: 'Labels',
            required: false,
            type: 'labels',
            allowedValues: labels.map((l) => ({ id: l, name: l })),
          },
        ],
      },
    ],
  };
}

/** Small helper shared by REST providers. HTML error pages are reduced to their title. */
export async function jsonRequest<T>(url: string, init: RequestInit, describe: string): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': 'agent-kanban', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const isHtml = /^\s*</.test(text);
    const detail = isHtml
      ? (text.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? 'HTML error page')
      : text.slice(0, 300);
    throw new HttpError(
      `${describe} → HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
      res.status,
      res.headers,
      text,
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
