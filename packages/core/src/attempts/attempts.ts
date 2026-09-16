import { join } from 'node:path';
import type { Attempt, DiffResult, ExecutorId, Project, Task } from '@agent-kanban/shared';
import type { CoreContext } from '../context.js';
import { getExecutor } from '../executors/registry.js';
import {
  createWorktree,
  diffRefs,
  diffWorktree,
  type MergeIntoWorktreeResult,
  mergeBranch,
  mergeIntoWorktree,
  push,
  removeWorktree,
  seededFiles,
} from '../git/git.js';
import type { IssueProvider } from '../providers/types.js';
import { CoreError } from '../util/errors.js';
import { newId, slugify } from '../util/ids.js';

/** Worktree/branch lifecycle of attempts plus the git operations exposed to the UI. */
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

  /** REVIEW → DONE with `done_action = merge`: merge into the base branch locally. */
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

  /**
   * REVIEW → DONE with `done_action = pr`: push the branch and open a pull request
   * through the issue provider. The worktree is removed; the branch stays.
   */
  async openPullRequest(
    task: Task,
    attempt: Attempt,
    project: Project,
    provider: IssueProvider,
    projectRef: string,
  ): Promise<Attempt> {
    if (attempt.status !== 'active')
      throw new CoreError('CONFLICT', `attempt ${attempt.id} is ${attempt.status}`);
    if (!provider.createPullRequest)
      throw new CoreError('CONFLICT', `${provider.id} provider cannot create pull requests`);
    const pushed = await push(attempt.worktree_path, attempt.branch);
    if (!pushed.ok) throw new CoreError('GIT_ERROR', `push failed: ${pushed.message ?? 'unknown error'}`);
    const body = `${task.description}\n\n---\nCreated by agent-kanban · task ${task.id} · attempt ${attempt.id}${
      task.source_url ? `\nCloses ${task.source_url}` : ''
    }`;
    const url = await provider.createPullRequest(projectRef, {
      head: attempt.branch,
      base: project.base_branch,
      title: task.title,
      body,
    });
    const updated = await this.ctx.store.updateAttempt(attempt.id, { status: 'merged', pr_url: url });
    await removeWorktree(project.repo_path, attempt.worktree_path, attempt.branch, { deleteBranch: false });
    return updated;
  }

  /** Instruction files seeded by agent-kanban; never part of the diff or commit. */
  async excludedPaths(attempt: Attempt): Promise<string[]> {
    if (attempt.status !== 'active') return [];
    const adapter = getExecutor(this.ctx.executors, attempt.executor);
    return seededFiles(attempt.worktree_path, attempt.base_commit, adapter.instructionFiles);
  }

  /**
   * Diff of the attempt. Active attempts diff the worktree against the base
   * commit; merged attempts (worktree removed, branch kept) diff `base..branch`
   * in the main repository so the change stays inspectable after DONE.
   */
  async diff(attempt: Attempt, project: Project): Promise<DiffResult> {
    if (attempt.status === 'active') {
      return diffWorktree(attempt.worktree_path, attempt.base_commit, {
        exclude: await this.excludedPaths(attempt),
      });
    }
    if (attempt.status === 'merged') {
      return diffRefs(project.repo_path, attempt.base_commit, attempt.branch);
    }
    throw new CoreError(
      'CONFLICT',
      `attempt ${attempt.id} was discarded; its worktree and branch no longer exist`,
    );
  }

  /**
   * Merge the project's base branch into the attempt ("update from base"). The
   * attempt's base_commit moves to the merged base tip so the diff keeps showing
   * only the attempt's own changes. Conflicts are left for an agent to resolve.
   */
  async updateFromBase(attempt: Attempt, project: Project): Promise<MergeIntoWorktreeResult> {
    if (attempt.status !== 'active')
      throw new CoreError('CONFLICT', `attempt ${attempt.id} is ${attempt.status}`);
    const res = await mergeIntoWorktree(
      attempt.worktree_path,
      project.base_branch,
      `Merge ${project.base_branch} into ${attempt.branch}`,
    );
    await this.ctx.store.updateAttempt(attempt.id, { base_commit: res.refCommit });
    return res;
  }
}
