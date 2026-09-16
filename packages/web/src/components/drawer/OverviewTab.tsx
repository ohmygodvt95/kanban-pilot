import type { ExecutorId, Project, TaskDetail, TaskKind, TaskPriority } from '@agent-kanban/shared';
import { EXECUTOR_IDS, TASK_KINDS, TASK_PRIORITIES } from '@agent-kanban/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  ExternalLink,
  FlaskConical,
  GitMerge,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { ApiError, api } from '../../api/client';
import { keys, upsertTask, useProvider } from '../../api/queries';
import { formatCost, formatTime } from '../../lib/format';
import { EXECUTOR_LABELS, isBusy } from '../../lib/state';
import { KIND_LABELS, PRIORITY_LABELS } from '../../lib/taskmeta';
import { Button, Card, Field, inputClass, KeyValue, Switch, useConfirm } from '../ui';
import { useToast } from '../ui/Toast';
import { type PushRequest, PushToTrackerModal } from './PushToTrackerModal';

export function OverviewTab({ task, project }: { task: TaskDetail; project: Project }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
  const provider = useProvider(project.id);
  const [pushRequest, setPushRequest] = useState<PushRequest | null>(null);
  const busy = isBusy(task);
  const activeRun = task.runs.find((r) => r.status === 'running' || r.status === 'queued');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [sourceUrl, setSourceUrl] = useState(task.source_url ?? '');
  useEffect(() => {
    if (!editing) {
      setTitle(task.title);
      setDescription(task.description);
      setSourceUrl(task.source_url ?? '');
    }
  }, [task, editing]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.task(task.id) });
    void qc.invalidateQueries({ queryKey: keys.tasks(task.project_id) });
  };
  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (err) => {
      toast.error(err);
      refresh();
    },
  });
  const run = (fn: () => Promise<unknown>) => act.mutate(fn);
  const transition =
    (target: TaskDetail['column'], payload?: { action?: 'retry'; confirm_discard?: boolean }) => async () => {
      try {
        upsertTask(qc, await api.tasks.transition(task.id, { target, payload }));
      } catch (err) {
        if (err instanceof ApiError && err.code === 'CONFIRM_REQUIRED') {
          if (
            await confirm({
              title: 'Discard current attempt?',
              body: err.message,
              danger: true,
              confirmLabel: 'Discard',
            })
          ) {
            upsertTask(
              qc,
              await api.tasks.transition(task.id, { target, payload: { ...payload, confirm_discard: true } }),
            );
          }
          return;
        }
        throw err;
      }
    };

  const save = useMutation({
    mutationFn: () =>
      api.tasks.update(task.id, { title: title.trim(), description, source_url: sourceUrl.trim() || null }),
    onSuccess: (t) => {
      upsertTask(qc, t);
      setEditing(false);
    },
    onError: (err) => toast.error(err, 'Save failed'),
  });

  const openQuestions = task.questions.filter((q) => !q.answer);
  const executor = task.executor ?? project.default_executor;
  const lastRun = task.runs.at(-1);

  return (
    <div className="grid gap-4 p-4 text-sm">
      {confirmNode}
      {pushRequest && provider.data ? (
        <PushToTrackerModal
          task={task}
          request={pushRequest}
          providerName={provider.data.id}
          onClose={() => setPushRequest(null)}
        />
      ) : null}
      {task.last_error ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-xs dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="whitespace-pre-wrap">{task.last_error}</div>
        </div>
      ) : null}

      <Actions
        task={task}
        project={project}
        toast={toast}
        busy={busy}
        activeRunId={activeRun?.id}
        run={run}
        transition={transition}
        confirm={confirm}
        pending={act.isPending}
        trackerName={
          provider.data?.ok && !task.source_external_id && task.column !== 'done' ? provider.data.id : null
        }
        onPush={async () => {
          try {
            upsertTask(qc, await api.tasks.push(task.id, {}));
            toast.push({ kind: 'success', text: `Created on ${provider.data?.id}` });
          } catch (err) {
            if (err instanceof ApiError && err.code === 'CONFIRM_REQUIRED')
              setPushRequest(err.details as PushRequest);
            else toast.error(err, 'Push failed');
          }
        }}
      />

      {task.column === 'backlog' && task.substate === 'needs_answer' && openQuestions.length ? (
        <Questions task={task} />
      ) : null}

      <Card
        title="Description"
        actions={
          !editing && !busy && task.column !== 'done' ? (
            <Button size="xs" variant="ghost" icon={<Pencil size={12} />} onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null
        }
      >
        {editing ? (
          <div className="grid gap-3">
            <Field label="Title">
              <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Description (markdown — this is the prompt)">
              <textarea
                className={`${inputClass} min-h-52 font-mono text-xs`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field label="Linked issue URL (optional)">
              <input
                className={inputClass}
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://github.com/org/repo/issues/1"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!title.trim()}
                loading={save.isPending}
                onClick={() => save.mutate()}
                icon={<Check size={13} />}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="md text-[13px] leading-relaxed">
            {task.description ? (
              <Markdown>{task.description}</Markdown>
            ) : (
              <span className="text-zinc-400">No description.</span>
            )}
          </div>
        )}
      </Card>

      {task.plan ? (
        <Card
          title={
            <span className="flex items-center gap-1.5">
              <Sparkles size={14} className="text-violet-500" /> Plan from refinement
            </span>
          }
        >
          <div className="md text-[13px] leading-relaxed">
            <Markdown>{task.plan}</Markdown>
          </div>
        </Card>
      ) : null}

      {task.questions.length && !(task.column === 'backlog' && task.substate === 'needs_answer') ? (
        <Card title="Refinement Q&A">
          <ul className="grid gap-2 text-xs">
            {task.questions.map((q) => (
              <li key={q.id} className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/60">
                <div className="font-medium">{q.question}</div>
                <div className="mt-0.5 text-zinc-600 dark:text-zinc-300">
                  {q.answer ?? <em className="text-zinc-400">unanswered</em>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Agent">
          <KeyValue
            items={[
              {
                k: 'Executor',
                v:
                  busy || task.column === 'done' ? (
                    (EXECUTOR_LABELS[executor] ?? executor)
                  ) : (
                    <select
                      className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-600"
                      value={task.executor ?? ''}
                      onChange={(e) =>
                        run(() =>
                          api.tasks.update(task.id, {
                            executor: (e.target.value || null) as ExecutorId | null,
                          }),
                        )
                      }
                    >
                      <option value="">project default ({EXECUTOR_LABELS[project.default_executor]})</option>
                      {EXECUTOR_IDS.map((id) => (
                        <option key={id} value={id}>
                          {EXECUTOR_LABELS[id] ?? id}
                        </option>
                      ))}
                    </select>
                  ),
              },
              {
                k: 'Refinement',
                v: (
                  <Switch
                    checked={task.skip_refinement}
                    disabled={busy || task.column !== 'backlog'}
                    onChange={(v) => run(() => api.tasks.update(task.id, { skip_refinement: v }))}
                    label={<span className="text-xs">skip for this task</span>}
                  />
                ),
              },
              {
                k: 'Model',
                v:
                  busy || task.column === 'done' ? (
                    (task.model ?? project.model ?? 'CLI default')
                  ) : (
                    <input
                      className="w-40 rounded border border-zinc-300 bg-transparent px-1 py-0.5 font-mono text-xs dark:border-zinc-600"
                      defaultValue={task.model ?? ''}
                      placeholder={project.model ?? 'CLI default'}
                      title="Per-task model override (e.g. sonnet, opus). Blank = project default."
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null;
                        if (v !== task.model) run(() => api.tasks.update(task.id, { model: v }));
                      }}
                    />
                  ),
              },
              {
                k: 'Type',
                v:
                  task.column === 'done' ? (
                    task.kind ? (
                      KIND_LABELS[task.kind]
                    ) : (
                      '—'
                    )
                  ) : (
                    <select
                      className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-600"
                      value={task.kind ?? ''}
                      onChange={(e) =>
                        run(() =>
                          api.tasks.update(task.id, { kind: (e.target.value || null) as TaskKind | null }),
                        )
                      }
                    >
                      <option value="">auto (planner decides)</option>
                      {TASK_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  ),
              },
              {
                k: 'Priority',
                v:
                  task.column === 'done' ? (
                    task.priority ? (
                      PRIORITY_LABELS[task.priority]
                    ) : (
                      '—'
                    )
                  ) : (
                    <select
                      className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-600"
                      value={task.priority ?? ''}
                      title="Urgent/high tasks run first when the queue is full"
                      onChange={(e) =>
                        run(() =>
                          api.tasks.update(task.id, {
                            priority: (e.target.value || null) as TaskPriority | null,
                          }),
                        )
                      }
                    >
                      <option value="">auto (planner decides)</option>
                      {TASK_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {PRIORITY_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  ),
              },
              {
                k: 'Browser',
                v:
                  busy || task.column === 'done' ? (
                    (task.browser ?? project.browser_enabled) ? (
                      'on (Claude in Chrome)'
                    ) : (
                      'off'
                    )
                  ) : (
                    <select
                      className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-600"
                      value={task.browser === null ? '' : task.browser ? 'on' : 'off'}
                      title="Let the agent use Chrome for this task (Claude in Chrome)"
                      onChange={(e) =>
                        run(() =>
                          api.tasks.update(task.id, {
                            browser: e.target.value === '' ? null : e.target.value === 'on',
                          }),
                        )
                      }
                    >
                      <option value="">project default ({project.browser_enabled ? 'on' : 'off'})</option>
                      <option value="on">on</option>
                      <option value="off">off</option>
                    </select>
                  ),
              },
              {
                k: 'Total cost',
                v: `${formatCost(task.total_cost_usd) || '$0.00'}${project.max_budget_usd ? ` (cap ${formatCost(project.max_budget_usd)}/run)` : ''}`,
              },
              {
                k: 'Runs',
                v: `${task.runs.length}${lastRun ? ` · last ${lastRun.kind} ${lastRun.status} ${formatTime(lastRun.finished_at ?? lastRun.created_at)}` : ''}`,
              },
              {
                k: 'Session',
                v: (
                  <span className="font-mono">
                    {task.refinement_session_id
                      ? `${task.refinement_session_id.slice(0, 8)}… (refinement)`
                      : lastRun?.session_id
                        ? `${lastRun.session_id.slice(0, 8)}…`
                        : '—'}
                  </span>
                ),
              },
            ]}
          />
        </Card>
        <Card title="Attempt">
          {task.current_attempt ? (
            <KeyValue
              items={[
                { k: 'Status', v: task.current_attempt.status },
                { k: 'Branch', v: <span className="font-mono">{task.current_attempt.branch}</span> },
                {
                  k: 'Base',
                  v: <span className="font-mono">{task.current_attempt.base_commit.slice(0, 10)}</span>,
                },
                {
                  k: 'Worktree',
                  v: (
                    <span className="flex flex-col gap-1">
                      <span className="break-all font-mono text-[11px]">
                        {task.current_attempt.worktree_path}
                      </span>
                      {task.current_attempt.status === 'active' ? (
                        <span className="flex gap-2">
                          <a
                            className="inline-flex items-center gap-1 text-accent-600 hover:underline dark:text-accent-300"
                            href={`vscode://file/${task.current_attempt.worktree_path}`}
                          >
                            <Code2 size={12} /> Open in VS Code
                          </a>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-zinc-500 hover:underline"
                            onClick={() =>
                              void navigator.clipboard?.writeText(task.current_attempt!.worktree_path)
                            }
                          >
                            <Copy size={12} /> copy path
                          </button>
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  k: 'Tests',
                  v:
                    task.current_attempt.last_test_ok === null
                      ? '—'
                      : task.current_attempt.last_test_ok
                        ? '✓ passed'
                        : '✗ failed',
                },
                ...(task.current_attempt.pr_url
                  ? [
                      {
                        k: 'Pull request',
                        v: (
                          <a
                            className="inline-flex items-center gap-1 text-accent-600 hover:underline dark:text-accent-300"
                            href={task.current_attempt.pr_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={12} /> {task.current_attempt.pr_url}
                          </a>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          ) : (
            <p className="text-xs text-zinc-500">No worktree yet. Start the task to create one.</p>
          )}
        </Card>
      </div>

      <KeyValue
        items={[
          { k: 'Task id', v: <span className="font-mono">{task.id}</span> },
          { k: 'Created', v: formatTime(task.created_at) },
          ...(task.source_url
            ? [
                {
                  k: 'Issue',
                  v: (
                    <a
                      className="text-accent-600 hover:underline dark:text-accent-300"
                      href={task.source_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {task.source_url}
                    </a>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

function Actions({
  task,
  project,
  busy,
  activeRunId,
  run,
  transition,
  confirm,
  pending,
  toast,
  trackerName,
  onPush,
}: {
  task: TaskDetail;
  project: Project;
  busy: boolean;
  activeRunId?: string;
  run: (fn: () => Promise<unknown>) => void;
  transition: (target: TaskDetail['column'], payload?: { action?: 'retry' }) => () => Promise<unknown>;
  confirm: (o: {
    title: string;
    body: ReactNode;
    danger?: boolean;
    confirmLabel?: string;
  }) => Promise<boolean>;
  pending: boolean;
  toast: ReturnType<typeof useToast>;
  /** Name of the linked tracker when the task can be pushed there, else null. */
  trackerName: string | null;
  onPush: () => void;
}) {
  const buttons: {
    label: string;
    icon: ReactNode;
    variant?: 'primary' | 'danger' | 'secondary';
    onClick: () => void;
    title?: string;
  }[] = [];
  const { column, substate } = task;
  if (busy && activeRunId) {
    buttons.push({
      label: 'Cancel run',
      icon: <Square size={13} />,
      variant: 'danger',
      onClick: () => run(() => api.runs.cancel(activeRunId)),
    });
  }
  if (column === 'backlog' && !busy) {
    if (substate !== 'needs_answer' || task.skip_refinement) {
      buttons.push({
        label: task.skip_refinement ? 'Move to To do' : 'Refine → To do',
        icon: <Sparkles size={13} />,
        variant: 'primary',
        onClick: () => run(transition('todo')),
      });
    }
    if (!task.skip_refinement) {
      buttons.push({
        label: 'Skip refinement',
        icon: <Play size={13} />,
        title: 'Move to To do without asking the agent to plan',
        onClick: () =>
          run(async () => {
            await api.tasks.update(task.id, { skip_refinement: true });
            await transition('todo')();
          }),
      });
    }
  }
  if (column === 'todo')
    buttons.push({
      label: 'Start',
      icon: <Play size={13} />,
      variant: 'primary',
      onClick: () => run(transition('doing')),
    });
  if (column === 'doing' && substate === 'error') {
    buttons.push({
      label: 'Retry (resume session)',
      icon: <RefreshCw size={13} />,
      variant: 'primary',
      onClick: () => run(transition('doing', { action: 'retry' })),
    });
  }
  if (column === 'review') {
    buttons.push({
      label: project.done_action === 'pr' ? 'Open PR → Done' : 'Merge → Done',
      icon: <Check size={13} />,
      variant: 'primary',
      onClick: () => run(transition('done')),
    });
  }
  if ((column === 'doing' && substate === 'error') || column === 'review') {
    buttons.push({
      label: `Update from ${project.base_branch}`,
      icon: <GitMerge size={13} />,
      title: 'Merge the base branch into this attempt; conflicts are handed to the agent',
      onClick: () =>
        run(async () => {
          const res = await api.tasks.updateBase(task.id);
          toast.push(
            res.conflicts.length
              ? {
                  kind: 'info',
                  text: `Conflicts in ${res.conflicts.join(', ')} — the agent is resolving them`,
                }
              : { kind: 'success', text: `Attempt is up to date with ${project.base_branch}` },
          );
        }),
    });
    if (project.test_script) {
      buttons.push({
        label: 'Run tests',
        icon: <FlaskConical size={13} />,
        onClick: () => run(() => api.tasks.runTests(task.id)),
      });
    }
    buttons.push({
      label: 'Restart attempt',
      icon: <RotateCcw size={13} />,
      title: 'Discard the worktree and start over with all feedback so far',
      onClick: async () => {
        if (
          await confirm({
            title: 'Restart attempt?',
            body: 'The current worktree and branch are discarded. A new attempt starts from the description, plan and all feedback so far.',
            danger: true,
            confirmLabel: 'Restart',
          })
        )
          run(() => api.tasks.restart(task.id));
      },
    });
    buttons.push({
      label: 'Discard attempt',
      icon: <Undo2 size={13} />,
      variant: 'danger',
      onClick: async () => {
        if (
          await confirm({
            title: 'Discard attempt?',
            body: 'Worktree and branch are deleted; the task goes back to To do. Comments are kept.',
            danger: true,
            confirmLabel: 'Discard',
          })
        )
          run(() => api.tasks.discard(task.id));
      },
    });
  }
  if (column === 'done')
    buttons.push({
      label: 'Clone task',
      icon: <Copy size={13} />,
      onClick: () => run(() => api.tasks.clone(task.id)),
    });
  if (column !== 'done' && !busy) {
    buttons.push({
      label: 'Delete',
      icon: <Trash2 size={13} />,
      variant: 'danger',
      onClick: async () => {
        if (
          await confirm({
            title: 'Delete task?',
            body: 'Runs, comments and any active worktree are removed.',
            danger: true,
            confirmLabel: 'Delete',
          })
        )
          run(() => api.tasks.delete(task.id));
      },
    });
  }
  if (!buttons.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map((b) => (
        <Button
          key={b.label}
          variant={b.variant ?? 'secondary'}
          size="sm"
          onClick={b.onClick}
          disabled={pending}
          title={b.title}
          icon={b.icon}
        >
          {b.label}
        </Button>
      ))}
    </div>
  );
}

function Questions({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const open = task.questions.filter((q) => !q.answer);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const submit = useMutation({
    mutationFn: async () => {
      for (const q of open) {
        const a = answers[q.id]?.trim();
        if (a) await api.tasks.answer(task.id, q.id, a);
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.task(task.id) }),
    onError: (err) => toast.error(err, 'Could not submit answers'),
  });
  const allFilled = open.every((q) => answers[q.id]?.trim());
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
      <h3 className="mb-1 font-semibold text-sm">The agent needs a few answers before this task is ready</h3>
      <p className="mb-3 text-xs text-zinc-600 dark:text-zinc-300">
        Your answers are appended to the description and refinement resumes in the same session. You can also
        discuss in the Chat tab first.
      </p>
      <div className="grid gap-3">
        {open.map((q, i) => (
          <Field key={q.id} label={`${i + 1}. ${q.question}`}>
            <textarea
              className={`${inputClass} min-h-16`}
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          size="sm"
          disabled={!allFilled}
          loading={submit.isPending}
          onClick={() => submit.mutate()}
          icon={<Sparkles size={13} />}
        >
          Submit answers & continue refinement
        </Button>
      </div>
    </section>
  );
}
