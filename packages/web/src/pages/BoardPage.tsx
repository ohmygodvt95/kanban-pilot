import type { Column, ExecutorId, ExternalIssue, Task, TaskKind, TaskPriority } from '@agent-kanban/shared';
import { EXECUTOR_IDS, TASK_KINDS, TASK_PRIORITIES } from '@agent-kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  HelpCircle,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { keys, upsertTask, useProject, useProjects, useProvider, useTasks } from '../api/queries';
import { useProjectEvents } from '../api/sse';
import { BulkPushModal } from '../components/BulkPushModal';
import { Board } from '../components/board/Board';
import { CommandPalette, type PaletteAction } from '../components/CommandPalette';
import { TaskDrawer } from '../components/drawer/TaskDrawer';
import { Shell } from '../components/Shell';
import { TOUR_LABELS, Tour } from '../components/Tour';
import { Button, DangerConfirm, Field, IconButton, inputClass, Modal, Switch } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { isFiltering, matchesFilter, QUICK_IDS, type Quick } from '../lib/filter';
import { useI18n } from '../lib/i18n';
import { EXECUTOR_LABELS } from '../lib/state';
import { KIND_LABELS, PRIORITY_LABELS } from '../lib/taskmeta';
import { markTourSeen, tourSeen, tourSteps } from '../lib/tour';

