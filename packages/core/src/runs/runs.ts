import {
  type Attempt,
  type ExecutorId,
  PRIORITY_WEIGHT,
  type Run,
  type RunKind,
  type Task,
} from '@agent-kanban/shared';
import type { CoreContext } from '../context.js';
import { CoreError } from '../util/errors.js';

export interface CreateRunInput {
  task: Task;
  attempt: Attempt | null;
  kind: RunKind;
  executor: ExecutorId;
  prompt: string;
  resumeSessionId?: string | null;
  /** Run the project's setup_script in the worktree before the agent (fresh attempts). */
  setupScript?: string | null;
  /** Set when this run replaces one whose session could not be resumed. */
  fallbackOfRunId?: string | null;
}

export interface RunAgentJobPayload {
  runId: string;
  taskId: string;
  projectId: string;
}

export interface SetupJobPayload extends RunAgentJobPayload {
  attemptId: string;
  script: string;
  log?: string;
}

export interface PostRunJobPayload {
  runId: string;
  taskId: string;
  projectId: string;
}

export interface RunTestsJobPayload {
  attemptId: string;
  taskId: string;
  projectId: string;
}

export class RunService {
  constructor(private readonly ctx: CoreContext) {}

  /**
   * Refuse new runs once the project's daily/weekly spending cap is reached
   * (CONFLICT, code surfaced to the UI as a 409). Spend counts every run kind.
   */
  async assertBudget(projectId: string): Promise<void> {
    const project = await this.ctx.store.getProject(projectId);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (project.daily_budget_usd != null) {
      const spent = await this.ctx.store.spentSince(projectId, today.toISOString());
      if (spent >= project.daily_budget_usd)
        throw new CoreError(
          'CONFLICT',
          `daily budget reached ($${spent.toFixed(2)} of $${project.daily_budget_usd.toFixed(2)} today); raise it in Settings or wait for tomorrow`,
        );
    }
    if (project.weekly_budget_usd != null) {
      const week = new Date(today.getTime() - 6 * 86_400_000);
      const spent = await this.ctx.store.spentSince(projectId, week.toISOString());
      if (spent >= project.weekly_budget_usd)
        throw new CoreError(
          'CONFLICT',
          `weekly budget reached ($${spent.toFixed(2)} of $${project.weekly_budget_usd.toFixed(2)} in 7 days); raise it in Settings`,
        );
    }
  }

  /** Insert a queued run and enqueue the job that will execute it. */
  async create(input: CreateRunInput): Promise<Run> {
    await this.assertBudget(input.task.project_id);
    const run = await this.ctx.store.insertRun({
      task_id: input.task.id,
      attempt_id: input.attempt?.id ?? null,
      kind: input.kind,
      executor: input.executor,
      prompt: input.prompt,
      status: 'queued',
      resumed_from_session_id: input.resumeSessionId ?? null,
      fallback_of_run_id: input.fallbackOfRunId ?? null,
    });
    const base: RunAgentJobPayload = {
      runId: run.id,
      taskId: input.task.id,
      projectId: input.task.project_id,
    };
    // Urgent tasks jump the queue when max_concurrent_runs is saturated.
    const priority = input.task.priority ? PRIORITY_WEIGHT[input.task.priority] : PRIORITY_WEIGHT.medium;
    if (input.setupScript?.trim() && input.attempt) {
      const payload: SetupJobPayload = { ...base, attemptId: input.attempt.id, script: input.setupScript };
      await this.ctx.store.enqueueJob('setup_worktree', payload, { priority });
    } else {
      await this.ctx.store.enqueueJob('run_agent', base, { priority });
    }
    return run;
  }
}
