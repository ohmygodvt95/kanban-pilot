import { resolve } from 'node:path';
import type {
  ExecutorId,
  ExecutorStatus,
  ExternalIssue,
  Project,
  ProviderStatus,
  Task,
} from '@agent-kanban/shared';
import { EXECUTOR_IDS } from '@agent-kanban/shared';
import type { CoreContext } from './context.js';
import { detectBaseBranch, isGitRepo, readRepoConfig, repoToplevel } from './git/git.js';
import type { IntegrationService } from './integrations.js';
import { IssueService } from './issues.js';
import type { TaskService } from './state/tasks.js';
import { CoreError } from './util/errors.js';

export interface CreateProjectInput {
  name?: string;
  repo_path: string;
  default_executor?: ExecutorId;
  base_branch?: string;
  setup_script?: string | null;
  test_script?: string | null;
  auto_done?: boolean;
  refinement_enabled?: boolean;
  max_concurrent_runs?: number;
  run_timeout_minutes?: number;
  refinement_prompt?: string | null;
  model?: string | null;
  max_budget_usd?: number | null;
  prompt_language?: Project['prompt_language'];
  execute_prompt?: string | null;
  followup_prompt?: string | null;
  done_action?: Project['done_action'];
  auto_start?: boolean;
  browser_enabled?: boolean;
  /** Adopt setup/test scripts found in the repo's .agent-kanban.json. */
  accept_repo_scripts?: boolean;
}

export type UpdateProjectInput = Partial<Omit<CreateProjectInput, 'repo_path' | 'accept_repo_scripts'>>;

export class ProjectService {
  constructor(
    private readonly ctx: CoreContext,
    private readonly tasks: () => TaskService,
    private readonly integrations: () => IntegrationService,
  ) {}

  list(): Promise<Project[]> {
    return this.ctx.store.listProjects();
  }

  get(id: string): Promise<Project> {
    return this.ctx.store.getProject(id);
  }