export function BoardPage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const project = useProject(projectId);
  const tasks = useTasks(projectId);
  const provider = useProvider(projectId);
  const projects = useProjects();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [palette, setPalette] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const openFromToast = useCallback(
    (id: string) => {
      const next = new URLSearchParams(window.location.search);
      next.set('task', id);
      setParams(next, { replace: true });
    },
    [setParams],
  );
  const sse = useProjectEvents(projectId, openFromToast);
  const restore = useMutation({
    mutationFn: (ids: string[]) => api.projects.restoreTasks(projectId, ids),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.tasks(projectId) });
      toast.push({ kind: 'success', text: t('clear.restored', { n: r.length }) });
    },
    onError: (err) => toast.error(err),
  });
  const clearAll = useMutation({
    mutationFn: (force: boolean) => api.projects.deleteAllTasks(projectId, force),
    onSuccess: (r) => {
      setClearing(false);
      open(null);
      void qc.invalidateQueries({ queryKey: keys.tasks(projectId) });
      // soft delete on the server: offer an undo while the rows are still around
      toast.push({
        kind: r.skipped ? 'info' : 'success',
        text: `${t('clear.done', { n: r.deleted })}${r.skipped ? ` (${r.skipped} skipped: agent running)` : ''}`,
        duration: 15_000,
        action: r.ids.length ? { label: t('clear.undo'), onClick: () => restore.mutate(r.ids) } : undefined,
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (e.key === '/' && !typing) {
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
  const filter = useMemo(() => ({ query, executor, quick }), [query, executor, quick]);
  const filtered = useMemo(
    () => tasks.data?.filter((x) => matchesFilter(x, filter, defaultExecutor)) ?? [],
    [tasks.data, filter, defaultExecutor],
  );
  const filtering = isFiltering(filter);

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
  const paletteActions: PaletteAction[] = [
    {
      id: 'new',
      label: t('board.newTask'),
      icon: <Plus size={14} />,
      hint: 'n',
      run: () => setCreating(true),
    },
    ...(provider.data?.ok
      ? [
          {
            id: 'import',
            label: t('board.import'),
            icon: <Download size={14} />,
            run: () => setImporting(true),
          },
          {
            id: 'push',
            label: t('board.pushUnlinked', { tracker: provider.data.id }),
            icon: <Upload size={14} />,
            run: () => setPushing(true),
          },
        ]
      : []),
    {
      id: 'filters',
      label: t('board.filters'),
      icon: <SlidersHorizontal size={14} />,
      run: () => setShowFilters((v) => !v),
    },
    {
      id: 'settings',
      label: t('menu.settings'),
      icon: <Settings size={14} />,
      run: () => navigate(`/p/${projectId}/settings`),
    },
    { id: 'integration', label: t('menu.integration'), run: () => navigate(`/p/${projectId}/integration`) },
    { id: 'tour', label: t('board.tour'), icon: <HelpCircle size={14} />, run: () => setTour(true) },
    ...(tasks.data?.length
      ? [{ id: 'clear', label: t('board.clear'), icon: <Trash2 size={14} />, run: () => setClearing(true) }]
      : []),
  ];
  const searchBox = (
    <>
      <Search size={13} className="pointer-events-none absolute top-2.5 left-2 text-zinc-400" />
      <input
        ref={searchRef}
        aria-label="Search tasks"
        className={`${inputClass} h-8 py-1 pr-7 pl-7 text-xs shadow-none`}
        placeholder={t('board.search')}
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
      {QUICK_IDS.map((q) => (
        <button
          key={q}
          type="button"
          title={t(`quick.${q}.title`)}
          onClick={() => setQuick(q)}
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] transition ${quick === q ? 'bg-accent-600 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}`}
        >
          {t(`quick.${q}`)}
        </button>
      ))}
      <select
        aria-label="Executor filter"
        className="h-7 shrink-0 rounded-full border-0 bg-zinc-100 px-2 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        value={executor}
        onChange={(e) => setExecutor(e.target.value as ExecutorId | '')}
      >
        <option value="">{t('board.anyExecutor')}</option>
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
            label={showFilters ? t('board.hideFilters') : t('board.filters')}
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
            <span>{t('board.running', { n: stats.running })}</span>
            <span>{t('board.review', { n: stats.review })}</span>
            <span>{t('board.spent', { n: stats.cost.toFixed(2) })}</span>
          </span>
        ) : null
      }
      onPalette={() => setPalette(true)}
      actions={[
        ...(provider.data?.ok
          ? [
              {
                label: t('board.import'),
                icon: <Download />,
                title: t('board.importTitle', { ref: provider.data.projectRef ?? '' }),
                onClick: () => setImporting(true),
              },
              {
                label: t('board.pushUnlinked', { tracker: provider.data.id }),
                icon: <Upload />,
                onClick: () => setPushing(true),
              },
            ]
          : []),
        ...(tasks.data?.length
          ? [
              {
                label: t('board.clear'),
                icon: <Trash2 />,
                title: t('board.clearTitle'),
                onClick: () => setClearing(true),
              },
            ]
          : []),
        {
          label: t('board.tour'),
          icon: <HelpCircle />,
          title: t('board.tourTitle'),
          onClick: () => setTour(true),
        },
        {
          label: t('board.newTask'),
          icon: <Plus size={14} />,
          title: t('board.newTaskTitle'),
          primary: true,
          onClick: () => setCreating(true),
        },
      ]}
    >
      {project.isError ? <div className="p-6 text-sm text-red-600">{t('board.noProject')}</div> : null}
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
      {project.data && tasks.data && tasks.data.length === 0 && !filtering ? (
        <EmptyBoard
          tracker={provider.data?.ok ? provider.data.id : null}
          onCreate={() => setCreating(true)}
          onImport={() => setImporting(true)}
          onTour={() => setTour(true)}
        />
      ) : null}
      {palette && tasks.data ? (
        <CommandPalette
          tasks={tasks.data}
          projects={projects.data ?? []}
          actions={paletteActions}
          onOpenTask={(id) => open(id)}
          onClose={() => setPalette(false)}
        />
      ) : null}
      {pushing && tasks.data && provider.data?.ok ? (
        <BulkPushModal
          projectId={projectId}
          tracker={provider.data.id}
          tasks={tasks.data}
          onClose={() => setPushing(false)}
        />
      ) : null}
      {clearing && tasks.data ? (
        <DangerConfirm
          title={t('clear.title', { n: tasks.data.length })}
          body={t('clear.body', { minutes: 10 })}
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
        <Tour steps={tourSteps('board', lang)} labels={TOUR_LABELS[lang]} onClose={closeTour} />
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

/** Centered call-to-action when a project has no tasks at all. */
function EmptyBoard({
  tracker,
  onCreate,
  onImport,
  onTour,
}: {
  tracker: string | null;
  onCreate: () => void;
  onImport: () => void;
  onTour: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="pointer-events-none absolute inset-x-0 top-24 z-10 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white/95 p-6 text-center shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-200">
          <Plus size={18} />
        </div>
        <h2 className="font-semibold text-base">{t('empty.title')}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t('empty.body')}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon={<Plus size={14} />} onClick={onCreate}>
            {t('empty.create')}
          </Button>
          {tracker ? (
            <Button icon={<Download size={14} />} onClick={onImport}>
              {t('empty.import', { tracker })}
            </Button>
          ) : null}
          <Button variant="ghost" icon={<HelpCircle size={14} />} onClick={onTour}>
            {t('empty.tour')}
          </Button>
        </div>
      </div>
    </div>
  );
}
