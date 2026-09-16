import type { TaskKind, TaskPriority } from '@agent-kanban/shared';

/** Presentation of task kind and priority (badges, selects). */
export const KIND_LABELS: Record<TaskKind, string> = {
  task: 'Task',
  bug: 'Bug',
  feature: 'Feature',
  chore: 'Chore',
};
export const KIND_STYLE: Record<TaskKind, string> = {
  task: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700/60 dark:text-zinc-200',
  bug: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  feature: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  chore: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300',
};
export const KIND_ICON: Record<TaskKind, string> = { task: '▣', bug: '🐞', feature: '✦', chore: '🧹' };

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};
export const PRIORITY_STYLE: Record<TaskPriority, string> = {
  low: 'text-zinc-400',
  medium: 'text-zinc-500',
  high: 'text-orange-600 dark:text-orange-300',
  urgent: 'text-red-600 dark:text-red-300',
};
/** Chevron glyphs, like most trackers. */
export const PRIORITY_ICON: Record<TaskPriority, string> = { low: '↓', medium: '=', high: '↑', urgent: '‼' };
