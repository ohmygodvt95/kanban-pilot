import type { Attempt, Column, Comment, Project, Task, TaskDetail } from '@agent-kanban/shared';
import type { AttemptService } from '../attempts/attempts.js';
import type { CoreContext } from '../context.js';
import { getExecutor } from '../executors/registry.js';
import {
  buildExecutePrompt,
  buildFollowupPrompt,
  buildFollowupPromptWithoutResume,
  buildRetryPrompt,
} from '../prompts/prompts.js';
import type { RefinementService } from '../refinement/refinement.js';
import type { JobRunner } from '../runner/runner.js';
import type { RunService } from '../runs/runs.js';
import { CoreError, errorMessage } from '../util/errors.js';
import { type Actor, type Decision, decide, type TransitionPayload } from './machine.js';

export interface TaskServiceDeps {
  attempts: AttemptService;
  runs: RunService;
  refinement: () => RefinementService;
  runner: () => JobRunner;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  executor?: Task['executor'];
  skip_refinement?: boolean;
  source_url?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  executor?: Task['executor'];
  skip_refinement?: boolean;
  position?: number;
  source_url?: string | null;
}

/**
 * Task use-cases. `transition` is the single entry point for column changes:
 * it validates via the pure state machine, applies side effects, persists and emits.
 */
export class TaskService {
  constructor(
    private readonly ctx: CoreContext,
    private readonly deps: TaskServiceDeps,
  ) {}

  private get store() {
    return this.ctx.store;
  }

