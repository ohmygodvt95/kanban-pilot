import type { Column, ExecutorId, ExternalIssue, Task, TaskKind, TaskPriority } from '@agent-kanban/shared';
import { EXECUTOR_IDS, TASK_KINDS, TASK_PRIORITIES } from '@agent-kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, HelpCircle, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { keys, upsertTask, useProject, useProvider, useTasks } from '../api/queries';
import { useProjectEvents } from '../api/sse';
import { Board } from '../components/board/Board';
import { TaskDrawer } from '../components/drawer/TaskDrawer';
import { Shell } from '../components/Shell';
import { TOUR_LABELS, Tour } from '../components/Tour';
import { Button, DangerConfirm, Field, IconButton, inputClass, Modal, Switch } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { EXECUTOR_LABELS } from '../lib/state';
import { KIND_LABELS, PRIORITY_LABELS } from '../lib/taskmeta';
import { markTourSeen, tourLanguage, tourSeen, tourSteps } from '../lib/tour';

/** Quick filters shown next to the search box. */
type Quick = 'all' | 'attention' | 'running' | 'bugs' | 'urgent';
const QUICK: { id: Quick; label: string; title: string }[] = [
  { id: 'all', label: 'All', title: 'Show every task' },
  { id: 'attention', label: 'Needs me', title: 'Errors, open questions, ready to review' },
  { id: 'running', label: 'Running', title: 'Agent currently working' },
  { id: 'bugs', label: 'Bugs', title: 'Tasks classified as bugs' },
  { id: 'urgent', label: 'Urgent', title: 'High and urgent priority' },
];

function matches(
  task: Task,
  query: string,
  executor: ExecutorId | '',
  quick: Quick,
  defaultExecutor: string,
): boolean {
  if (query) {
    const q = query.toLowerCase();
    if (
      !task.title.toLowerCase().includes(q) &&
      !task.description.toLowerCase().includes(q) &&
      !task.id.toLowerCase().includes(q)
    )
      return false;
  }
  if (executor && (task.executor ?? defaultExecutor) !== executor) return false;
  if (quick === 'attention') {
    return (
      (task.column === 'doing' && task.substate === 'error') ||
      task.substate === 'needs_answer' ||
      task.column === 'review'
    );
  }
  if (quick === 'running')
    return task.column === 'doing' && (task.substate === 'running' || task.substate === 'queued');
  if (quick === 'bugs') return task.kind === 'bug';
  if (quick === 'urgent') return task.priority === 'urgent' || task.priority === 'high';
  return true;
}

