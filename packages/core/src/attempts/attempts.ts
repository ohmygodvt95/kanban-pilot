import { join } from 'node:path';
import type { Attempt, DiffResult, ExecutorId, Project, Task } from '@agent-kanban/shared';
import type { CoreContext } from '../context.js';
import { getExecutor } from '../executors/registry.js';
import { createWorktree, diffWorktree, mergeBranch, removeWorktree, seededFiles } from '../git/git.js';
import { CoreError } from '../util/errors.js';
import { newId, slugify } from '../util/ids.js';

export class AttemptService {
  constructor(private readonly ctx: CoreContext) {}

  worktreePath(projectId: string, attemptId: string): string {
    return join(this.ctx.paths.worktreesRoot, projectId, attemptId);
  }

  /** Create worktree + branch for a new attempt of `task`. */
  async create(task: Task, project: Project, executor: ExecutorId): Promise<Attempt> {
    const id = newId();
    const branch = `ak/${slugify(task.title)}-${id.slice(-6).toLowerCase()}`;
    const worktreePath = this.worktreePath(project.id, id);
    const adapter = getExecutor(this.ctx.executors, executor);
    const result = await createWorktree({
      repoPath: project.repo_path,
      baseBranch: project.base_branch,
      branch,
      worktreePath,
      templateDirs: this.ctx.templateDirs,
      instructionFiles: adapter.instructionFiles,
    });
    for (const w of result.warnings) this.ctx.logger.warn({ task: task.id, warning: w }, 'worktree warning');
    if (result.seededFiles.length) {
      this.ctx.logger.info({ task: task.id, files: result.seededFiles }, 'seeded instruction files');
    }
    return this.ctx.store.insertAttempt({
      id,
      task_id: task.id,
      executor,
      branch,
      worktree_path: worktreePath,
      base_commit: result.baseCommit,
      status: 'active',
    });
  }

  async discard(attempt: Attempt, project: Project): Promise<Attempt> {
    await removeWorktree(project.repo_path, attempt.worktree_path, attempt.branch, { deleteBranch: true });
    return this.ctx.store.updateAttempt(attempt.id, { status: 'discarded' });
  }

  async merge(
    task: Task,
    attempt: Attempt,
    project: Project,
  ): Promise<{ attempt: Attempt; mergeCommit: string }> {
    if (attempt.status !== 'active')
      throw new CoreError('CONFLICT', `attempt ${attempt.id} is ${attempt.status}`);
    const message = `Merge ${attempt.branch}: ${task.title}\n\nTask: ${task.id}\nAttempt: ${attempt.id}`;
    const res = await mergeBranch(
      project.repo_path,
      project.base_branch,
      attempt.branch,
      message,
      join(this.ctx.paths.worktreesRoot, project.id, 'tmp'),
    );
    const updated = await this.ctx.store.updateAttempt(attempt.id, { status: 'merged' });
    await removeWorktree(project.repo_path, attempt.worktree_path, attempt.branch, { deleteBranch: false });
    return { attempt: updated, mergeCommit: res.mergeCommit };
  }

  /** Instruction files seeded by agent-kanban; never part of the diff or commit. */
  async excludedPaths(attempt: Attempt): Promise<string[]> {
    const adapter = getExecutor(this.ctx.executors, attempt.executor);
    return seededFiles(attempt.worktree_path, attempt.base_commit, adapter.instructionFiles);
  }

  async diff(attempt: Attempt): Promise<DiffResult> {
    if (attempt.status !== 'active') {
      throw new CoreError(
        'CONFLICT',
        `attempt ${attempt.id} is ${attempt.status}; its worktree no longer exists`,
      );
    }
    return diffWorktree(attempt.worktree_path, attempt.base_commit, {
      exclude: await this.excludedPaths(attempt),
    });
  }
}