  // ---- CRUD -----------------------------------------------------------------
  async create(projectId: string, input: CreateTaskInput): Promise<Task> {
    const project = await this.store.getProject(projectId);
    const position = await this.store.nextPosition(project.id, 'backlog');
    return this.store.insertTask({
      project_id: project.id,
      title: input.title,
      description: input.description ?? '',
      column: 'backlog',
      substate: 'draft',
      position,
      executor: input.executor ?? null,
      skip_refinement: input.skip_refinement ?? false,
      source_url: input.source_url ?? null,
    });
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const task = await this.store.getTask(id);
    if ((input.title !== undefined || input.description !== undefined) && (await this.hasActiveRun(id))) {
      throw new CoreError('CONFLICT', 'cannot edit title/description while a run is active');
    }
    if (task.column === 'done' && (input.title !== undefined || input.description !== undefined)) {
      throw new CoreError('CONFLICT', 'DONE tasks are immutable');
    }
    const patch: Partial<Task> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.executor !== undefined) patch.executor = input.executor;
    if (input.skip_refinement !== undefined) patch.skip_refinement = input.skip_refinement;
    if (input.position !== undefined) patch.position = input.position;
    if (input.source_url !== undefined) patch.source_url = input.source_url;
    return this.store.updateTask(id, patch);
  }

  async delete(id: string): Promise<void> {
    const task = await this.store.getTask(id);
    if (await this.hasActiveRun(id))
      throw new CoreError('CONFLICT', 'cannot delete a task while a run is active');
    const attempt = await this.activeAttempt(task);
    if (attempt) {
      const project = await this.store.getProject(task.project_id);
      await this.deps.attempts.discard(attempt, project);
    }
    await this.store.deleteTask(id);
  }

  async clone(id: string): Promise<Task> {
    const task = await this.store.getTask(id);
    const position = await this.store.nextPosition(task.project_id, 'backlog');
    return this.store.insertTask({
      project_id: task.project_id,
      title: `${task.title} (copy)`,
      description: task.description,
      column: 'backlog',
      substate: 'draft',
      position,
      executor: task.executor,
      skip_refinement: task.skip_refinement,
      plan: task.plan,
      source_url: task.source_url,
    });
  }

  async detail(id: string): Promise<TaskDetail> {
    const task = await this.store.getTask(id);
    const [attempts, runs, comments, questions] = await Promise.all([
      this.store.listAttempts(id),
      this.store.listRuns(id),
      this.store.listComments(id),
      this.store.listQuestions(id),
    ]);
    const current_attempt = attempts.find((a) => a.id === task.current_attempt_id) ?? null;
    return { ...task, current_attempt, attempts, runs, comments, questions };
  }

  // ---- comments -------------------------------------------------------------
  async addComment(
    taskId: string,
    input: { kind: Comment['kind']; body: string; file_path?: string | null; line?: number | null },
  ): Promise<Comment> {
    const task = await this.store.getTask(taskId);
    return this.store.insertComment({
      task_id: task.id,
      attempt_id: task.current_attempt_id,
      kind: input.kind,
      body: input.body,
      file_path: input.file_path ?? null,
      line: input.line ?? null,
    });
  }

  async deleteComment(commentId: string): Promise<void> {
    const c = await this.store.findComment(commentId);
    if (!c) throw new CoreError('NOT_FOUND', `comment ${commentId} not found`);
    if (c.consumed_by_run_id) throw new CoreError('CONFLICT', 'comment was already sent to the agent');
    await this.store.deleteComment(commentId);
  }

  // ---- helpers --------------------------------------------------------------
  async hasActiveRun(taskId: string): Promise<boolean> {
    return (await this.store.activeRuns(taskId)).length > 0;
  }

  async activeAttempt(task: Task): Promise<Attempt | null> {
    if (!task.current_attempt_id) return null;
    const a = await this.store.findAttempt(task.current_attempt_id);
    return a && a.status === 'active' ? a : null;
  }

  private async executorFor(task: Task, project: Project) {
    return getExecutor(this.ctx.executors, task.executor ?? project.default_executor);
  }

  // ---- transition -----------------------------------------------------------
  async transition(
    taskId: string,
    target: Column,
    actor: Actor,
    payload: TransitionPayload = {},
  ): Promise<Task> {
    const task = await this.store.getTask(taskId);
    const project = await this.store.getProject(task.project_id);
    const activeAttempt = await this.activeAttempt(task);
    const decision = decide(
      {
        task,
        project,
        hasActiveRun: await this.hasActiveRun(taskId),
        unconsumedFeedback: (await this.store.unconsumedFeedback(taskId)).length,
        activeAttempt,
      },
      target,
      actor,
      payload,
    );
    this.ctx.logger.info(
      { task: taskId, from: `${task.column}/${task.substate}`, target, actor, decision: decision.kind },
      'transition',
    );
    const positionPatch = payload.position !== undefined ? { position: payload.position } : {};
    const updated = await this.apply(task, project, activeAttempt, decision, payload, positionPatch, target);
    return updated;
  }

  private async apply(
    task: Task,
    project: Project,
    activeAttempt: Attempt | null,
    decision: Decision,
    payload: TransitionPayload,
    positionPatch: { position?: number },
    target: Column,
  ): Promise<Task> {
    const extra: Partial<Task> = { ...positionPatch };
    if (payload.plan !== undefined) extra.plan = payload.plan;
    if (payload.refinement_session_id !== undefined)
      extra.refinement_session_id = payload.refinement_session_id;
    if (payload.refinement_incomplete !== undefined)
      extra.refinement_incomplete = payload.refinement_incomplete;
    // last_error: set on error transitions, cleared on any other successful transition
    extra.last_error = payload.error_message ?? null;

    const positionFor = async (column: Column) =>
      positionPatch.position !== undefined || column === task.column
        ? {}
        : { position: await this.store.nextPosition(project.id, column) };

    switch (decision.kind) {
      case 'noop':
        return Object.keys(positionPatch).length ? this.store.updateTask(task.id, positionPatch) : task;

      case 'set':
        return this.store.setTaskState(task.id, decision.column, decision.substate, {
          ...extra,
          ...(await positionFor(decision.column)),
        });

      case 'start_refine': {
        const t = await this.store.setTaskState(task.id, 'backlog', 'refining', {
          ...extra,
          refinement_incomplete: false,
        });
        try {
          await this.deps.refinement().start(t);
        } catch (err) {
          return this.store.setTaskState(task.id, 'backlog', 'draft', { last_error: errorMessage(err) });
        }
        return this.store.getTask(task.id);
      }

      case 'start_attempt':
        return this.startAttempt(task, project, { ...extra, ...(await positionFor('doing')) });

      case 'followup': {
        if (!activeAttempt)
          throw new CoreError('INVALID_TRANSITION', 'no active attempt to send feedback to');
        const feedback = await this.store.unconsumedFeedback(task.id);
        const adapter = getExecutor(this.ctx.executors, activeAttempt.executor);
        const lastSession = adapter.supportsResume ? await this.store.lastSessionRun(activeAttempt.id) : null;
        const prompt = lastSession
          ? buildFollowupPrompt(feedback)
          : buildFollowupPromptWithoutResume(
              task,
              (await this.deps.attempts.diff(activeAttempt)).patch,
              feedback,
            );
        const run = await this.deps.runs.create({
          task,
          attempt: activeAttempt,
          kind: 'followup',
          executor: activeAttempt.executor,
          prompt,
          resumeSessionId: lastSession?.session_id ?? null,
        });
        await this.store.markCommentsConsumed(
          feedback.map((c) => c.id),
          run.id,
        );
        return this.store.setTaskState(task.id, 'doing', 'queued', {
          ...extra,
          ...(await positionFor('doing')),
        });
      }

      case 'retry': {
        if (!activeAttempt) throw new CoreError('INVALID_TRANSITION', 'no active attempt to retry');
        const adapter = getExecutor(this.ctx.executors, activeAttempt.executor);
        const lastSession = adapter.supportsResume ? await this.store.lastSessionRun(activeAttempt.id) : null;
        const runs = await this.store.listRuns(task.id);
        const lastRun = [...runs].reverse().find((r) => r.attempt_id === activeAttempt.id);
        const prompt = lastSession
          ? buildRetryPrompt(lastRun?.error_message ?? task.last_error)
          : buildExecutePrompt({
              task,
              worktreePath: activeAttempt.worktree_path,
              repoPath: project.repo_path,
              resumingRefinement: false,
            });
        await this.deps.runs.create({
          task,
          attempt: activeAttempt,
          kind: lastSession ? 'followup' : 'execute',
          executor: activeAttempt.executor,
          prompt,
          resumeSessionId: lastSession?.session_id ?? null,
        });
        return this.store.setTaskState(task.id, 'doing', 'queued', { ...extra, last_error: null });
      }

      case 'merge': {
        if (!activeAttempt) throw new CoreError('INVALID_TRANSITION', 'no active attempt to merge');
        await this.deps.attempts.merge(task, activeAttempt, project);
        return this.store.setTaskState(task.id, 'done', null, { ...extra, ...(await positionFor('done')) });
      }

      case 'discard': {
        if (activeAttempt) await this.deps.attempts.discard(activeAttempt, project);
        const substate = decision.column === 'todo' ? 'ready' : 'draft';
        return this.store.setTaskState(task.id, decision.column, substate, {
          ...extra,
          current_attempt_id: null,
          ...(await positionFor(decision.column)),
        });
      }
    }
    throw new CoreError('INTERNAL', `unhandled decision for ${target}`);
  }

  private async startAttempt(
    task: Task,
    project: Project,
    extra: Partial<Task>,
    opts: { previousFeedback?: Comment[] } = {},
  ): Promise<Task> {
    const adapter = await this.executorFor(task, project);
    const attempt = await this.deps.attempts.create(task, project, adapter.id);
    // Resume the refinement session only for a fresh (non-restart) attempt with the same executor.
    const refineRun = task.refinement_session_id ? await this.store.lastRefineRun(task.id) : null;
    const resumeRefinement =
      !opts.previousFeedback &&
      adapter.supportsResume &&
      !!task.refinement_session_id &&
      refineRun?.executor === adapter.id;
    const prompt = buildExecutePrompt({
      task,
      worktreePath: attempt.worktree_path,
      repoPath: project.repo_path,
      resumingRefinement: resumeRefinement,
      previousFeedback: opts.previousFeedback,
    });
    try {
      await this.deps.runs.create({
        task,
        attempt,
        kind: 'execute',
        executor: adapter.id,
        prompt,
        resumeSessionId: resumeRefinement ? task.refinement_session_id : null,
        setupScript: project.setup_script,
      });
    } catch (err) {
      await this.deps.attempts.discard(attempt, project).catch(() => {});
      throw err;
    }
    return this.store.setTaskState(task.id, 'doing', 'queued', { ...extra, current_attempt_id: attempt.id });
  }

  // ---- attempt actions ------------------------------------------------------
  /** Discard current attempt and start a fresh one with all previous feedback in the prompt. */
  async restartAttempt(taskId: string): Promise<Task> {
    const task = await this.store.getTask(taskId);
    if (task.column !== 'doing' && task.column !== 'review') {
      throw new CoreError('INVALID_TRANSITION', 'Restart is only available from DOING or REVIEW');
    }
    if (await this.hasActiveRun(taskId))
      throw new CoreError('INVALID_TRANSITION', 'cancel the running agent first');
    const project = await this.store.getProject(task.project_id);
    const attempt = await this.activeAttempt(task);
    if (attempt) await this.deps.attempts.discard(attempt, project);
    const feedback = await this.store.allFeedback(taskId);
    const cleared = await this.store.updateTask(taskId, { current_attempt_id: null, last_error: null });
    return this.startAttempt(cleared, project, {}, { previousFeedback: feedback });
  }

  /** Discard the current attempt and move the task back to TODO. */
  async discardAttempt(taskId: string): Promise<Task> {
    const task = await this.store.getTask(taskId);
    if (task.column === 'done') throw new CoreError('INVALID_TRANSITION', 'DONE tasks are immutable');
    if (await this.hasActiveRun(taskId))
      throw new CoreError('INVALID_TRANSITION', 'cancel the running agent first');
    const attempt = await this.activeAttempt(task);
    if (!attempt) throw new CoreError('CONFLICT', 'task has no active attempt');
    const project = await this.store.getProject(task.project_id);
    await this.deps.attempts.discard(attempt, project);
    return this.store.setTaskState(task.id, 'todo', 'ready', {
      current_attempt_id: null,
      last_error: null,
      position: await this.store.nextPosition(project.id, 'todo'),
    });
  }

  /** Cancel a run: kill the process if running, or drop it from the queue. */
  async cancelRun(runId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (run.status === 'running') {
      if (!this.deps.runner().cancelRun(runId)) {
        // Not owned by this process (stale) → finalise directly.
        const failed = await this.store.updateRun(runId, {
          status: 'cancelled',
          error_message: 'cancelled by user',
          finished_at: new Date().toISOString(),
        });
        await this.store.enqueueJob('post_run', {
          runId: failed.id,
          taskId: failed.task_id,
          projectId: (await this.store.getTask(failed.task_id)).project_id,
        });
      }
      return;
    }
    if (run.status === 'queued') {
      const cancelled = await this.store.updateRun(runId, {
        status: 'cancelled',
        error_message: 'cancelled before start',
        finished_at: new Date().toISOString(),
      });
      const task = await this.store.getTask(cancelled.task_id);
      await this.store.enqueueJob('post_run', { runId, taskId: task.id, projectId: task.project_id });
      return;
    }
    throw new CoreError('CONFLICT', `run is already ${run.status}`);
  }
}
