import { COLUMNS, type Column, type Project, type Task } from '@agent-kanban/shared';
import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
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
}: {
  project: Project;
  tasks: Task[];
  onOpen: (id: string) => void;
  onNewTask: () => void;
  selectedId: string | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; column: Column; position: number } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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
      <div className="scrollbar-thin flex h-full gap-3 overflow-x-auto p-3">
        {COLUMNS.map((c) => (
          <ColumnView
            key={c}
            column={c}
            tasks={byColumn[c]}
            onOpen={onOpen}
            activeId={activeId}
            selectedId={selectedId}
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
