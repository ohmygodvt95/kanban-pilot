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
import { detectBaseBranch, isGitRepo, readRepoConfig, remoteUrl, repoToplevel } from './git/git.js';
import { detectProvider } from './providers/index.js';
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
  /** Adopt setup/test scripts found in the repo's .agent-kanban.json. */
  accept_repo_scripts?: boolean;
}

export type UpdateProjectInput = Partial<Omit<CreateProjectInput, 'repo_path' | 'accept_repo_scripts'>>;

export class ProjectService {
  constructor(
    private readonly ctx: CoreContext,
    private readonly tasks: () => TaskService,
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
    });
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    await this.ctx.store.getProject(id);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) if (v !== undefined) patch[k] = v;
    return this.ctx.store.updateProject(id, patch);
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

  /** Which issue provider hosts the project's origin remote, and whether it is usable. */
  async providerStatus(projectId: string): Promise<ProviderStatus | null> {
    const project = await this.ctx.store.getProject(projectId);
    const detected = detectProvider(this.ctx.providers, await remoteUrl(project.repo_path));
    if (!detected) return null;
    const check = await detected.provider.check();
    return {
      id: detected.provider.id,
      ok: check.ok,
      message: check.message,
      projectRef: detected.projectRef,
    };
  }

  async listIssues(
    projectId: string,
    filter: { labels?: string[]; query?: string } = {},
  ): Promise<ExternalIssue[]> {
    const project = await this.ctx.store.getProject(projectId);
    const detected = detectProvider(this.ctx.providers, await remoteUrl(project.repo_path));
    if (!detected) throw new CoreError('CONFLICT', 'the origin remote is not hosted by a supported provider');
    return detected.provider.listIssues(detected.projectRef, filter);
  }

  /** Create backlog tasks from external issues; already-imported issues are skipped. */
  async importIssues(projectId: string, externalIds: string[]): Promise<Task[]> {
    const project = await this.ctx.store.getProject(projectId);
    const detected = detectProvider(this.ctx.providers, await remoteUrl(project.repo_path));
    if (!detected) throw new CoreError('CONFLICT', 'the origin remote is not hosted by a supported provider');
    const existing = new Set(
      (await this.ctx.store.listTasks(projectId)).map((t) => t.source_external_id).filter(Boolean),
    );
    const created: Task[] = [];
    for (const id of externalIds) {
      if (existing.has(id)) continue;
      const issue = await detected.provider.getIssue(id);
      created.push(
        await this.tasks().create(projectId, {
          title: issue.title,
          description: `${issue.body}\n\n_Imported from ${issue.url}_`,
          source_provider: detected.provider.id,
          source_external_id: issue.externalId,
          source_url: issue.url,
        }),
      );
    }
    return created;
  }
}

function asExecutor(v: unknown): ExecutorId | undefined {
  return typeof v === 'string' && (EXECUTOR_IDS as readonly string[]).includes(v)
    ? (v as ExecutorId)
    : undefined;
}