export function BoardPage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const project = useProject(projectId);
  const tasks = useTasks(projectId);
  const provider = useProvider(projectId);
  const sse = useProjectEvents(projectId);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const clearAll = useMutation({
    mutationFn: (force: boolean) => api.projects.deleteAllTasks(projectId, force),
    onSuccess: (r) => {
      setClearing(false);
      open(null);
      void qc.invalidateQueries({ queryKey: keys.tasks(projectId) });
      toast.push({
        kind: r.skipped ? 'info' : 'success',
        text: `Deleted ${r.deleted} task${r.deleted === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} skipped (agent running)` : ''}`,
      });
    },
    onError: (err) => toast.error(err, 'Delete failed'),
  });
  const [query, setQuery] = useState('');
  const [executor, setExecutor] = useState<ExecutorId | ''>('');
  const [quick, setQuick] = useState<Quick>('all');
  const [collapsed, setCollapsed] = useState<Set<Column>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('ak.collapsed') ?? '[]') as Column[]);
    } catch {
      return new Set();
    }
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = params.get('task');

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('task', id);
    else next.delete('task');
    setParams(next, { replace: true });
  };

  const toggleCollapsed = (c: Column) =>
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      localStorage.setItem('ak.collapsed', JSON.stringify([...next]));
      return next;
    });

  // Keyboard shortcuts: n = new task, / = focus search, Esc = clear search (drawer handles its own Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'n' && !typing && !selected && !creating) {
        e.preventDefault();
        setCreating(true);
      } else if (e.key === 'Escape' && target === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, creating]);

  const defaultExecutor = project.data?.default_executor ?? 'claude';
  const filtered = useMemo(
    () => tasks.data?.filter((t) => matches(t, query.trim(), executor, quick, defaultExecutor)) ?? [],
    [tasks.data, query, executor, quick, defaultExecutor],
  );
  const filtering = !!query.trim() || !!executor || quick !== 'all';

  const stats = tasks.data
    ? {
        running: tasks.data.filter((t) => t.column === 'doing' && t.substate === 'running').length,
        review: tasks.data.filter((t) => t.column === 'review').length,
        cost: tasks.data.reduce((s, t) => s + (t.total_cost_usd ?? 0), 0),
      }
    : null;

  const [showFilters, setShowFilters] = useState(false);
  // First visit: guided tour once the board has rendered; replayable from the ⋯ menu.
  const [tour, setTour] = useState(false);
  useEffect(() => {
    if (tasks.data && !tourSeen('board')) setTour(true);
  }, [tasks.data]);
  const closeTour = () => {
    markTourSeen('board');
    setTour(false);
  };
  const searchBox = (
    <>
      <Search size={13} className="pointer-events-none absolute top-2.5 left-2 text-zinc-400" />
      <input
        ref={searchRef}
        aria-label="Search tasks"
        className={`${inputClass} h-8 py-1 pr-7 pl-7 text-xs shadow-none`}
        placeholder="Search tasks  ( / )"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute top-2 right-2 text-zinc-400 hover:text-zinc-700"
          onClick={() => setQuery('')}
        >
          <X size={13} />
        </button>
      ) : null}
    </>
  );
  const filterControls = (
    <>
      {QUICK.map((q) => (
        <button
          key={q.id}
          type="button"
          title={q.title}
          onClick={() => setQuick(q.id)}
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] transition ${quick === q.id ? 'bg-accent-600 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}`}
        >
          {q.label}
        </button>
      ))}
      <select
        aria-label="Executor filter"
        className="h-7 shrink-0 rounded-full border-0 bg-zinc-100 px-2 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        value={executor}
        onChange={(e) => setExecutor(e.target.value as ExecutorId | '')}
      >
        <option value="">any executor</option>
        {EXECUTOR_IDS.map((id) => (
          <option key={id} value={id}>
            {EXECUTOR_LABELS[id] ?? id}
          </option>
        ))}
      </select>
    </>
  );

  return (
    <Shell
      projectId={projectId}
      live={sse}
      center={
        <>
          <div className="relative hidden min-w-44 max-w-xs flex-1 sm:block" data-tour="search">
            {searchBox}
          </div>
          {/* filters live in a second row, revealed by this toggle (or automatically while active) */}
          <IconButton
            label={showFilters ? 'Hide filters' : 'Filters'}
            className={`relative ${showFilters ? 'bg-zinc-200/70 dark:bg-zinc-700' : ''}`}
            onClick={() => setShowFilters((v) => !v)}
            data-tour="filters"
          >
            <SlidersHorizontal size={16} />
            {filtering ? (
              <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-accent-500" />
            ) : null}
          </IconButton>
        </>
      }
      subheader={
        showFilters || (filtering && !query) ? (
          <div className="flex items-center gap-2">
            <div className="relative w-56 shrink-0 sm:hidden">{searchBox}</div>
            {filterControls}
          </div>
        ) : null
      }
      info={
        stats ? (
          <span className="flex gap-3">
            <span>{stats.running} running</span>
            <span>{stats.review} in review</span>
            <span>${stats.cost.toFixed(2)} spent</span>
          </span>
        ) : null
      }
      actions={[
        ...(provider.data?.ok
          ? [
              {
                label: 'Import issues',
                icon: <Download />,
                title: `Import issues from ${provider.data.projectRef}`,
                onClick: () => setImporting(true),
              },
            ]
          : []),
        ...(tasks.data?.length
          ? [
              {
                label: 'Clear all tasks',
                icon: <Trash2 />,
                title: 'Delete every task of this project',
                onClick: () => setClearing(true),
              },
            ]
          : []),
        {
          label: 'New task',
          icon: <Plus size={14} />,
          title: 'New task (n)',
          primary: true,
          onClick: () => setCreating(true),
        },
      ]}
    >
      {project.isError ? <div className="p-6 text-sm text-red-600">Project not found.</div> : null}
      {project.data && tasks.data ? (
        <Board
          project={project.data}
          tasks={filtered}
          onOpen={open}
          onNewTask={() => setCreating(true)}
          selectedId={selected}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          filtering={filtering}
          hiddenCount={tasks.data.length - filtered.length}
        />
      ) : (
        <div className="p-6 text-sm text-zinc-500">Loading…</div>
      )}
      {clearing && tasks.data ? (
        <DangerConfirm
          title={`Delete all ${tasks.data.length} tasks?`}
          body="Every task of this project is removed, whatever its origin (manual or imported), together with runs, comments and active worktrees. Linked issues on the tracker are not touched; imported ones come back on the next poll unless you remove the integration."
          running={
            tasks.data.filter(
              (t) => t.column === 'doing' && (t.substate === 'running' || t.substate === 'queued'),
            ).length
          }
          loading={clearAll.isPending}
          onConfirm={(force) => clearAll.mutate(force)}
          onClose={() => setClearing(false)}
        />
      ) : null}
      {creating ? (
        <NewTaskModal
          projectId={projectId}
          refinementEnabled={project.data?.refinement_enabled ?? true}
          onClose={() => setCreating(false)}
          onCreated={(t) => open(t.id)}
        />
      ) : null}
      {importing && provider.data?.projectRef ? (
        <ImportIssuesModal
          projectId={projectId}
          projectRef={provider.data.projectRef}
          onClose={() => setImporting(false)}
        />
      ) : null}
      {tour && tasks.data ? (
        <Tour steps={tourSteps('board')} labels={TOUR_LABELS[tourLanguage()]} onClose={closeTour} />
      ) : null}
      {selected && project.data ? (
        <TaskDrawer taskId={selected} project={project.data} onClose={() => open(null)} />
      ) : null}
    </Shell>
  );
}

