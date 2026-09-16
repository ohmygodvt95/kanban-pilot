import type { Column, Task } from '@agent-kanban/shared';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { ReactNode } from 'react';
import { COLUMN_LABELS } from '../../lib/state';
import { TaskCard } from './TaskCard';

export function ColumnView({
  column,
  tasks,
  onOpen,
  defaultExecutor,
  header,
  activeId,
}: {
  column: Column;
  tasks: Task[];
  onOpen: (id: string) => void;
  defaultExecutor: string;
  header?: ReactNode;
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column, data: { type: 'column', column } });
  return (
    <div className="flex min-w-64 flex-1 flex-col rounded-lg bg-zinc-100 dark:bg-zinc-900/60">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="font-semibold text-sm text-zinc-700 dark:text-zinc-200">
          {COLUMN_LABELS[column]} <span className="font-normal text-zinc-400">{tasks.length}</span>
        </h2>
        {header}
      </div>
      <div
        ref={setNodeRef}
        className={`scrollbar-thin flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 ${isOver ? 'rounded-b-lg ring-2 ring-blue-400 ring-inset' : ''}`}
      >
        <SortableContext id={column} items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onOpen={onOpen}
              dragging={activeId === t.id}
              defaultExecutor={defaultExecutor}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 ? (
          <div className="flex-1 rounded-md border border-zinc-300 border-dashed p-4 text-center text-xs text-zinc-400 dark:border-zinc-700">
            drop here
          </div>
        ) : null}
      </div>
    </div>
  );
}
