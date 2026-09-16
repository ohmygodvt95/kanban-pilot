import type {
  AttemptStatus,
  Column,
  CommentKind,
  DoneAction,
  ExecutorId,
  JobStatus,
  PromptLanguage,
  ProviderId,
  RunEventType,
  RunKind,
  RunStatus,
  Substate,
} from '@agent-kanban/shared';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const bool = (name: string) => integer(name, { mode: 'boolean' });

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  repo_path: text('repo_path').notNull().unique(),
  default_executor: text('default_executor').$type<ExecutorId>().notNull().default('claude'),
  base_branch: text('base_branch').notNull().default('main'),
  setup_script: text('setup_script'),
  test_script: text('test_script'),
  auto_done: bool('auto_done').notNull().default(false),
  refinement_enabled: bool('refinement_enabled').notNull().default(true),
  max_concurrent_runs: integer('max_concurrent_runs').notNull().default(2),
  run_timeout_minutes: integer('run_timeout_minutes').notNull().default(45),
  refinement_prompt: text('refinement_prompt'),
  model: text('model'),
  max_budget_usd: real('max_budget_usd'),
  prompt_language: text('prompt_language').$type<PromptLanguage>().notNull().default('vi'),
  execute_prompt: text('execute_prompt'),
  followup_prompt: text('followup_prompt'),
  done_action: text('done_action').$type<DoneAction>().notNull().default('merge'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    column: text('column').$type<Column>().notNull().default('backlog'),
    substate: text('substate').$type<Substate>(),
    position: real('position').notNull().default(0),
    executor: text('executor').$type<ExecutorId>(),
    model: text('model'),
    skip_refinement: bool('skip_refinement').notNull().default(false),
    plan: text('plan'),
    refinement_session_id: text('refinement_session_id'),
    refinement_incomplete: bool('refinement_incomplete').notNull().default(false),
    current_attempt_id: text('current_attempt_id'),
    last_error: text('last_error'),
    source_provider: text('source_provider').$type<ProviderId>(),
    source_external_id: text('source_external_id'),
    source_url: text('source_url'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => [index('tasks_project_column_idx').on(t.project_id, t.column)],
);

export const attempts = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    executor: text('executor').$type<ExecutorId>().notNull(),
    branch: text('branch').notNull(),
    worktree_path: text('worktree_path').notNull(),
    base_commit: text('base_commit').notNull(),
    status: text('status').$type<AttemptStatus>().notNull().default('active'),
    pr_url: text('pr_url'),
    last_test_output: text('last_test_output'),
    last_test_ok: bool('last_test_ok'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => [index('attempts_task_idx').on(t.task_id)],
);

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    attempt_id: text('attempt_id').references(() => attempts.id, { onDelete: 'set null' }),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<RunKind>().notNull(),
    executor: text('executor').$type<ExecutorId>().notNull(),
    prompt: text('prompt').notNull(),
    command: text('command'),
    status: text('status').$type<RunStatus>().notNull().default('queued'),
    exit_code: integer('exit_code'),
    session_id: text('session_id'),
    resumed_from_session_id: text('resumed_from_session_id'),
    result_subtype: text('result_subtype'),
    structured_output: text('structured_output', { mode: 'json' }),
    result_text: text('result_text'),
    cost_usd: real('cost_usd'),
    num_turns: integer('num_turns'),
    error_message: text('error_message'),
    pid: integer('pid'),
    log_dir: text('log_dir'),
    fallback_of_run_id: text('fallback_of_run_id'),
    started_at: text('started_at'),
    finished_at: text('finished_at'),
    created_at: text('created_at').notNull(),
  },
  (t) => [index('runs_task_idx').on(t.task_id), index('runs_attempt_idx').on(t.attempt_id)],
);

export const runEvents = sqliteTable(
  'run_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    run_id: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').$type<RunEventType>().notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('run_events_run_seq_idx').on(t.run_id, t.seq)],
);

export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    attempt_id: text('attempt_id').references(() => attempts.id, { onDelete: 'set null' }),
    kind: text('kind').$type<CommentKind>().notNull(),
    body: text('body').notNull(),
    file_path: text('file_path'),
    line: integer('line'),
    consumed_by_run_id: text('consumed_by_run_id').references(() => runs.id, { onDelete: 'set null' }),
    created_at: text('created_at').notNull(),
  },
  (t) => [index('comments_task_idx').on(t.task_id)],
);

export const refinementQuestions = sqliteTable(
  'refinement_questions',
  {
    id: text('id').primaryKey(),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    run_id: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answer: text('answer'),
    created_at: text('created_at').notNull(),
    answered_at: text('answered_at'),
  },
  (t) => [index('refinement_questions_task_idx').on(t.task_id)],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    status: text('status').$type<JobStatus>().notNull().default('queued'),
    attempts_count: integer('attempts_count').notNull().default(0),
    locked_by: text('locked_by'),
    run_after: text('run_after').notNull(),
    error: text('error'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => [index('jobs_status_idx').on(t.status, t.run_after)],
);

export const schema = { projects, tasks, attempts, runs, runEvents, comments, refinementQuestions, jobs };