  /**
   * Validate the repo, merge `.agent-kanban.json` defaults and create the project.
   * Scripts from the repo file are only adopted with `accept_repo_scripts` — they
   * execute on this machine, so the user must see them first (CONFIRM_REQUIRED).
   */
  async create(input: CreateProjectInput): Promise<Project> {
    const repoPath = resolve(input.repo_path);
    if (!(await isGitRepo(repoPath)))
      throw new CoreError('VALIDATION', `${repoPath} is not a git repository`);
    const top = await repoToplevel(repoPath);
    if (await this.ctx.store.findProjectByPath(top))
      throw new CoreError('CONFLICT', `project for ${top} already exists`);

    const fileCfg = (await readRepoConfig(top)) ?? {};
    const repoScripts = {
      setup_script: fileCfg.setup_script ?? null,
      test_script: fileCfg.test_script ?? null,
    };
    const needsConfirm =
      (repoScripts.setup_script && input.setup_script === undefined) ||
      (repoScripts.test_script && input.test_script === undefined);
    if (needsConfirm && !input.accept_repo_scripts) {
      throw new CoreError(
        'CONFIRM_REQUIRED',
        `${top}/.agent-kanban.json defines scripts that will run on this machine; review them and confirm`,
        repoScripts,
      );
    }
    const executor = input.default_executor ?? asExecutor(fileCfg.default_executor) ?? 'claude';
    return this.ctx.store.insertProject({
      name: input.name?.trim() || top.split('/').filter(Boolean).pop() || 'project',
      repo_path: top,
      default_executor: executor,
      base_branch: input.base_branch ?? fileCfg.base_branch ?? (await detectBaseBranch(top)),
      setup_script: input.setup_script !== undefined ? input.setup_script : repoScripts.setup_script,
      test_script: input.test_script !== undefined ? input.test_script : repoScripts.test_script,
      auto_done: input.auto_done ?? false,
      refinement_enabled: input.refinement_enabled ?? fileCfg.refinement_enabled ?? true,
      max_concurrent_runs: input.max_concurrent_runs ?? 2,
      run_timeout_minutes: input.run_timeout_minutes ?? 45,
      refinement_prompt: input.refinement_prompt ?? null,
      model: input.model ?? null,
      max_budget_usd: input.max_budget_usd ?? null,
      prompt_language: input.prompt_language ?? 'vi',
      execute_prompt: input.execute_prompt ?? null,
      followup_prompt: input.followup_prompt ?? null,
      done_action: input.done_action ?? 'merge',
      auto_start: input.auto_start ?? false,
      browser_enabled: input.browser_enabled ?? false,
    });
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const before = await this.ctx.store.getProject(id);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) if (v !== undefined) patch[k] = v;
    const updated = await this.ctx.store.updateProject(id, patch);
    // Switching auto_start on starts everything already waiting in TODO.
    if (updated.auto_start && !before.auto_start) await this.tasks().autoStartPending(id);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.ctx.store.getProject(id);
    const active = await this.ctx.store.listActiveAttempts();
    const tasks = await this.ctx.store.listTasks(id);
    const taskIds = new Set(tasks.map((t) => t.id));
    if (active.some((a) => taskIds.has(a.task_id))) {
      throw new CoreError('CONFLICT', 'project still has active attempts; discard or merge them first');
    }
    await this.ctx.store.deleteProject(id);
  }

  async executorStatus(): Promise<ExecutorStatus[]> {
    return Promise.all(
      EXECUTOR_IDS.map(async (id) => {
        const adapter = this.ctx.executors[id];
        const res = await adapter.check();
        return { id, displayName: adapter.displayName, supportsResume: adapter.supportsResume, ...res };
      }),
    );
  }

  /** The configured tracker and whether its credentials work. */
  async providerStatus(projectId: string): Promise<ProviderStatus | null> {
    const link = await this.integrations().provider(projectId);
    if (!link) return null;
    const check = await link.provider.check();
    return { id: link.row.provider, ok: check.ok, message: check.message, projectRef: link.row.project_ref };
  }

  private async requireProvider(projectId: string) {
    const link = await this.integrations().provider(projectId);
    if (!link)
      throw new CoreError(
        'CONFLICT',
        'no issue tracker configured for this project (Settings → Integration)',
      );
    return link;
  }

  /** Issues from the tracker, annotated with `imported` and the column the status map assigns. */
  async listIssues(projectId: string, filter: { query?: string } = {}): Promise<ExternalIssue[]> {
    const link = await this.requireProvider(projectId);
    const imported = new Set(
      (await this.ctx.store.listTasks(projectId)).map((t) => t.source_external_id).filter(Boolean),
    );
    return (await link.provider.listIssues(filter)).map((i) => ({
      ...i,
      imported: imported.has(i.externalId),
      column: IssueService.importColumn(link.row.status_map, i.status),
    }));
  }

  /**
   * Create tasks from external issues; already-imported issues are skipped. The
   * column comes from the status map (done → skipped, doing/review → To do).
   */
  async importIssues(projectId: string, externalIds: string[]): Promise<Task[]> {
    const link = await this.requireProvider(projectId);
    const existing = new Set(
      (await this.ctx.store.listTasks(projectId)).map((t) => t.source_external_id).filter(Boolean),
    );
    const created: Task[] = [];
    for (const id of externalIds) {
      if (existing.has(id)) continue;
      existing.add(id); // guard against the same id twice in one call
      const issue = await link.provider.getIssue(id);
      const column = IssueService.importColumn(link.row.status_map, issue.status);
      if (column === 'skip') continue;
      // Title = summary, body = description; the issue link lives in source_url.
      const task = await this.tasks().create(projectId, {
        title: issue.title,
        description: issue.body,
        kind: issue.kind ?? null,
        priority: issue.priority ?? null,
        source_provider: link.row.provider,
        source_external_id: issue.externalId,
        source_url: issue.url,
      });
      // Imported "ready" issues go straight to TODO (skip refinement) — the transition also triggers auto-start.
      created.push(column === 'todo' ? await this.tasks().importToTodo(task.id) : task);
    }
    return created;
  }
}

function asExecutor(v: unknown): ExecutorId | undefined {
  return typeof v === 'string' && (EXECUTOR_IDS as readonly string[]).includes(v)
    ? (v as ExecutorId)
    : undefined;
}
