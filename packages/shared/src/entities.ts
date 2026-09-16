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
  taskKindSchema,
  taskPrioritySchema,
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
  /** Let the agent drive a browser (Claude in Chrome: `claude --chrome`). */
  browser_enabled: z.boolean(),
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
  /** Per-task browser override; null = project default. */
  browser: z.boolean().nullable(),
  /** Classification and priority; null = not set yet (the planner fills them during refinement). */
  kind: taskKindSchema.nullable(),
  priority: taskPrioritySchema.nullable(),
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
  priority: z.number().int(),
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
  /** Guessed from labels (e.g. "bug", "priority::high"); null when unknown. */
  kind: taskKindSchema.nullable().optional(),
  priority: taskPrioritySchema.nullable().optional(),
  /** Remote status name (workflow status or matching label). */
  status: z.string().nullable().optional(),
  /** Set by GET /projects/:id/issues: already a task, and where the status map would put it. */
  imported: z.boolean().optional(),
  column: z.union([columnSchema, z.literal('skip')]).optional(),
});
export type ExternalIssue = z.infer<typeof externalIssueSchema>;

export const providerStatusSchema = z.object({
  id: providerIdSchema,
  ok: z.boolean(),
  message: z.string().optional(),
  /** e.g. "owner/repo" (GitHub), project URL (GitLab) or project key (Jira). */
  projectRef: z.string().nullable(),
});
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

/** Which remote statuses correspond to each kanban column (first entry is written back on sync). */
export const statusMapSchema = z.record(columnSchema, z.array(z.string()));
export type StatusMap = z.infer<typeof statusMapSchema>;

/**
 * Tracker connection of a project (one per project). Secrets are never returned
 * by the API: `auth` only says what is configured.
 */
export const integrationSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  provider: providerIdSchema,
  /** API/base URL for self-hosted instances (GitLab, Jira); null = provider default. */
  base_url: nullableString,
  /** GitHub "owner/repo", GitLab project path, Jira project key. */
  project_ref: z.string(),
  auth: z.object({ username: nullableString, has_token: z.boolean(), has_password: z.boolean() }),
  /** Provider-specific import filter: labels (GitHub/GitLab) or JQL (Jira). */
  import_filter: nullableString,
  status_map: statusMapSchema,
  /** Defaults used when a local task is pushed to the tracker as a new issue. */
  push_defaults: z.object({
    /** Remote issue type id per task kind (Jira); null = tracker default. */
    issue_type_by_kind: z.record(z.string(), z.string().nullable()),
    /** Remote priority name per task priority (Jira). */
    priority_map: z.record(z.string(), z.string().nullable()),
    /** Default values for required/custom fields, keyed by remote field key. */
    fields: z.record(z.string(), z.unknown()),
  }),
  /** Create the issue automatically when a local task reaches TODO. */
  push_on_todo: z.boolean(),
  /** Write task milestones back as remote statuses (transitions / labels). */
  sync_status: z.boolean(),
  /** Also leave a short comment on the issue at each milestone. */
  sync_comments: z.boolean(),
  poll_interval_seconds: z.number().int(),
  last_polled_at: nullableString,
  last_error: nullableString,
  created_at: isoDate,
  updated_at: isoDate,
});
export type Integration = z.infer<typeof integrationSchema>;

/** One configurable field of a provider module (drives the settings form). */
/** One field of a remote issue type, as reported by the tracker's create metadata. */
export const remoteFieldSchema = z.object({
  key: z.string(),
  name: z.string(),
  required: z.boolean(),
  type: z.enum(['string', 'text', 'number', 'date', 'select', 'multiselect', 'user', 'labels', 'unknown']),
  allowedValues: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  /** true when the tracker fills the value itself (reporter, project…) — never asked from the user. */
  hasDefault: z.boolean().optional(),
});
export type RemoteField = z.infer<typeof remoteFieldSchema>;

export const remoteIssueTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  fields: z.array(remoteFieldSchema),
});
export type RemoteIssueType = z.infer<typeof remoteIssueTypeSchema>;

/** Create metadata of the linked tracker project (GET /projects/:id/integration/create-meta). */
export const createMetaSchema = z.object({ issueTypes: z.array(remoteIssueTypeSchema) });
export type CreateMeta = z.infer<typeof createMetaSchema>;

export const providerFieldSchema = z.object({
  key: z.enum(['base_url', 'project_ref', 'username', 'token', 'password', 'import_filter']),
  label: z.string(),
  type: z.enum(['text', 'url', 'password', 'textarea']),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  required: z.boolean().optional(),
});
export const providerModuleInfoSchema = z.object({
  id: providerIdSchema,
  displayName: z.string(),
  description: z.string(),
  fields: z.array(providerFieldSchema),
  /** Whether statuses are workflow states (Jira) or labels (GitHub/GitLab). */
  statusModel: z.enum(['workflow', 'labels']),
  supportsPullRequests: z.boolean(),
  /** Suggested status map for a fresh integration. */
  defaultStatusMap: statusMapSchema,
});
export type ProviderModuleInfo = z.infer<typeof providerModuleInfoSchema>;

export const executorStatusSchema = z.object({
  id: executorIdSchema,
  displayName: z.string(),
  ok: z.boolean(),
  version: z.string().optional(),
  message: z.string().optional(),
  supportsResume: z.boolean(),
});
export type ExecutorStatus = z.infer<typeof executorStatusSchema>;
