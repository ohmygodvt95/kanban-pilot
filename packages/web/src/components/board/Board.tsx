import { COLUMNS, type Column, type Project, type Task } from '@agent-kanban/shared';
import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ApiError, api } from '../../api/client';
import { keys, upsertTask } from '../../api/queries';
import { positionBetween } from '../../lib/format';
import { useConfirm } from '../ui';
import { useToast } from '../ui/Toast';
import { ColumnView } from './ColumnView';
import { TaskCard } from './TaskCard';

export function Board({
  project,
  tasks,
  onOpen,
  onNewTask,
  selectedId,
  collapsed,
  onToggleCollapsed,
  filtering,
  hiddenCount,
}: {
  project: Project;
  tasks: Task[];
  onOpen: (id: string) => void;
  onNewTask: () => void;
  selectedId: string | null;
  /** Columns rendered as a narrow strip (persisted per browser). */
  collapsed: Set<Column>;
  onToggleCollapsed: (c: Column) => void;
  /** A search/filter is active: show how many tasks are hidden. */
  filtering: boolean;
  hiddenCount: number;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; column: Column; position: number } | null>(null);
  // Pointer for mouse/touch; keyboard: focus a card, Space to lift, arrows to move, Space to drop.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byColumn = useMemo(() => {
    const map: Record<Column, Task[]> = { backlog: [], todo: [], doing: [], review: [], done: [] };
    for (const t of tasks) {
      const eff =
        pending && pending.id === t.id ? { ...t, column: pending.column, position: pending.position } : t;
      map[eff.column].push(eff);
    }
    for (const c of COLUMNS)
      map[c].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
    return map;
  }, [tasks, pending]);

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const task = tasks.find((t) => t.id === active.id);
    if (!task) return;
    const overData = over.data.current as { type: 'task' | 'column'; column: Column } | undefined;
    const targetColumn: Column =
      overData?.type === 'column'
        ? overData.column
        : (tasks.find((t) => t.id === over.id)?.column ?? task.column);
    const list = byColumn[targetColumn].filter((t) => t.id !== task.id);
    let index = list.length;
    if (overData?.type === 'task' && over.id !== task.id) {
      index = list.findIndex((t) => t.id === over.id);
      if (index === -1) index = list.length;
    }
    const position = positionBetween(list[index - 1]?.position, list[index]?.position);
    if (targetColumn === task.column) {
      if (Math.abs(position - task.position) < 1e-9) return;
      setPending({ id: task.id, column: targetColumn, position });
      try {
        upsertTask(qc, await api.tasks.update(task.id, { position }));
      } catch (err) {
        toast.error(err, 'Reorder failed');
      } finally {
        setPending(null);
      }
      return;
    }
    await move(task, targetColumn, position, false);
  };

  const move = async (task: Task, target: Column, position: number, confirmDiscard: boolean) => {
    setPending({ id: task.id, column: target, position });
    try {
      const updated = await api.tasks.transition(task.id, {
        target,
        payload: { position, confirm_discard: confirmDiscard || undefined },
      });
      upsertTask(qc, updated);
      if (updated.column !== target) {
        toast.push({
          kind: 'info',
          text:
            target === 'todo' && updated.substate === 'refining'
              ? 'Refinement started; the card moves once the agent has a plan.'
              : `Task is now ${updated.column}`,
        });
      }
    } catch (err) {
      setPending(null);
      if (err instanceof ApiError && err.code === 'CONFIRM_REQUIRED') {
        const ok = await confirm({
          title: 'Discard current attempt?',
          body: err.message,
          danger: true,
          confirmLabel: 'Discard & move',
        });
        if (ok) await move(task, target, position, true);
        return;
      }
      toast.error(err, 'Cannot move task');
      void qc.invalidateQueries({ queryKey: keys.tasks(project.id) });
    } finally {
      setPending(null);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {confirmNode}
      {filtering ? (
        <div className="border-accent-200 border-b bg-accent-50 px-4 py-1 text-[11px] text-accent-700 dark:border-accent-900 dark:bg-accent-900/20 dark:text-accent-200">
          Filter active · {hiddenCount} task{hiddenCount === 1 ? '' : 's'} hidden
        </div>
      ) : null}
      <div
        className={`scrollbar-thin flex gap-3 overflow-x-auto p-3 ${filtering ? 'h-[calc(100%-1.5rem)]' : 'h-full'}`}
      >
        {COLUMNS.map((c) => (
          <ColumnView
            key={c}
            column={c}
            tasks={byColumn[c]}
            onOpen={onOpen}
            activeId={activeId}
            selectedId={selectedId}
            collapsed={collapsed.has(c)}
            onToggleCollapsed={() => onToggleCollapsed(c)}
            defaultExecutor={project.default_executor}
            header={
              c === 'backlog' ? (
                <button
                  type="button"
                  onClick={onNewTask}
                  className="rounded px-1.5 text-sm text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  title="New task"
                >
                  ＋
                </button>
              ) : null
            }
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-64 rotate-1">
            <TaskCard task={activeTask} onOpen={() => {}} defaultExecutor={project.default_executor} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
