import type { Column, ExecutorId, ExternalIssue, Task, TaskKind, TaskPriority } from '@agent-kanban/shared';
import { EXECUTOR_IDS, TASK_KINDS, TASK_PRIORITIES } from '@agent-kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { keys, upsertTask, useProject, useProvider, useTasks } from '../api/queries';
import { useProjectEvents } from '../api/sse';
import { Board } from '../components/board/Board';
import { TaskDrawer } from '../components/drawer/TaskDrawer';
import { Shell } from '../components/Shell';
import { Button, DangerConfirm, Field, inputClass, Modal, Switch } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { EXECUTOR_LABELS } from '../lib/state';
import { KIND_LABELS, PRIORITY_LABELS } from '../lib/taskmeta';

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

  return (
    <Shell
      projectId={projectId}
      live={sse}
      center={
        <>
          <div className="relative min-w-0 max-w-xs flex-1">
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
          </div>
          <div className="hidden items-center gap-1 md:flex">
            {QUICK.map((q) => (
              <button
                key={q.id}
                type="button"
                title={q.title}
                onClick={() => setQuick(q.id)}
                className={`rounded-full px-2.5 py-1 text-[11px] transition ${quick === q.id ? 'bg-accent-600 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}`}
              >
                {q.label}
              </button>
            ))}
            <select
              aria-label="Executor filter"
              className="h-7 rounded-full border-0 bg-zinc-100 px-2 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
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
          </div>
        </>
      }
      right={
        <>
          {stats ? (
            <span className="hidden gap-3 text-[11px] text-zinc-500 lg:flex">
              <span>{stats.running} running</span>
              <span>{stats.review} in review</span>
              <span>${stats.cost.toFixed(2)} spent</span>
            </span>
          ) : null}
          {provider.data?.ok ? (
            <Button
              size="sm"
              icon={<Download size={14} />}
              onClick={() => setImporting(true)}
              title={`Import issues from ${provider.data.projectRef}`}
            >
              Import
            </Button>
          ) : null}
          {tasks.data?.length ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={14} />}
              onClick={() => setClearing(true)}
              title="Delete every task of this project"
            >
              Clear
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            icon={<Plus size={14} />}
            onClick={() => setCreating(true)}
            title="New task (n)"
          >
            New task
          </Button>
        </>
      }
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

/** Pick open issues from the provider (GitHub) and create Backlog tasks from them. */
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
      toast.push({ kind: 'success', text: `Imported ${created.length} issue(s) into Backlog` });
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
      <input
        className={`${inputClass} mb-3`}
        placeholder="Filter open issues…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {issues.isLoading ? <p className="text-zinc-500">Loading issues…</p> : null}
      {issues.isError ? <p className="text-red-600">{(issues.error as Error).message}</p> : null}
      <ul className="scrollbar-thin grid max-h-[50vh] gap-1 overflow-y-auto">
        {issues.data?.map((i: ExternalIssue) => (
          <li key={i.externalId}>
            <label className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <input
                type="checkbox"
                className="mt-1"
                checked={picked.has(i.externalId)}
                onChange={() => toggle(i.externalId)}
              />
              <span className="min-w-0">
                <span className="font-medium">{i.title}</span>
                <span className="ml-2 font-mono text-[11px] text-zinc-500">{i.externalId}</span>
                {i.labels.length ? (
                  <span className="ml-2 text-[11px] text-zinc-500">{i.labels.join(', ')}</span>
                ) : null}
                {i.kind || i.priority ? (
                  <span className="ml-2 text-[11px] text-accent-600 dark:text-accent-300">
                    → {i.kind ? KIND_LABELS[i.kind] : ''} {i.priority ? PRIORITY_LABELS[i.priority] : ''}
                  </span>
                ) : null}
                <span className="line-clamp-2 block text-xs text-zinc-500">{i.body}</span>
              </span>
            </label>
          </li>
        ))}
        {issues.data?.length === 0 ? <li className="p-2 text-zinc-500">No open issues match.</li> : null}
      </ul>
    </Modal>
  );
}
