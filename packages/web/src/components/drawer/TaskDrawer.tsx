import type { Project, TaskDetail } from '@agent-kanban/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTask } from '../../api/queries';
import { isBusy } from '../../lib/state';
import { Badge, Button } from '../ui';
import { ActivityTab } from './ActivityTab';
import { OverviewTab } from './OverviewTab';
import { TestsTab } from './TestsTab';

const DiffTab = lazy(() => import('./DiffTab').then((m) => ({ default: m.DiffTab })));

type Tab = 'overview' | 'activity' | 'diff' | 'tests';

export function TaskDrawer({
  taskId,
  project,
  onClose,
}: {
  taskId: string;
  project: Project;
  onClose: () => void;
}) {
  const task = useTask(taskId);
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // auto-switch to Activity when a run starts
  const busy = task.data ? isBusy(task.data) : false;
  useEffect(() => {
    if (busy && tab === 'overview') setTab('activity');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-black/30"
      onMouseDown={onClose}
      role="presentation"
    >
      <aside
        className="flex h-full w-[60vw] min-w-[420px] max-w-[1000px] flex-col bg-white shadow-2xl dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Task details"
      >
        {task.isError ? (
          <div className="p-6 text-sm text-red-600">Task not found.</div>
        ) : !task.data ? (
          <div className="p-6 text-sm text-zinc-500">Loading…</div>
        ) : (
          <>
            <Header task={task.data} onClose={onClose} />
            <nav className="flex gap-1 border-zinc-200 border-b px-3 dark:border-zinc-800">
              {(['overview', 'activity', 'diff', 'tests'] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`border-b-2 px-3 py-2 text-sm capitalize ${
                    tab === t
                      ? 'border-blue-600 font-medium text-blue-700 dark:text-blue-300'
                      : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  {t}
                  {t === 'diff' && task.data.unconsumed_feedback ? (
                    <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-800 dark:bg-blue-900/60 dark:text-blue-200">
                      {task.data.unconsumed_feedback}
                    </span>
                  ) : null}
                </button>
              ))}
            </nav>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
              {tab === 'overview' ? <OverviewTab task={task.data} project={project} /> : null}
              {tab === 'activity' ? <ActivityTab task={task.data} /> : null}
              {tab === 'diff' ? (
                <Suspense fallback={<div className="p-4 text-sm text-zinc-500">Loading diff viewer…</div>}>
                  <DiffTab task={task.data} />
                </Suspense>
              ) : null}
              {tab === 'tests' ? <TestsTab task={task.data} /> : null}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Header({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 border-zinc-200 border-b px-4 py-3 dark:border-zinc-800">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="uppercase">{task.column}</span>
          <Badge substate={task.substate} />
          {task.refinement_incomplete ? (
            <span className="text-amber-700 dark:text-amber-300">refined with open questions</span>
          ) : null}
        </div>
        <h2 className="truncate font-semibold text-base">{task.title}</h2>
      </div>
      <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
        ✕
      </Button>
    </div>
  );
}
