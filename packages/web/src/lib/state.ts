import type { Column, Substate, Task } from '@agent-kanban/shared';

export const COLUMN_LABELS: Record<Column, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  doing: 'Doing',
  review: 'Review',
  done: 'Done',
};

export const COLUMN_HINTS: Record<Column, string> = {
  backlog: 'Drafts. Drag to To do to refine.',
  todo: 'Ready to run. Drag to Doing or press Start.',
  doing: 'The agent works in a worktree.',
  review: 'Inspect the diff, give feedback, merge.',
  done: 'Merged. Immutable.',
};

/** Accent colour per column (dot, header). */
export const COLUMN_DOT: Record<Column, string> = {
  backlog: 'bg-zinc-400',
  todo: 'bg-sky-500',
  doing: 'bg-accent-500',
  review: 'bg-amber-500',
  done: 'bg-emerald-500',
};

export const COLUMN_PILL: Record<Column, string> = {
  backlog: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
  todo: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  doing: 'bg-accent-100 text-accent-700 dark:bg-accent-900/60 dark:text-accent-200',
  review: 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100',
  done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
};

export const SUBSTATE_STYLE: Record<Substate, string> = {
  draft: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
  refining: 'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200',
  needs_answer: 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100',
  ready: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  queued: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
  running: 'bg-accent-100 text-accent-700 dark:bg-accent-900/60 dark:text-accent-200',
  waiting_feedback: 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  pending: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  tests_failed: 'bg-orange-100 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100',
};

export const SUBSTATE_LABELS: Record<Substate, string> = {
  draft: 'draft',
  refining: 'refining',
  needs_answer: 'needs answer',
  ready: 'ready',
  queued: 'queued',
  running: 'running',
  waiting_feedback: 'waiting',
  error: 'error',
  pending: 'ready to review',
  tests_failed: 'tests failed',
};

export const isBusy = (t: Pick<Task, 'column' | 'substate'>) =>
  (t.column === 'doing' && (t.substate === 'queued' || t.substate === 'running')) ||
  (t.column === 'backlog' && t.substate === 'refining');

export const EXECUTOR_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  copilot: 'Copilot',
};
export const EXECUTOR_ICONS: Record<string, string> = { claude: '✳', codex: '◎', copilot: '⌘' };
