import type { Task } from '@agent-kanban/shared';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatCost } from '../../lib/format';
import { EXECUTOR_ICONS } from '../../lib/state';
import { Badge } from '../ui';

export function TaskCard({
  task,
  onOpen,
  dragging,
  defaultExecutor,
}: {
  task: Task;
  onOpen: (id: string) => void;
  dragging?: boolean;
  defaultExecutor: string;
}) {
  const disabled = task.column === 'done';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', column: task.column },
    disabled,
  });
  const style = { transform: CSS.Translate.toString(transform), transition };
  const executor = task.executor ?? defaultExecutor;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      className={`group cursor-pointer rounded-md border bg-white p-2.5 text-sm shadow-sm transition-shadow hover:shadow-md dark:bg-zinc-900 ${
        isDragging || dragging ? 'opacity-50' : ''
      } ${task.last_error ? 'border-red-300 dark:border-red-800' : 'border-zinc-200 dark:border-zinc-700'}`}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <span className="line-clamp-2 font-medium leading-snug">{task.title}</span>
        <span className="shrink-0 text-xs text-zinc-400" title={`executor: ${executor}`}>
          {EXECUTOR_ICONS[executor] ?? executor}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
        <Badge substate={task.substate} />
        {task.refinement_incomplete ? (
          <span
            className="rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100"
            title="Refined with open questions"
          >
            open questions
          </span>
        ) : null}
        {task.unconsumed_feedback ? (
          <span
            className="rounded bg-blue-100 px-1 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200"
            title="feedback not yet sent"
          >
            💬 {task.unconsumed_feedback}
          </span>
        ) : null}
        {task.total_cost_usd ? <span title="accumulated cost">{formatCost(task.total_cost_usd)}</span> : null}
        {task.source_url ? (
          <a
            href={task.source_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="hover:underline"
            title={task.source_url}
          >
            🔗
          </a>
        ) : null}
      </div>
      {task.last_error ? (
        <div className="mt-1.5 line-clamp-2 text-[11px] text-red-600 dark:text-red-400">
          {task.last_error}
        </div>
      ) : null}
    </div>
  );
}
