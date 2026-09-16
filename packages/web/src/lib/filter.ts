/** Board search / quick filters, kept pure so they can be unit-tested. */
import type { ExecutorId, Task } from '@agent-kanban/shared';

export type Quick = 'all' | 'attention' | 'running' | 'bugs' | 'urgent';
export const QUICK_IDS: Quick[] = ['all', 'attention', 'running', 'bugs', 'urgent'];

export interface TaskFilter {
  query: string;
  executor: ExecutorId | '';
  quick: Quick;
}

export function matchesFilter(task: Task, f: TaskFilter, defaultExecutor: string): boolean {
  const query = f.query.trim();
  if (query) {
    const q = query.toLowerCase();
    if (
      !task.title.toLowerCase().includes(q) &&
      !task.description.toLowerCase().includes(q) &&
      !task.id.toLowerCase().includes(q)
    )
      return false;
  }
  if (f.executor && (task.executor ?? defaultExecutor) !== f.executor) return false;
  switch (f.quick) {
    case 'attention':
      return (
        (task.column === 'doing' && task.substate === 'error') ||
        task.substate === 'needs_answer' ||
        task.column === 'review'
      );
    case 'running':
      return task.column === 'doing' && (task.substate === 'running' || task.substate === 'queued');
    case 'bugs':
      return task.kind === 'bug';
    case 'urgent':
      return task.priority === 'urgent' || task.priority === 'high';
    default:
      return true;
  }
}

export function isFiltering(f: TaskFilter): boolean {
  return !!f.query.trim() || !!f.executor || f.quick !== 'all';
}
