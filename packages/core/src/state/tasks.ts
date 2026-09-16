/**
 * Task use-cases. `transition()` is the single entry point for column changes:
 * it validates via the pure state machine (machine.ts), applies side effects,
 * persists and emits. Everything else here (chat, restart, update-from-base…)
 * ends up calling `transition()` rather than touching columns directly.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Attachment,
  Attempt,
  Column,
  Comment,
  Project,
  Run,
  Task,
  TaskDetail,
} from '@agent-kanban/shared';
import type { AttemptService } from '../attempts/attempts.js';
import type { CoreContext } from '../context.js';
import { getExecutor } from '../executors/registry.js';
import { remoteUrl } from '../git/git.js';
import type { IssueService } from '../issues.js';
import {
  buildExecutePrompt,
  buildFollowupPrompt,
  buildFollowupPromptWithoutResume,
  buildPlannerChatPrompt,
  buildResolveConflictsPrompt,
  buildRetryPrompt,
  type PromptContext,
  renderRefinePrompt,
} from '../prompts/prompts.js';
import { detectProvider } from '../providers/index.js';
import type { RefinementService } from '../refinement/refinement.js';
import type { JobRunner } from '../runner/runner.js';
import type { RunService, RunTestsJobPayload } from '../runs/runs.js';
import { CoreError, errorMessage } from '../util/errors.js';
import { newId } from '../util/ids.js';
import { type Actor, type Decision, decide, type TransitionPayload } from './machine.js';

/** An image uploaded with a chat message. */
export interface UploadedFile {
  name: string;
  mime: string;
  data: Uint8Array;
}

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME = /^image\/(png|jpeg|gif|webp)$/;

/** Safe on-disk name: keep the extension, drop anything odd. */
export function safeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(-80) || 'image';
}

/** Absolute path of an attachment's bytes (shared with the runner). */
export function attachmentFilePath(
  attachmentsRoot: string,
  a: Pick<Attachment, 'id' | 'comment_id' | 'name'>,
): string {
  return join(attachmentsRoot, a.comment_id, `${a.id}-${safeFileName(a.name)}`);
}

/** Task columns that may be written by services (computed fields excluded). */
type TaskPatch = Omit<Task, 'total_cost_usd' | 'unconsumed_feedback'>;

export interface TaskServiceDeps {
  attempts: AttemptService;
  runs: RunService;
  refinement: () => RefinementService;
  runner: () => JobRunner;
  issues: () => IssueService;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  executor?: Task['executor'];
  model?: string | null;
  browser?: boolean | null;
  kind?: Task['kind'];
  priority?: Task['priority'];
  skip_refinement?: boolean;
  source_url?: string | null;
  source_provider?: Task['source_provider'];
  source_external_id?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  executor?: Task['executor'];
  model?: string | null;
  browser?: boolean | null;
  kind?: Task['kind'];
  priority?: Task['priority'];
  skip_refinement?: boolean;
  position?: number;
  source_url?: string | null;
}

/** Prompt language + template overrides for a project. */
export function promptContext(project: Project, task?: Pick<Task, 'browser'>): PromptContext {
  return {
    lang: project.prompt_language,
    browser: task?.browser ?? project.browser_enabled,
    overrides: {
      execute: project.execute_prompt,
      followup: project.followup_prompt,
      refine: project.refinement_prompt,
    },
  };
}

export class TaskService {
  constructor(
    private readonly ctx: CoreContext,
    private readonly deps: TaskServiceDeps,
  ) {}

