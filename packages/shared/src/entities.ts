import { z } from 'zod';
import {
  attemptStatusSchema,
  columnSchema,
  commentKindSchema,
  executorIdSchema,
  jobStatusSchema,
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
  cost_usd: z.number().nullable(),
  num_turns: z.number().int().nullable(),
  error_message: nullableString,
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

export const executorStatusSchema = z.object({
  id: executorIdSchema,
  displayName: z.string(),
  ok: z.boolean(),
  version: z.string().optional(),
  message: z.string().optional(),
  supportsResume: z.boolean(),
});
export type ExecutorStatus = z.infer<typeof executorStatusSchema>;
