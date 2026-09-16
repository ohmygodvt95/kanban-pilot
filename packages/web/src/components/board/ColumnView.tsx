import type { Column, Task } from '@agent-kanban/shared';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { COLUMN_DOT, COLUMN_HINTS, COLUMN_LABELS } from '../../lib/state';
import { TaskCard } from './TaskCard';

export function ColumnView({
  column,
  tasks,
  onOpen,
  defaultExecutor,
  header,
  activeId,
  selectedId,
  collapsed,
  onToggleCollapsed,
}: {
  column: Column;
  tasks: Task[];
  onOpen: (id: string) => void;
  defaultExecutor: string;
  header?: ReactNode;
  activeId: string | null;
  selectedId: string | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column, data: { type: 'column', column } });
  if (collapsed) {
    // Narrow strip: still a drop target, shows the count; click to expand.
    return (
      <div
        ref={setNodeRef}
        className={`flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl bg-zinc-200/50 py-3 dark:bg-zinc-900/70 ${isOver ? 'ring-2 ring-accent-400' : ''}`}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          title={`Expand ${COLUMN_LABELS[column]}`}
        >
          <ChevronsRight size={14} />
        </button>
        <span className={`h-2 w-2 rounded-full ${COLUMN_DOT[column]}`} />
        <span className="rounded-full bg-white px-1.5 py-0.5 font-medium text-[11px] text-zinc-500 dark:bg-zinc-800">
          {tasks.length}
        </span>
        <span className="mt-1 font-semibold text-sm text-zinc-700 [writing-mode:vertical-rl] dark:text-zinc-200">
          {COLUMN_LABELS[column]}
        </span>
      </div>
    );
  }
  return (
    <div
      className="flex w-72 shrink-0 flex-col rounded-xl bg-zinc-200/50 dark:bg-zinc-900/70 xl:w-auto xl:flex-1"
      data-tour={`column-${column}`}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2" title={COLUMN_HINTS[column]}>
        <span className={`h-2 w-2 rounded-full ${COLUMN_DOT[column]}`} />
        <h2 className="font-semibold text-sm text-zinc-700 dark:text-zinc-200">{COLUMN_LABELS[column]}</h2>
        <span className="rounded-full bg-white px-1.5 py-0.5 font-medium text-[11px] text-zinc-500 dark:bg-zinc-800">
          {tasks.length}
        </span>
        <span className="flex-1" />
        {header}
        {onToggleCollapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="rounded-md p-0.5 text-zinc-400 hover:bg-white hover:text-zinc-700 dark:hover:bg-zinc-800"
            title={`Collapse ${COLUMN_LABELS[column]}`}
          >
            <ChevronsLeft size={14} />
          </button>
        ) : null}
      </div>
      <div
        ref={setNodeRef}
        className={`scrollbar-thin flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition ${isOver ? 'rounded-b-xl bg-accent-100/40 ring-2 ring-accent-400 ring-inset dark:bg-accent-900/20' : ''}`}
      >
        <SortableContext id={column} items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onOpen={onOpen}
              dragging={activeId === t.id}
              defaultExecutor={defaultExecutor}
              selected={selectedId === t.id}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-zinc-300 border-dashed p-4 text-center text-xs text-zinc-400 dark:border-zinc-700">
            {COLUMN_HINTS[column]}
          </div>
        ) : null}
      </div>
    </div>
  );
}
