import type { Run } from '@agent-kanban/shared';
import type { AttemptService } from '../attempts/attempts.js';
import type { CoreContext } from '../context.js';
import { commitAll, hasChanges, push } from '../git/git.js';
import { commitMessage } from '../prompts/prompts.js';
import type { RefinementService } from '../refinement/refinement.js';
import { runScript } from '../runner/process.js';
import type { TaskService } from '../state/tasks.js';
import { errorMessage } from '../util/errors.js';

export interface PostRunDeps {
  tasks: () => TaskService;
  attempts: AttemptService;
  refinement: RefinementService;
}

export const TEST_TIMEOUT_MS = 10 * 60_000;

/**
 * Post-run pipeline (spec §10.3): verify diff, commit, run tests, push, and move
 * the task to REVIEW (or DOING(error)). Refine runs are delegated to RefinementService.
 */
export class PostRunPipeline {
  constructor(
    private readonly ctx: CoreContext,
    private readonly deps: PostRunDeps,
  ) {}

  async handle(runId: string): Promise<void> {
    const run = await this.ctx.store.getRun(runId);
    if (run.kind === 'refine') {
      await this.deps.refinement.handleRunFinished(run);
      return;
    }
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

    if (run.status !== 'succeeded') {
      await fail(run.error_message ?? `run ${run.status}`);
      return;
    }
    if (!run.attempt_id) {
      await fail('run has no attempt');
      return;
    }
    const attempt = await store.getAttempt(run.attempt_id);
    const project = await store.getProject(task.project_id);

    const exclude = await this.deps.attempts.excludedPaths(attempt);
    if (!(await hasChanges(attempt.worktree_path, attempt.base_commit, { exclude }))) {
      await fail('agent kết thúc nhưng không thay đổi file nào');
      return;
    }
    try {
      await commitAll(attempt.worktree_path, commitMessage(task, attempt.id), { exclude });
    } catch (err) {
      await fail(`commit failed: ${errorMessage(err)}`);
      return;
    }

    let testsOk: boolean | null = null;
    if (project.test_script?.trim()) {
      const res = await runScript(project.test_script, attempt.worktree_path, TEST_TIMEOUT_MS);
      testsOk = res.ok;
      await store.updateAttempt(attempt.id, { last_test_output: res.output, last_test_ok: res.ok });
    }

    const pushed = await push(attempt.worktree_path, attempt.branch);
    if (!pushed.ok)
      this.ctx.logger.warn({ attempt: attempt.id, reason: pushed.message }, 'push skipped/failed');

    await tasks.transition(task.id, 'review', 'system', {
      substate: testsOk === false ? 'tests_failed' : 'pending',
    });

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
