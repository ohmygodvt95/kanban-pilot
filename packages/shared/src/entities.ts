import { z } from 'zod';
import {
  attemptStatusSchema,
  columnSchema,
  commentKindSchema,
  doneActionSchema,
  executorIdSchema,
  jobStatusSchema,
  promptLanguageSchema,
  providerIdSchema,
  runEventTypeSchema,
  runKindSchema,
  runStatusSchema,
  substateSchema,
} from './enums.js';

const isoDate = z.string();
const nullableString = z.string().nullable();

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  repo_path: z.string(),
  default_executor: executorIdSchema,
  base_branch: z.string(),
  setup_script: nullableString,
  test_script: nullableString,
  auto_done: z.boolean(),
  refinement_enabled: z.boolean(),
  max_concurrent_runs: z.number().int(),
  run_timeout_minutes: z.number().int(),
  refinement_prompt: nullableString,
  /** Default model passed to the executor (e.g. "sonnet"); null = CLI default. */
  model: nullableString,
  /** Hard cap in USD per run (Claude: --max-budget-usd); null = unlimited. */
  max_budget_usd: z.number().nullable(),
  /** Language of the built-in prompt templates. */
  prompt_language: promptLanguageSchema,
  /** Optional overrides of the execute / followup prompt templates. */
  execute_prompt: nullableString,
  followup_prompt: nullableString,
  /** REVIEW → DONE behaviour: local merge or push + pull request. */
  done_action: doneActionSchema,
  /** Start every task automatically when it reaches TODO (bounded by max_concurrent_runs). */
  auto_start: z.boolean(),
  created_at: isoDate,
  updated_at: isoDate,
});
export type Project = z.infer<typeof projectSchema>;

export const taskSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  description: z.string(),
  column: columnSchema,
  substate: substateSchema.nullable(),
  position: z.number(),
  executor: executorIdSchema.nullable(),
  /** Per-task model override; null = project default. */
  model: nullableString,
  skip_refinement: z.boolean(),
  plan: nullableString,
  refinement_session_id: nullableString,
  refinement_incomplete: z.boolean(),
  current_attempt_id: nullableString,
  last_error: nullableString,
  source_provider: providerIdSchema.nullable(),
  source_external_id: nullableString,
  source_url: nullableString,
  created_at: isoDate,
  updated_at: isoDate,
  /** Computed: sum of cost_usd over all runs of the task. */
  total_cost_usd: z.number(),
  /** Computed: feedback comments not yet sent to the agent. */
  unconsumed_feedback: z.number().int(),
});
export type Task = z.infer<typeof taskSchema>;

export const attemptSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  executor: executorIdSchema,
  branch: z.string(),
  worktree_path: z.string(),
  base_commit: z.string(),
  status: attemptStatusSchema,
  pr_url: nullableString,
  last_test_output: nullableString,
  last_test_ok: z.boolean().nullable(),
  created_at: isoDate,
  updated_at: isoDate,
});
export type Attempt = z.infer<typeof attemptSchema>;

export const runSchema = z.object({
  id: z.string(),
  attempt_id: nullableString,
  task_id: z.string(),
  kind: runKindSchema,
  executor: executorIdSchema,
  prompt: z.string(),
  command: nullableString,
  status: runStatusSchema,
  exit_code: z.number().int().nullable(),
  session_id: nullableString,
  resumed_from_session_id: nullableString,
  result_subtype: nullableString,
  structured_output: z.unknown().nullable(),
  /** Final assistant text of the run (Claude's `result`), used by the Chat tab. */
  result_text: nullableString,
  cost_usd: z.number().nullable(),
  num_turns: z.number().int().nullable(),
  error_message: nullableString,
  /** OS pid of the detached agent process while running. */
  pid: z.number().int().nullable(),
  /** Directory holding stdout/stderr/exit files of the detached process. */
  log_dir: nullableString,
  /** Set when this run was created automatically because `fallback_of_run_id` failed to resume its session. */
  fallback_of_run_id: nullableString,
  started_at: isoDate.nullable(),
  finished_at: isoDate.nullable(),
  created_at: isoDate,
});
export type Run = z.infer<typeof runSchema>;

export const runEventSchema = z.object({
  id: z.number().int(),
  run_id: z.string(),
  seq: z.number().int(),
  type: runEventTypeSchema,
  payload: z.unknown(),
  created_at: isoDate,
});
export type RunEvent = z.infer<typeof runEventSchema>;

/** A file (image) attached to a chat/feedback comment; served at /api/attachments/:id. */
export const attachmentSchema = z.object({
  id: z.string(),
  comment_id: z.string(),
  task_id: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int(),
  created_at: isoDate,
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const commentSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  attempt_id: nullableString,
  kind: commentKindSchema,
  body: z.string(),
  file_path: nullableString,
  line: z.number().int().nullable(),
  consumed_by_run_id: nullableString,
  created_at: isoDate,
  /** Images attached to the comment (empty for most comments). */
  attachments: z.array(attachmentSchema),
});
export type Comment = z.infer<typeof commentSchema>;

export const refinementQuestionSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  run_id: z.string(),
  question: z.string(),
  answer: nullableString,
  created_at: isoDate,
  answered_at: isoDate.nullable(),
});
export type RefinementQuestion = z.infer<typeof refinementQuestionSchema>;

export const jobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  payload: z.unknown(),
  status: jobStatusSchema,
  attempts_count: z.number().int(),
  locked_by: nullableString,
  run_after: isoDate,
  error: nullableString,
  created_at: isoDate,
  updated_at: isoDate,
});
export type Job = z.infer<typeof jobSchema>;

export const taskDetailSchema = taskSchema.extend({
  current_attempt: attemptSchema.nullable(),
  attempts: z.array(attemptSchema),
  runs: z.array(runSchema),
  comments: z.array(commentSchema),
  questions: z.array(refinementQuestionSchema),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;

export const diffFileSchema = z.object({
  path: z.string(),
  old_path: z.string().nullable(),
  additions: z.number().int(),
  deletions: z.number().int(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'binary']),
});
export type DiffFile = z.infer<typeof diffFileSchema>;

export const diffResultSchema = z.object({
  files: z.array(diffFileSchema),
  patch: z.string(),
});
export type DiffResult = z.infer<typeof diffResultSchema>;

/** An issue from an external tracker (GitHub for now). */
export const externalIssueSchema = z.object({
  externalId: z.string(),
  url: z.string(),
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()),
});
export type ExternalIssue = z.infer<typeof externalIssueSchema>;

export const providerStatusSchema = z.object({
  id: providerIdSchema,
  ok: z.boolean(),
  message: z.string().optional(),
  /** e.g. "owner/repo" detected from the origin remote. */
  projectRef: z.string().nullable(),
});
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const executorStatusSchema = z.object({
  id: executorIdSchema,
  displayName: z.string(),
  ok: z.boolean(),
  version: z.string().optional(),
  message: z.string().optional(),
  supportsResume: z.boolean(),
});
export type ExecutorStatus = z.infer<typeof executorStatusSchema>;
