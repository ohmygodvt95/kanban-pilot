import { resolve } from 'node:path';
import type { ExecutorId, ExecutorStatus, Project } from '@agent-kanban/shared';
import { EXECUTOR_IDS } from '@agent-kanban/shared';
import type { CoreContext } from './context.js';
import { detectBaseBranch, isGitRepo, readRepoConfig, repoToplevel } from './git/git.js';
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
}

export type UpdateProjectInput = Partial<Omit<CreateProjectInput, 'repo_path'>>;

export class ProjectService {
  constructor(private readonly ctx: CoreContext) {}

  list(): Promise<Project[]> {
    return this.ctx.store.listProjects();
  }

  get(id: string): Promise<Project> {
    return this.ctx.store.getProject(id);
  }

  /** Validate the repo, merge `.agent-kanban.json` defaults and create the project. */
  async create(input: CreateProjectInput): Promise<Project> {
    const repoPath = resolve(input.repo_path);
    if (!(await isGitRepo(repoPath))) {
      throw new CoreError('VALIDATION', `${repoPath} is not a git repository`);
    }
    const top = await repoToplevel(repoPath);
    if (await this.ctx.store.findProjectByPath(top)) {
      throw new CoreError('CONFLICT', `project for ${top} already exists`);
    }
    const fileCfg = (await readRepoConfig(top)) ?? {};
    const executor = input.default_executor ?? asExecutor(fileCfg.default_executor) ?? 'claude';
    return this.ctx.store.insertProject({
      name: input.name?.trim() || top.split('/').filter(Boolean).pop() || 'project',
      repo_path: top,
      default_executor: executor,
      base_branch: input.base_branch ?? fileCfg.base_branch ?? (await detectBaseBranch(top)),
      setup_script: input.setup_script ?? fileCfg.setup_script ?? null,
      test_script: input.test_script ?? fileCfg.test_script ?? null,
      auto_done: input.auto_done ?? false,
      refinement_enabled: input.refinement_enabled ?? fileCfg.refinement_enabled ?? true,
      max_concurrent_runs: input.max_concurrent_runs ?? 2,
      run_timeout_minutes: input.run_timeout_minutes ?? 45,
      refinement_prompt: input.refinement_prompt ?? null,
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
}

function asExecutor(v: unknown): ExecutorId | undefined {
  return typeof v === 'string' && (EXECUTOR_IDS as readonly string[]).includes(v)
    ? (v as ExecutorId)
    : undefined;
}
