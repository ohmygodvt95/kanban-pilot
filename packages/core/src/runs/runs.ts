import type { Attempt, ExecutorId, Run, RunKind, Task } from '@agent-kanban/shared';
import type { CoreContext } from '../context.js';

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

  /** Insert a queued run and enqueue the job that will execute it. */
  async create(input: CreateRunInput): Promise<Run> {
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
    if (input.setupScript?.trim() && input.attempt) {
      const payload: SetupJobPayload = { ...base, attemptId: input.attempt.id, script: input.setupScript };
      await this.ctx.store.enqueueJob('setup_worktree', payload);
    } else {
      await this.ctx.store.enqueueJob('run_agent', base);
    }
    return run;
  }
}
