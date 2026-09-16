import { z } from 'zod';

export const COLUMNS = ['backlog', 'todo', 'doing', 'review', 'done'] as const;
export const columnSchema = z.enum(COLUMNS);
export type Column = z.infer<typeof columnSchema>;

export const SUBSTATES = [
  // backlog
  'draft',
  'refining',
  'needs_answer',
  // todo
  'ready',
  // doing
  'queued',
  'running',
  'waiting_feedback',
  'error',
  // review
  'pending',
  'tests_failed',
] as const;
export const substateSchema = z.enum(SUBSTATES);
export type Substate = z.infer<typeof substateSchema>;

/** Which substates are legal inside each column. */
export const COLUMN_SUBSTATES: Record<Column, readonly Substate[]> = {
  backlog: ['draft', 'refining', 'needs_answer'],
  todo: ['ready'],
  doing: ['queued', 'running', 'waiting_feedback', 'error'],
  review: ['pending', 'tests_failed'],
  done: [],
};

export const EXECUTOR_IDS = ['claude', 'codex', 'copilot'] as const;
export const executorIdSchema = z.enum(EXECUTOR_IDS);
export type ExecutorId = z.infer<typeof executorIdSchema>;

export const attemptStatusSchema = z.enum(['active', 'merged', 'discarded']);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

export const runKindSchema = z.enum(['refine', 'execute', 'followup', 'chat']);
export type RunKind = z.infer<typeof runKindSchema>;

export const runStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runEventTypeSchema = z.enum(['system', 'assistant', 'user', 'result', 'stderr', 'raw']);
export type RunEventType = z.infer<typeof runEventTypeSchema>;

export const commentKindSchema = z.enum(['feedback', 'answer', 'note', 'chat']);
export type CommentKind = z.infer<typeof commentKindSchema>;

export const jobStatusSchema = z.enum(['queued', 'running', 'done', 'failed']);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const providerIdSchema = z.enum(['github', 'gitlab', 'jira']);

/** Language of the built-in prompts sent to agents. */
export const promptLanguageSchema = z.enum(['vi', 'en']);
export type PromptLanguage = z.infer<typeof promptLanguageSchema>;

/** What REVIEW → DONE does: merge locally, or push + open a pull request. */
export const doneActionSchema = z.enum(['merge', 'pr']);
export type DoneAction = z.infer<typeof doneActionSchema>;
export type ProviderId = z.infer<typeof providerIdSchema>;
