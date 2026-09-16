import type { Project, TaskDetail } from '@agent-kanban/shared';
import { Activity, FileDiff, FlaskConical, LayoutList, MessageSquareText, X } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react';
import { useTask } from '../../api/queries';
import { formatCost } from '../../lib/format';
import { EXECUTOR_ICONS, EXECUTOR_LABELS, isBusy } from '../../lib/state';
import { Badge, ColumnPill, IconButton } from '../ui';
import { ActivityTab } from './ActivityTab';
import { ChatTab } from './ChatTab';
import { OverviewTab } from './OverviewTab';
import { TestsTab } from './TestsTab';

const DiffTab = lazy(() => import('./DiffTab').then((m) => ({ default: m.DiffTab })));

type Tab = 'overview' | 'chat' | 'activity' | 'diff' | 'tests';

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
      if (e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const t = task.data;
  const tabs: { id: Tab; label: string; icon: ReactNode; count?: number | string }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutList size={14} /> },
    {
      id: 'chat',
      label: 'Chat',
      icon: <MessageSquareText size={14} />,
      count: t?.unconsumed_feedback || undefined,
    },
    { id: 'activity', label: 'Activity', icon: <Activity size={14} />, count: t?.runs.length || undefined },
    { id: 'diff', label: 'Diff', icon: <FileDiff size={14} /> },
    {
      id: 'tests',
      label: 'Tests',
      icon: <FlaskConical size={14} />,
      count:
        t?.current_attempt?.last_test_ok === null || t?.current_attempt?.last_test_ok === undefined
          ? undefined
          : t.current_attempt.last_test_ok
            ? '✓'
            : '✗',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-zinc-900/30 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="presentation"
    >
      <aside
        className="flex h-full w-[62vw] min-w-[480px] max-w-[1100px] flex-col border-zinc-200 border-l bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Task details"
      >
        {task.isError ? (
          <div className="p-6 text-sm text-red-600">Task not found.</div>
        ) : !t ? (
          <div className="p-6 text-sm text-zinc-500">Loading…</div>
        ) : (
          <>
            <Header task={t} project={project} onClose={onClose} />
            <nav className="flex gap-1 border-zinc-200 border-b px-3 dark:border-zinc-800">
              {tabs.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setTab(x.id)}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition ${
                    tab === x.id
                      ? 'border-accent-600 font-medium text-accent-700 dark:text-accent-200'
                      : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                  }`}
                >
                  {x.icon}
                  {x.label}
                  {x.count !== undefined ? (
                    <span className="rounded-full bg-zinc-100 px-1.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {x.count}
                    </span>
                  ) : null}
                </button>
              ))}
            </nav>
            <div className="min-h-0 flex-1 bg-zinc-50/60 dark:bg-zinc-950/30">
              {tab === 'overview' ? (
                <div className="scrollbar-thin h-full overflow-y-auto">
                  <OverviewTab task={t} project={project} />
                </div>
              ) : null}
              {tab === 'chat' ? <ChatTab task={t} project={project} /> : null}
              {tab === 'activity' ? <ActivityTab task={t} /> : null}
              {tab === 'diff' ? (
                <Suspense fallback={<div className="p-4 text-sm text-zinc-500">Loading diff viewer…</div>}>
                  <DiffTab task={t} />
                </Suspense>
              ) : null}
              {tab === 'tests' ? (
                <div className="scrollbar-thin h-full overflow-y-auto">
                  <TestsTab task={t} />
                </div>
              ) : null}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Header({ task, project, onClose }: { task: TaskDetail; project: Project; onClose: () => void }) {
  const executor = task.executor ?? project.default_executor;
  const busy = isBusy(task);
  return (
    <div className="border-zinc-200 border-b px-5 pt-4 pb-3 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <ColumnPill column={task.column} />
            <Badge substate={task.substate} />
            {task.refinement_incomplete ? (
              <span className="text-[11px] text-amber-700 dark:text-amber-300">
                refined with open questions
              </span>
            ) : null}
          </div>
          <h2 className="truncate font-semibold text-lg leading-tight tracking-tight">{task.title}</h2>
        </div>
        <IconButton label="Close (Esc)" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <span title="executor">
          {EXECUTOR_ICONS[executor]} {EXECUTOR_LABELS[executor] ?? executor}
        </span>
        <span>{task.runs.length} runs</span>
        <span>{formatCost(task.total_cost_usd) || '$0.00'}</span>
        {task.current_attempt ? <span className="font-mono">{task.current_attempt.branch}</span> : null}
        {busy ? <span className="text-accent-600 dark:text-accent-300">agent is working…</span> : null}
      </div>
    </div>
  );
}