function NewTaskModal({
  projectId,
  refinementEnabled,
  onClose,
  onCreated,
}: {
  projectId: string;
  refinementEnabled: boolean;
  onClose: () => void;
  onCreated: (t: Task) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [skip, setSkip] = useState(false);
  const [kind, setKind] = useState<TaskKind | ''>('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const create = useMutation({
    mutationFn: () =>
      api.projects.createTask(projectId, {
        title: title.trim(),
        description,
        skip_refinement: skip,
        kind: kind || null,
        priority: priority || null,
      }),
    onSuccess: (t) => {
      upsertTask(qc, t);
      void qc.invalidateQueries({ queryKey: keys.tasks(projectId) });
      onClose();
      onCreated(t);
    },
    onError: (err) => toast.error(err, 'Cannot create task'),
  });
  return (
    <Modal
      title="New task"
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!title.trim()}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Create in Backlog
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Title">
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add rate limiting to the login endpoint"
            onKeyDown={(e) => e.key === 'Enter' && title.trim() && create.mutate()}
          />
        </Field>
        <Field
          label="Description"
          hint="Markdown. This is the prompt the agent receives, so be specific: scope, acceptance criteria, files you already know about."
        >
          <textarea
            className={`${inputClass} min-h-44 font-mono text-xs`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Type"
            hint={
              refinementEnabled ? 'Leave on auto and the planner classifies it during refinement.' : undefined
            }
          >
            <select
              className={inputClass}
              value={kind}
              onChange={(e) => setKind(e.target.value as TaskKind | '')}
            >
              <option value="">auto</option>
              {TASK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority" hint="Urgent/high tasks run first when the queue is full.">
            <select
              className={inputClass}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority | '')}
            >
              <option value="">auto</option>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {refinementEnabled ? (
          <Switch
            checked={skip}
            onChange={setSkip}
            label="Skip refinement for this task (go straight to To do)"
          />
        ) : null}
      </div>
    </Modal>
  );
}

