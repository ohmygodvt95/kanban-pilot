import type { Run, Task } from '@agent-kanban/shared';
import { z } from 'zod';
import type { CoreContext } from '../context.js';
import { getExecutor } from '../executors/registry.js';
import { extractJsonObject } from '../executors/types.js';
import {
  appendOpenQuestionsToDescription,
  appendQaToDescription,
  renderRefinePrompt,
} from '../prompts/prompts.js';
import type { RunService } from '../runs/runs.js';
import type { TaskService } from '../state/tasks.js';
import { CoreError, errorMessage } from '../util/errors.js';

export const MAX_REFINE_ROUNDS = 3;

export const refineOutputSchema = z.object({
  ready: z.boolean(),
  questions: z.array(z.string()).default([]),
  plan: z.string().default(''),
  affected_files: z.array(z.string()).default([]),
});
export type RefineOutput = z.infer<typeof refineOutputSchema>;

export interface RefinementDeps {
  runs: RunService;
  tasks: () => TaskService;
}

export class RefinementService {
  constructor(
    private readonly ctx: CoreContext,
    private readonly deps: RefinementDeps,
  ) {}

  /** Create a refine run for a task that is in BACKLOG(refining). */
  async start(task: Task): Promise<Run> {
    const project = await this.ctx.store.getProject(task.project_id);
    const executorId = task.executor ?? project.default_executor;
    const adapter = getExecutor(this.ctx.executors, executorId);
    const questions = await this.ctx.store.listQuestions(task.id);
    const prompt = renderRefinePrompt(project.refinement_prompt, task, questions, {
      structuredOutputSupported: adapter.supportsStructuredOutput,
    });
    return this.deps.runs.create({
      task,
      attempt: null,
      kind: 'refine',
      executor: adapter.id,
      prompt,
      resumeSessionId: adapter.supportsResume ? task.refinement_session_id : null,
    });
  }

  /** Post-run handling for refine runs. */
  async handleRunFinished(run: Run): Promise<void> {
    const store = this.ctx.store;
    const task = await store.getTask(run.task_id);
    const tasks = this.deps.tasks();
    if (task.column !== 'backlog') {
      this.ctx.logger.warn(
        { task: task.id, column: task.column },
        'refine finished but task left backlog; ignoring',
      );
      return;
    }
    if (run.status !== 'succeeded') {
      await tasks.transition(task.id, 'backlog', 'system', {
        substate: 'draft',
        error_message: run.error_message ?? `refinement ${run.status}`,
      });
      return;
    }
    const output = await this.parseOutput(run);
    if (!output) {
      await tasks.transition(task.id, 'backlog', 'system', {
        substate: 'draft',
        error_message: 'refinement finished but returned no valid JSON (ready/questions/plan)',
        refinement_session_id: run.session_id ?? undefined,
      });
      return;
    }
    const rounds = await store.countRuns(task.id, 'refine', 'succeeded');
    const questions = output.questions.map((q) => q.trim()).filter(Boolean);
    if (output.ready || questions.length === 0) {
      await tasks.transition(task.id, 'todo', 'system', {
        plan: output.plan,
        refinement_session_id: run.session_id ?? undefined,
        refinement_incomplete: false,
      });
      return;
    }
    if (rounds >= MAX_REFINE_ROUNDS) {
      await store.updateTask(task.id, {
        description: appendOpenQuestionsToDescription(task.description, questions),
      });
      await tasks.transition(task.id, 'todo', 'system', {
        plan: output.plan,
        refinement_session_id: run.session_id ?? undefined,
        refinement_incomplete: true,
      });
      return;
    }
    await store.insertQuestions(task.id, run.id, questions);
    await tasks.transition(task.id, 'backlog', 'system', {
      substate: 'needs_answer',
      plan: output.plan,
      refinement_session_id: run.session_id ?? undefined,
    });
  }

  /** Record an answer; once every question of the latest round is answered, resume refinement. */
  async answer(taskId: string, questionId: string, answer: string): Promise<Task> {
    const store = this.ctx.store;
    const task = await store.getTask(taskId);
    const q = await store.findQuestion(questionId);
    if (!q || q.task_id !== taskId)
      throw new CoreError('NOT_FOUND', `question ${questionId} not found on task ${taskId}`);
    if (task.column !== 'backlog' || task.substate !== 'needs_answer') {
      throw new CoreError('INVALID_TRANSITION', 'task is not waiting for refinement answers');
    }
    await store.answerQuestion(questionId, answer);
    const all = await store.listQuestions(taskId);
    const latestRound = all.filter((x) => x.run_id === q.run_id);
    if (latestRound.some((x) => !x.answer)) return store.touchTask(taskId);

    const description = appendQaToDescription(task.description, latestRound);
    await store.updateTask(taskId, { description });
    const tasks = this.deps.tasks();
    const refining = await tasks.transition(taskId, 'backlog', 'system', { substate: 'refining' });
    try {
      await this.start(refining);
    } catch (err) {
      return tasks.transition(taskId, 'backlog', 'system', {
        substate: 'draft',
        error_message: errorMessage(err),
      });
    }
    return store.getTask(taskId);
  }

  private async parseOutput(run: Run): Promise<RefineOutput | null> {
    let candidate: unknown = run.structured_output ?? undefined;
    if (candidate === undefined || candidate === null) {
      const events = await this.ctx.store.listRunEvents(run.id);
      const result = [...events].reverse().find((e) => e.type === 'result');
      const resultText = (result?.payload as { resultText?: string } | undefined)?.resultText;
      const lastText = [...events]
        .reverse()
        .map((e) => e.payload as { type?: string; text?: string })
        .find((p) => p.type === 'assistant_text')?.text;
      candidate = extractJsonObject(resultText ?? '') ?? extractJsonObject(lastText ?? '');
    }
    const parsed = refineOutputSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }
}
