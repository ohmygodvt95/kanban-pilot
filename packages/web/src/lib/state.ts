import type { Column, Substate, Task } from '@agent-kanban/shared';

export const COLUMN_LABELS: Record<Column, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  doing: 'Doing',
  review: 'Review',
  done: 'Done',
};

export const SUBSTATE_STYLE: Record<Substate, string> = {
  draft: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
  refining: 'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200',
  needs_answer: 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100',
  ready: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  queued: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200',
  waiting_feedback: 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  pending: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  tests_failed: 'bg-orange-100 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100',
};

export const SUBSTATE_LABELS: Record<Substate, string> = {
  draft: 'draft',
  refining: 'refining…',
  needs_answer: 'needs answer',
  ready: 'ready',
  queued: 'queued',
  running: 'running',
  waiting_feedback: 'waiting',
  error: 'error',
  pending: 'review',
  tests_failed: 'tests failed',
};

export const isBusy = (t: Task) =>
  (t.column === 'doing' && (t.substate === 'queued' || t.substate === 'running')) ||
  (t.column === 'backlog' && t.substate === 'refining');

export const EXECUTOR_ICONS: Record<string, string> = { claude: '✳', codex: '◎', copilot: '⌘' };