/** Pick issues from the linked tracker and create Backlog/To do tasks from them. */
function ImportIssuesModal({
  projectId,
  projectRef,
  onClose,
}: {
  projectId: string;
  projectRef: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const issues = useQuery({
    queryKey: ['issues', projectId, query],
    queryFn: () => api.projects.issues(projectId, query || undefined),
    staleTime: 30_000,
  });
  const doImport = useMutation({
    mutationFn: () => api.projects.importIssues(projectId, [...picked]),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: keys.tasks(projectId) });
      void qc.invalidateQueries({ queryKey: ['issues', projectId] });
      toast.push({ kind: 'success', text: `Imported ${created.length} issue(s)` });
      onClose();
    },
    onError: (err) => toast.error(err, 'Import failed'),
  });
  const toggle = (id: string) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Already-imported issues and those whose status maps to Done are noise; hide them unless asked.
  const all = issues.data ?? [];
  const importable = all.filter((i) => !i.imported && i.column !== 'skip');
  const hidden = all.length - importable.length;
  const visible = showAll ? all : importable;
  return (
    <Modal
      title={`Import issues from ${projectRef}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={picked.size === 0}
            loading={doImport.isPending}
            onClick={() => doImport.mutate()}
            icon={<Download size={14} />}
          >
            Import {picked.size || ''}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-3">
        <input
          className={`${inputClass} flex-1`}
          placeholder="Filter issues…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {hidden > 0 ? (
          <Switch
            checked={showAll}
            onChange={setShowAll}
            label={<span className="text-xs">show {hidden} imported / done</span>}
          />
        ) : null}
      </div>
      <p className="mb-2 text-xs text-zinc-500">
        Issues matching the integration filter are also imported automatically every poll. Status → column
        comes from the status map; "done" statuses are never imported.
      </p>
      {issues.isLoading ? <p className="text-zinc-500">Loading issues…</p> : null}
      {issues.isError ? <p className="text-red-600">{(issues.error as Error).message}</p> : null}
      <ul className="scrollbar-thin grid max-h-[50vh] gap-1 overflow-y-auto">
        {visible.map((i: ExternalIssue) => {
          const disabled = !!i.imported || i.column === 'skip';
          return (
            <li key={i.externalId}>
              <label
                className={`flex items-start gap-2 rounded-md p-2 ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled={disabled}
                  checked={picked.has(i.externalId)}
                  onChange={() => toggle(i.externalId)}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{i.title}</span>
                  <span className="ml-2 font-mono text-[11px] text-zinc-500">{i.externalId}</span>
                  <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-zinc-500">
                    {i.status ? (
                      <span>
                        {i.status} →{' '}
                        {i.column === 'skip' ? (
                          <span className="text-zinc-400">not imported (done)</span>
                        ) : (
                          <span className="text-accent-600 dark:text-accent-300">
                            {i.column ?? 'backlog'}
                          </span>
                        )}
                      </span>
                    ) : null}
                    {i.imported ? <span className="text-emerald-600">already imported</span> : null}
                    {i.labels.length ? <span>{i.labels.join(', ')}</span> : null}
                    {i.kind || i.priority ? (
                      <span>
                        {i.kind ? KIND_LABELS[i.kind] : ''} {i.priority ? PRIORITY_LABELS[i.priority] : ''}
                      </span>
                    ) : null}
                  </span>
                  <span className="line-clamp-2 block text-xs text-zinc-500">{i.body}</span>
                </span>
              </label>
            </li>
          );
        })}
        {visible.length === 0 && !issues.isLoading ? (
          <li className="p-2 text-zinc-500">
            {hidden ? 'Everything importable is already a task.' : 'No issues match.'}
          </li>
        ) : null}
      </ul>
    </Modal>
  );
}