  private get store() {
    return this.ctx.store;
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

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
      model: input.model ?? null,
      browser: input.browser ?? null,
      kind: input.kind ?? null,
      priority: input.priority ?? null,
      skip_refinement: input.skip_refinement ?? false,
      source_url: input.source_url ?? null,
      source_provider: input.source_provider ?? null,
      source_external_id: input.source_external_id ?? null,
    });
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const task = await this.store.getTask(id);
    const editsText = input.title !== undefined || input.description !== undefined;
    if (editsText && (await this.hasActiveRun(id))) {
      throw new CoreError('CONFLICT', 'cannot edit title/description while a run is active');
    }
    if (task.column === 'done' && editsText) throw new CoreError('CONFLICT', 'DONE tasks are immutable');
    const patch: Partial<TaskPatch> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.executor !== undefined) patch.executor = input.executor;
    if (input.model !== undefined) patch.model = input.model;
    if (input.browser !== undefined) patch.browser = input.browser;
    if (input.kind !== undefined) patch.kind = input.kind;
    if (input.priority !== undefined) patch.priority = input.priority;
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
      model: task.model,
      browser: task.browser,
      kind: task.kind,
      priority: task.priority,
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

  // ---------------------------------------------------------------------------
  // comments
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  async hasActiveRun(taskId: string): Promise<boolean> {
    return (await this.store.activeRuns(taskId)).length > 0;
  }

  async activeAttempt(task: Task): Promise<Attempt | null> {
    if (!task.current_attempt_id) return null;
    const a = await this.store.findAttempt(task.current_attempt_id);
    return a && a.status === 'active' ? a : null;
  }

  private executorFor(task: Task, project: Project) {
    return getExecutor(this.ctx.executors, task.executor ?? project.default_executor);
  }

  /** Followup prompt for an attempt: resume the last session if the executor can, else description + diff. */
  private async followupPrompt(task: Task, project: Project, attempt: Attempt, feedback: Comment[]) {
    const ctx = promptContext(project, task);
    const adapter = getExecutor(this.ctx.executors, attempt.executor);
    const lastSession = adapter.supportsResume ? await this.store.lastSessionRun(attempt.id) : null;
    const prompt = lastSession
      ? buildFollowupPrompt(ctx, feedback, this.attachmentPath)
      : buildFollowupPromptWithoutResume(
          ctx,
          task,
          (await this.deps.attempts.diff(attempt, project)).patch,
          feedback,
          this.attachmentPath,
        );
    return { prompt, resumeSessionId: lastSession?.session_id ?? null };
  }

  /** Absolute path of an attachment's bytes. */
  readonly attachmentPath = (a: Attachment): string => attachmentFilePath(this.ctx.paths.attachmentsRoot, a);

  /** Persist uploaded images for a comment; returns the attachment records. */
  private async storeAttachments(
    taskId: string,
    commentId: string,
    files: UploadedFile[],
  ): Promise<Attachment[]> {
    const out: Attachment[] = [];
    for (const f of files) {
      if (!IMAGE_MIME.test(f.mime)) {
        throw new CoreError(
          'VALIDATION',
          `unsupported attachment type ${f.mime} (png, jpeg, gif, webp only)`,
        );
      }
      if (f.data.byteLength > MAX_ATTACHMENT_BYTES)
        throw new CoreError('VALIDATION', `${f.name} is larger than 10 MB`);
      const att = await this.ctx.store.insertAttachment({
        id: newId(),
        comment_id: commentId,
        task_id: taskId,
        name: f.name,
        mime: f.mime,
        size: f.data.byteLength,
      });
      const path = this.attachmentPath(att);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, f.data);
      out.push(att);
    }
    return out;
  }

  /**
   * Start a TODO task automatically when the project asks for it. Concurrency is
   * enforced by the runner (the task sits in DOING(queued) until a slot frees up).
   */
  private async maybeAutoStart(task: Task): Promise<Task> {
    if (task.column !== 'todo') return task;
    const project = await this.store.getProject(task.project_id);
    if (!project.auto_start) return task;
    try {
      return await this.transition(task.id, 'doing', 'system', { auto_start: true });
    } catch (err) {
      this.ctx.logger.warn({ task: task.id, err: errorMessage(err) }, 'auto-start failed');
      return this.store.updateTask(task.id, { last_error: `auto-start failed: ${errorMessage(err)}` });
    }
  }

  /** Start every TODO task of a project (used when auto_start is switched on). */
  async autoStartPending(projectId: string): Promise<number> {
    let started = 0;
    for (const task of await this.store.listTasks(projectId)) {
      if (task.column !== 'todo') continue;
      const after = await this.maybeAutoStart(task);
      if (after.column === 'doing') started++;
    }
    return started;
  }

  // ---------------------------------------------------------------------------
  // transition
  // ---------------------------------------------------------------------------

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
    const result = await this.apply(task, project, activeAttempt, decision, payload, positionPatch);
    // Mirror milestones on the linked issue (fire-and-forget; never blocks the transition).
    const status = this.deps.issues().statusFor(task, result);
    if (status) void this.deps.issues().syncTask(result, status);
    // A task that just became TODO(ready) may be started right away by the project.
    return result.column === 'todo' && task.column !== 'todo' ? this.maybeAutoStart(result) : result;
  }

  private async apply(
    task: Task,
    project: Project,
    activeAttempt: Attempt | null,
    decision: Decision,
    payload: TransitionPayload,
    positionPatch: { position?: number },
  ): Promise<Task> {
    const extra: Partial<TaskPatch> = { ...positionPatch };
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
        const { prompt, resumeSessionId } = await this.followupPrompt(task, project, activeAttempt, feedback);
        const run = await this.deps.runs.create({
          task,
          attempt: activeAttempt,
          kind: 'followup',
          executor: activeAttempt.executor,
          prompt,
          resumeSessionId,
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
        const ctx = promptContext(project, task);
        const adapter = getExecutor(this.ctx.executors, activeAttempt.executor);
        const lastSession = adapter.supportsResume ? await this.store.lastSessionRun(activeAttempt.id) : null;
        const lastRun = [...(await this.store.listRuns(task.id))]
          .reverse()
          .find((r) => r.attempt_id === activeAttempt.id);
        const feedback = await this.store.unconsumedFeedback(task.id);
        const prompt = lastSession
          ? buildRetryPrompt(ctx, lastRun?.error_message ?? task.last_error, feedback, this.attachmentPath)
          : buildExecutePrompt(ctx, {
              task,
              worktreePath: activeAttempt.worktree_path,
              repoPath: project.repo_path,
              resumingRefinement: false,
              previousFeedback: feedback.length ? feedback : undefined,
              attachmentPath: this.attachmentPath,
            });
        const run = await this.deps.runs.create({
          task,
          attempt: activeAttempt,
          kind: lastSession ? 'followup' : 'execute',
          executor: activeAttempt.executor,
          prompt,
          resumeSessionId: lastSession?.session_id ?? null,
        });
        await this.store.markCommentsConsumed(
          feedback.map((c) => c.id),
          run.id,
        );
        return this.store.setTaskState(task.id, 'doing', 'queued', { ...extra, last_error: null });
      }

      case 'merge': {
        if (!activeAttempt) throw new CoreError('INVALID_TRANSITION', 'no active attempt to merge');
        if (project.done_action === 'pr') {
          const detected = detectProvider(this.ctx.providers, await remoteUrl(project.repo_path));
          if (!detected)
            throw new CoreError(
              'CONFLICT',
              'done_action is "pr" but the origin remote is not hosted by a supported provider (GitHub)',
            );
          const check = await detected.provider.check();
          if (!check.ok) throw new CoreError('CONFLICT', check.message ?? 'provider is not configured');
          await this.deps.attempts.openPullRequest(
            task,
            activeAttempt,
            project,
            detected.provider,
            detected.projectRef,
          );
        } else {
          await this.deps.attempts.merge(task, activeAttempt, project);
        }
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
  }

  /** Create attempt (worktree + branch) and the initial execute run. */
  private async startAttempt(
    task: Task,
    project: Project,
    extra: Partial<TaskPatch>,
    opts: { previousFeedback?: Comment[] } = {},
  ): Promise<Task> {
    const adapter = this.executorFor(task, project);
    const attempt = await this.deps.attempts.create(task, project, adapter.id);
    // Resume the refinement session only for a fresh (non-restart) attempt with the same executor.
    const refineRun = task.refinement_session_id ? await this.store.lastRefineRun(task.id) : null;
    const resumeRefinement =
      !opts.previousFeedback &&
      adapter.supportsResume &&
      !!task.refinement_session_id &&
      refineRun?.executor === adapter.id;
    const prompt = buildExecutePrompt(promptContext(project, task), {
      task,
      worktreePath: attempt.worktree_path,
      repoPath: project.repo_path,
      resumingRefinement: resumeRefinement,
      previousFeedback: opts.previousFeedback,
      attachmentPath: this.attachmentPath,
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

  // ---------------------------------------------------------------------------
  // chat
  // ---------------------------------------------------------------------------

  /**
   * Send a free-form message to the agent.
   *  - REVIEW / DOING(error): becomes feedback and resumes the attempt's session (followup / retry).
   *  - DOING(queued|running): queued; the post-run pipeline sends it as soon as the run ends.
   *  - BACKLOG / TODO: chats with the planner (read-only refine session) and may update the plan.
   */
  async chat(taskId: string, message: string, files: UploadedFile[] = []): Promise<Task> {
    const task = await this.store.getTask(taskId);
    const body = message.trim();
    if (!body && files.length === 0) throw new CoreError('VALIDATION', 'message is empty');
    const insert = async (attemptId: string | null) => {
      const comment = await this.store.insertComment({
        task_id: task.id,
        attempt_id: attemptId,
        kind: 'chat',
        body: body || '(image)',
      });
      const stored = await this.storeAttachments(task.id, comment.id, files);
      return { ...comment, attachments: stored };
    };
    if (task.column === 'done')
      throw new CoreError('INVALID_TRANSITION', 'DONE tasks are immutable; clone the task to continue');
    const project = await this.store.getProject(task.project_id);

    if (task.column === 'doing' && task.substate !== 'error') {
      // Agent busy in the worktree → queue; delivered by PostRunPipeline once the run finishes.
      if (!(await this.activeAttempt(task))) throw new CoreError('CONFLICT', 'task has no active attempt');
      await insert(task.current_attempt_id);
      return this.store.touchTask(taskId);
    }
    if (await this.hasActiveRun(taskId)) {
      throw new CoreError('CONFLICT', 'the planner is still answering; wait for it to finish');
    }

    if (task.column === 'review' || (task.column === 'doing' && task.substate === 'error')) {
      if (!(await this.activeAttempt(task))) throw new CoreError('CONFLICT', 'task has no active attempt');
      await insert(task.current_attempt_id);
      return task.column === 'review'
        ? this.transition(taskId, 'doing', 'user')
        : this.transition(taskId, 'doing', 'user', { action: 'retry' });
    }

    // backlog / todo → planner chat
    const adapter = this.executorFor(task, project);
    const comment = await insert(null);
    const qa = await this.store.listQuestions(task.id);
    const resume = adapter.supportsResume && !!task.refinement_session_id;
    const prompt = buildPlannerChatPrompt(promptContext(project), task, body, qa, {
      structuredOutputSupported: adapter.supportsStructuredOutput,
      resuming: resume,
      attachments: comment.attachments.map(this.attachmentPath),
    });
    const run = await this.deps.runs.create({
      task,
      attempt: null,
      kind: 'chat',
      executor: adapter.id,
      prompt,
      resumeSessionId: resume ? task.refinement_session_id : null,
    });
    await this.store.markCommentsConsumed([comment.id], run.id);
    return this.store.touchTask(taskId);
  }

  // ---------------------------------------------------------------------------
  // attempt actions
  // ---------------------------------------------------------------------------

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

  /**
   * Merge the base branch into the attempt. Without conflicts the task stays where
   * it is; with conflicts a followup run asks the agent to resolve them.
   */
  async updateFromBase(taskId: string): Promise<{ task: Task; conflicts: string[] }> {
    const task = await this.store.getTask(taskId);
    if (!(task.column === 'review' || (task.column === 'doing' && task.substate === 'error'))) {
      throw new CoreError('INVALID_TRANSITION', 'Update from base is available in REVIEW or DOING(error)');
    }
    if (await this.hasActiveRun(taskId))
      throw new CoreError('INVALID_TRANSITION', 'cancel the running agent first');
    const attempt = await this.activeAttempt(task);
    if (!attempt) throw new CoreError('CONFLICT', 'task has no active attempt');
    const project = await this.store.getProject(task.project_id);
    const res = await this.deps.attempts.updateFromBase(attempt, project);
    if (res.merged) return { task: await this.store.touchTask(taskId), conflicts: [] };
    // Conflicts: hand them to the agent as feedback (rendered as item 1 of the followup prompt).
    await this.store.insertComment({
      task_id: task.id,
      attempt_id: attempt.id,
      kind: 'chat',
      body: buildResolveConflictsPrompt(promptContext(project), project.base_branch, res.conflicts),
    });
    const updated =
      task.column === 'review'
        ? await this.transition(taskId, 'doing', 'user')
        : await this.transition(taskId, 'doing', 'user', { action: 'retry' });
    return { task: updated, conflicts: res.conflicts };
  }

  /** Re-run the project's test script on the current attempt (job `run_tests`). */
  async runTests(taskId: string): Promise<void> {
    const task = await this.store.getTask(taskId);
    const attempt = await this.activeAttempt(task);
    if (!attempt) throw new CoreError('CONFLICT', 'task has no active attempt');
    const project = await this.store.getProject(task.project_id);
    if (!project.test_script?.trim()) throw new CoreError('VALIDATION', 'the project has no test script');
    if (await this.hasActiveRun(taskId))
      throw new CoreError('CONFLICT', 'wait for the running agent to finish');
    const payload: RunTestsJobPayload = { attemptId: attempt.id, taskId: task.id, projectId: project.id };
    await this.store.enqueueJob('run_tests', payload);
  }

  /** Cancel a run: kill the process if running, or drop it from the queue. */
  async cancelRun(runId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (run.status === 'running') {
      if (!this.deps.runner().cancelRun(runId)) {
        // Not supervised by this process → kill by pid if we know it, then finalise directly.
        if (run.pid) {
          const { killTree } = await import('../runner/process.js');
          killTree(run.pid, 'SIGTERM');
        }
        const cancelled = await this.store.updateRun(runId, {
          status: 'cancelled',
          error_message: 'cancelled by user',
          finished_at: new Date().toISOString(),
          pid: null,
        });
        const task = await this.store.getTask(cancelled.task_id);
        await this.store.enqueueJob('post_run', { runId, taskId: task.id, projectId: task.project_id });
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

  // ---------------------------------------------------------------------------
  // session-lost fallback (called by the runner)
  // ---------------------------------------------------------------------------

  /**
   * `failed` could not resume its session. Create an equivalent run that starts a
   * fresh session with enough context, re-pointing consumed comments to it.
   * Returns false when nothing sensible can be done (caller then fails the task).
   */
  async createFallbackRun(failed: Run): Promise<boolean> {
    const task = await this.store.getTask(failed.task_id);
    const project = await this.store.getProject(task.project_id);
    const ctx = promptContext(project, task);
    const attempt = failed.attempt_id ? await this.store.findAttempt(failed.attempt_id) : null;
    const comments = await this.store.commentsConsumedBy(failed.id);
    const requeue = async () => {
      if (task.column === 'doing' && task.substate === 'running')
        await this.transition(task.id, 'doing', 'system', { substate: 'queued' });
    };
    switch (failed.kind) {
      case 'execute': {
        if (attempt?.status !== 'active') return false;
        const prompt = buildExecutePrompt(ctx, {
          task,
          worktreePath: attempt.worktree_path,
          repoPath: project.repo_path,
          resumingRefinement: false,
        });
        const run = await this.deps.runs.create({
          task,
          attempt,
          kind: 'execute',
          executor: failed.executor,
          prompt,
          fallbackOfRunId: failed.id,
        });
        await this.store.markCommentsConsumed(
          comments.map((c) => c.id),
          run.id,
        );
        await requeue();
        return true;
      }
      case 'followup': {
        if (attempt?.status !== 'active') return false;
        const diff = (await this.deps.attempts.diff(attempt, project)).patch;
        const prompt = comments.length
          ? buildFollowupPromptWithoutResume(ctx, task, diff, comments, this.attachmentPath)
          : buildExecutePrompt(ctx, {
              task,
              worktreePath: attempt.worktree_path,
              repoPath: project.repo_path,
              resumingRefinement: false,
            });
        const run = await this.deps.runs.create({
          task,
          attempt,
          kind: 'followup',
          executor: failed.executor,
          prompt,
          fallbackOfRunId: failed.id,
        });
        await this.store.markCommentsConsumed(
          comments.map((c) => c.id),
          run.id,
        );
        await requeue();
        return true;
      }
      case 'refine': {
        const adapter = getExecutor(this.ctx.executors, failed.executor);
        const prompt = renderRefinePrompt(ctx, task, await this.store.listQuestions(task.id), {
          structuredOutputSupported: adapter.supportsStructuredOutput,
        });
        await this.deps.runs.create({
          task,
          attempt: null,
          kind: 'refine',
          executor: failed.executor,
          prompt,
          fallbackOfRunId: failed.id,
        });
        await this.store.updateTask(task.id, { refinement_session_id: null });
        return true;
      }
      case 'chat': {
        const adapter = getExecutor(this.ctx.executors, failed.executor);
        const message = comments[0]?.body ?? '';
        if (!message) return false;
        const prompt = buildPlannerChatPrompt(ctx, task, message, await this.store.listQuestions(task.id), {
          structuredOutputSupported: adapter.supportsStructuredOutput,
          resuming: false,
          attachments: comments.flatMap((c) => c.attachments).map(this.attachmentPath),
        });
        const run = await this.deps.runs.create({
          task,
          attempt: null,
          kind: 'chat',
          executor: failed.executor,
          prompt,
          fallbackOfRunId: failed.id,
        });
        await this.store.markCommentsConsumed(
          comments.map((c) => c.id),
          run.id,
        );
        await this.store.updateTask(task.id, { refinement_session_id: null });
        return true;
      }
    }
  }
}
