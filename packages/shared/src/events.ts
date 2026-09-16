import type { Attempt, Job, Run, RunEvent, Task } from './entities.js';

/** Normalised executor event, produced by ExecutorAdapter.parseLine. */
export type NormalizedEvent =
  | { type: 'init'; sessionId: string; raw: unknown }
  | { type: 'assistant_text'; text: string; raw: unknown }
  | { type: 'tool_use'; name: string; input: unknown; raw: unknown }
  | { type: 'tool_result'; raw: unknown }
  | {
      type: 'result';
      ok: boolean;
      subtype: string;
      sessionId?: string;
      costUsd?: number;
      numTurns?: number;
      structuredOutput?: unknown;
      resultText?: string;
      raw: unknown;
    }
  | { type: 'stderr'; text: string; raw: unknown }
  | { type: 'raw'; raw: unknown };

/** Events pushed over SSE (GET /api/events). */
export type SseEvent =
  | { type: 'task.updated'; project_id: string; task: Task }
  | { type: 'task.deleted'; project_id: string; task_id: string }
  | { type: 'run.event'; project_id: string; task_id: string; run_id: string; seq: number; event: RunEvent }
  | { type: 'run.updated'; project_id: string; run: Run }
  | { type: 'attempt.updated'; project_id: string; attempt: Attempt }
  | { type: 'job.failed'; project_id: string | null; job: Job; error: string };

export type SseEventType = SseEvent['type'];
