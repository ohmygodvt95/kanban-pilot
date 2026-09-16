import { z } from 'zod';
import { statusMapSchema } from './entities.js';
import {
  columnSchema,
  commentKindSchema,
  doneActionSchema,
  executorIdSchema,
  promptLanguageSchema,
  providerIdSchema,
  taskKindSchema,
  taskPrioritySchema,
} from './enums.js';

/** Fields shared by create and update. */
const projectFieldsSchema = z.object({
  name: z.string().min(1).optional(),
  default_executor: executorIdSchema.optional(),
  base_branch: z.string().min(1).optional(),
  setup_script: z.string().nullable().optional(),
  test_script: z.string().nullable().optional(),
  auto_done: z.boolean().optional(),
  refinement_enabled: z.boolean().optional(),
  max_concurrent_runs: z.number().int().min(1).max(16).optional(),
  run_timeout_minutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
  refinement_prompt: z.string().nullable().optional(),
  /** Default model passed to the executor CLI (e.g. "sonnet"); null = CLI default. */
  model: z.string().max(100).nullable().optional(),
  /** Hard USD cap per run; null = unlimited. */
  max_budget_usd: z.number().positive().max(10_000).nullable().optional(),
  prompt_language: promptLanguageSchema.optional(),
  execute_prompt: z.string().nullable().optional(),
  followup_prompt: z.string().nullable().optional(),
  done_action: doneActionSchema.optional(),
  auto_start: z.boolean().optional(),
  browser_enabled: z.boolean().optional(),
});

export const createProjectSchema = projectFieldsSchema.extend({
  repo_path: z.string().min(1),
  /**
   * The repo's .agent-kanban.json may define setup/test scripts. They are only
   * adopted when the caller explicitly accepts them (CONFIRM_REQUIRED otherwise).
   */
  accept_repo_scripts: z.boolean().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = projectFieldsSchema.partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  executor: executorIdSchema.nullable().optional(),
  model: z.string().max(100).nullable().optional(),
  browser: z.boolean().nullable().optional(),
  kind: taskKindSchema.nullable().optional(),
  priority: taskPrioritySchema.nullable().optional(),
  skip_refinement: z.boolean().optional(),
  source_url: z.string().nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  executor: executorIdSchema.nullable().optional(),
  model: z.string().max(100).nullable().optional(),
  browser: z.boolean().nullable().optional(),
  kind: taskKindSchema.nullable().optional(),
  priority: taskPrioritySchema.nullable().optional(),
  skip_refinement: z.boolean().optional(),
  position: z.number().optional(),
  source_url: z.string().nullable().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * Payload accepted by POST /tasks/:id/transition. Only user-triggered fields
 * are exposed here; system transitions carry richer payloads inside core.
 */
export const transitionRequestSchema = z.object({
  target: columnSchema,
  payload: z
    .object({
      /** Explicit same-column action (e.g. retry from DOING(error)). */
      action: z.enum(['retry']).optional(),
      /** New position within the target column. */
      position: z.number().optional(),
      /** User confirmed discarding the active attempt (any -> backlog). */
      confirm_discard: z.boolean().optional(),
    })
    .optional(),
});
export type TransitionRequest = z.infer<typeof transitionRequestSchema>;

export const createCommentSchema = z.object({
  kind: commentKindSchema.default('feedback'),
  body: z.string().min(1),
  file_path: z.string().nullable().optional(),
  line: z.number().int().nullable().optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const chatMessageSchema = z.object({ message: z.string().min(1).max(20_000) });
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

export const answerQuestionSchema = z.object({ answer: z.string().min(1) });
export type AnswerQuestionInput = z.infer<typeof answerQuestionSchema>;

/** Create or update the project's tracker connection. Empty token/password keeps the stored secret. */
export const integrationInputSchema = z.object({
  provider: providerIdSchema,
  base_url: z.string().max(500).nullable().optional(),
  project_ref: z.string().min(1).max(300),
  username: z.string().max(200).nullable().optional(),
  token: z.string().max(2000).nullable().optional(),
  password: z.string().max(2000).nullable().optional(),
  import_filter: z.string().max(2000).nullable().optional(),
  status_map: statusMapSchema.optional(),
  sync_status: z.boolean().optional(),
  sync_comments: z.boolean().optional(),
  poll_interval_seconds: z.number().int().min(10).max(3600).optional(),
});
export type IntegrationInput = z.infer<typeof integrationInputSchema>;

export const importIssuesSchema = z.object({
  /** External ids (issue numbers) to import as tasks. */
  external_ids: z.array(z.string().min(1)).min(1).max(50),
});
export type ImportIssuesInput = z.infer<typeof importIssuesSchema>;

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
