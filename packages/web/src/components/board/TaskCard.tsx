import type { Task } from '@agent-kanban/shared';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  HelpCircle,
  Link2,
  MessageSquare,
  XCircle,
} from 'lucide-react';
import { formatCost, relativeTime } from '../../lib/format';
import { EXECUTOR_ICONS, EXECUTOR_LABELS, isBusy } from '../../lib/state';
import {
  KIND_ICON,
  KIND_LABELS,
  KIND_STYLE,
  PRIORITY_ICON,
  PRIORITY_LABELS,
  PRIORITY_STYLE,
} from '../../lib/taskmeta';
import { Badge } from '../ui';

export function TaskCard({
  task,
  onOpen,
  dragging,
  defaultExecutor,
  selected,
}: {
  task: Task;
  onOpen: (id: string) => void;
  dragging?: boolean;
  defaultExecutor: string;
  selected?: boolean;
}) {
  const disabled = task.column === 'done';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', column: task.column },
    disabled,
  });
  const style = { transform: CSS.Translate.toString(transform), transition };
  const executor = task.executor ?? defaultExecutor;
  const busy = isBusy(task);
  const snippet =
    task.description
      .split('\n')
      .find((l) => l.trim() && !l.startsWith('#'))
      ?.trim() ?? '';
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(task.id);
      }}
      className={`group relative cursor-pointer rounded-lg border bg-white p-3 text-sm shadow-sm transition hover:shadow-md dark:bg-zinc-800 ${
        isDragging || dragging ? 'opacity-40' : ''
      } ${
        task.last_error
          ? 'border-red-300 dark:border-red-800'
          : selected
            ? 'border-accent-400 ring-2 ring-accent-400/30'
            : 'border-zinc-200 hover:border-accent-300 dark:border-zinc-700 dark:hover:border-accent-600'
      } ${busy ? 'ak-running' : ''}`}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="line-clamp-2 font-medium leading-snug">{task.title}</span>
        <span
          className="shrink-0 text-xs text-zinc-400"
          title={`executor: ${EXECUTOR_LABELS[executor] ?? executor}`}
        >
          {EXECUTOR_ICONS[executor] ?? executor}
        </span>
      </div>
      {snippet ? (
        <p className="mb-2 line-clamp-2 text-[12px] text-zinc-500 leading-snug dark:text-zinc-400">
          {snippet}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {task.kind ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${KIND_STYLE[task.kind]}`}
            title={`kind: ${KIND_LABELS[task.kind]}`}
          >
            {KIND_ICON[task.kind]} {KIND_LABELS[task.kind]}
          </span>
        ) : null}
        {task.priority && task.priority !== 'medium' ? (
          <span
            className={`font-semibold text-[11px] ${PRIORITY_STYLE[task.priority]}`}
            title={`priority: ${PRIORITY_LABELS[task.priority]}`}
          >
            {PRIORITY_ICON[task.priority]} {PRIORITY_LABELS[task.priority]}
          </span>
        ) : null}
        <Badge substate={task.substate} />
        {task.refinement_incomplete ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900 dark:bg-amber-900/60 dark:text-amber-100"
            title="Refined with open questions"
          >
            <HelpCircle size={11} /> open questions
          </span>
        ) : null}
        {task.unconsumed_feedback ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-accent-100 px-2 py-0.5 text-[11px] text-accent-700 dark:bg-accent-900/60 dark:text-accent-200"
            title="feedback not yet sent to the agent"
          >
            <MessageSquare size={11} /> {task.unconsumed_feedback}
          </span>
        ) : null}
        {task.column === 'review' && task.substate === 'tests_failed' ? (
          <XCircle size={14} className="text-red-500" aria-label="tests failed" />
        ) : null}
        {task.column === 'review' && task.substate === 'pending' ? (
          <CheckCircle2 size={14} className="text-emerald-500" aria-label="ready" />
        ) : null}
      </div>
      {task.last_error ? (
        <div className="mt-2 flex items-start gap-1 text-[11px] text-red-600 dark:text-red-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="line-clamp-2">{task.last_error}</span>
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-400">
        {task.current_attempt_id ? <GitBranch size={11} aria-label="has attempt" /> : null}
        {task.total_cost_usd ? <span title="accumulated cost">{formatCost(task.total_cost_usd)}</span> : null}
        {task.source_url ? (
          <a
            href={task.source_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="hover:text-accent-600"
            title={task.source_url}
          >
            <Link2 size={11} />
          </a>
        ) : null}
        <span className="flex-1" />
        <span title={task.updated_at}>{relativeTime(task.updated_at)}</span>
      </div>
    </div>
  );
}
