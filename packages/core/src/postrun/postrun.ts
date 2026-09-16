/**
 * Post-run pipeline (spec §10.3): verify diff → commit → tests → push → REVIEW
 * (or DOING(error)). Refine and planner-chat runs are delegated to RefinementService.
 * Messages queued in the Chat tab while the agent was running are sent right after.
 */
import type { Run } from '@agent-kanban/shared';
import type { AttemptService } from '../attempts/attempts.js';
import type { CoreContext } from '../context.js';
import { commitAll, hasChanges, push } from '../git/git.js';
import { commitMessage } from '../prompts/prompts.js';
import type { RefinementService } from '../refinement/refinement.js';
import type { JobRunner } from '../runner/runner.js';
import type { TaskService } from '../state/tasks.js';
import { errorMessage } from '../util/errors.js';

export interface PostRunDeps {
  tasks: () => TaskService;
  runner: () => JobRunner;
  attempts: AttemptService;
  refinement: RefinementService;
}

export class PostRunPipeline {
  constructor(
    private readonly ctx: CoreContext,
    private readonly deps: PostRunDeps,
  ) {}

  async handle(runId: string): Promise<void> {
    const run = await this.ctx.store.getRun(runId);
    if (run.kind === 'refine') return this.deps.refinement.handleRunFinished(run);
    if (run.kind === 'chat') return this.deps.refinement.handleChatFinished(run);
    await this.handleExecution(run);
  }

  private async handleExecution(run: Run): Promise<void> {
    const store = this.ctx.store;
    const tasks = this.deps.tasks();
    const task = await store.getTask(run.task_id);
    if (task.column !== 'doing') {
      this.ctx.logger.warn(
        { task: task.id, column: task.column, run: run.id },
        'run finished but task is not in DOING',
      );
      return;
    }
    const fail = (message: string) =>
      tasks.transition(task.id, 'doing', 'system', { substate: 'error', error_message: message });

    if (run.status !== 'succeeded') return void (await fail(run.error_message ?? `run ${run.status}`));
    if (!run.attempt_id) return void (await fail('run has no attempt'));
    const attempt = await store.getAttempt(run.attempt_id);
    const project = await store.getProject(task.project_id);

    const exclude = await this.deps.attempts.excludedPaths(attempt);
    if (!(await hasChanges(attempt.worktree_path, attempt.base_commit, { exclude }))) {
      return void (await fail('the agent finished without changing any files'));
    }
    try {
      await commitAll(attempt.worktree_path, commitMessage(task, attempt.id), { exclude });
    } catch (err) {
      return void (await fail(`commit failed: ${errorMessage(err)}`));
    }

    let testsOk: boolean | null = null;
    if (project.test_script?.trim())
      testsOk = await this.deps.runner().runTestsFor(attempt, project.test_script);

    const pushed = await push(attempt.worktree_path, attempt.branch);
    if (!pushed.ok)
      this.ctx.logger.warn({ attempt: attempt.id, reason: pushed.message }, 'push skipped/failed');

    await tasks.transition(task.id, 'review', 'system', {
      substate: testsOk === false ? 'tests_failed' : 'pending',
    });

    // Messages typed while the agent was busy → send them now as a followup.
    if ((await store.unconsumedFeedback(task.id)).length > 0) {
      await tasks.transition(task.id, 'doing', 'user');
      return;
    }
    if (project.auto_done && testsOk === true) {
      try {
        await tasks.transition(task.id, 'done', 'system');
      } catch (err) {
        this.ctx.logger.warn(
          { task: task.id, err: errorMessage(err) },
          'auto_done merge failed; staying in REVIEW',
        );
        await store.updateTask(task.id, { last_error: `auto merge failed: ${errorMessage(err)}` });
      }
    }
  }
}
