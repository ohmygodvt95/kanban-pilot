import type { ExecutorId, Project, TaskDetail } from '@agent-kanban/shared';
import { EXECUTOR_IDS } from '@agent-kanban/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { ApiError, api } from '../../api/client';
import { keys, upsertTask } from '../../api/queries';
import { formatCost } from '../../lib/format';
import { isBusy } from '../../lib/state';
import { Button, Field, inputClass, useConfirm } from '../ui';
import { useToast } from '../ui/Toast';

export function OverviewTab({ task, project }: { task: TaskDetail; project: Project }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
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

  return (
    <div className="grid gap-5 p-4 text-sm">
      {confirmNode}
      {task.last_error ? (
        <div className="whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 p-3 text-red-800 text-xs dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {task.last_error}
        </div>
      ) : null}

      <Actions
        task={task}
        busy={busy}
        activeRunId={activeRun?.id}
        run={run}
        transition={transition}
        confirm={confirm}
        pending={act.isPending}
      />

      {task.column === 'backlog' && task.substate === 'needs_answer' && openQuestions.length ? (
        <Questions task={task} />
      ) : null}

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-medium text-zinc-600 dark:text-zinc-300">Description</h3>
          {!editing && !busy && task.column !== 'done' ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
        </div>
        {editing ? (
          <div className="grid gap-2">
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea
              className={`${inputClass} min-h-48 font-mono text-xs`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
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
                disabled={!title.trim() || save.isPending}
                onClick={() => save.mutate()}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="prose-sm rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            {task.description ? (
              <Markdown>{task.description}</Markdown>
            ) : (
              <span className="text-zinc-400">No description.</span>
            )}
          </div>
        )}
      </section>

      {task.plan ? (
        <section>
          <h3 className="mb-1 font-medium text-zinc-600 dark:text-zinc-300">Plan (from refinement)</h3>
          <div className="prose-sm rounded-md border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900 dark:bg-violet-950/20">
            <Markdown>{task.plan}</Markdown>
          </div>
        </section>
      ) : null}

      {task.questions.length && !(task.column === 'backlog' && task.substate === 'needs_answer') ? (
        <section>
          <h3 className="mb-1 font-medium text-zinc-600 dark:text-zinc-300">Refinement Q&A</h3>
          <ul className="grid gap-1 rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-800">
            {task.questions.map((q) => (
              <li key={q.id}>
                <div className="font-medium">Q: {q.question}</div>
                <div className="text-zinc-600 dark:text-zinc-300">
                  A: {q.answer ?? <em className="text-zinc-400">unanswered</em>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <h3 className="font-medium">Details</h3>
        <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1">
          <span>Executor</span>
          <span>
            {busy || task.column === 'done' ? (
              executor
            ) : (
              <select
                className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-600"
                value={task.executor ?? ''}
                onChange={(e) =>
                  run(() =>
                    api.tasks.update(task.id, { executor: (e.target.value || null) as ExecutorId | null }),
                  )
                }
              >
                <option value="">project default ({project.default_executor})</option>
                {EXECUTOR_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            )}
          </span>
          <span>Refinement</span>
          <span>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={task.skip_refinement}
                disabled={busy || task.column !== 'backlog'}
                onChange={(e) => run(() => api.tasks.update(task.id, { skip_refinement: e.target.checked }))}
              />
              skip for this task
            </label>
          </span>
          <span>Total cost</span>
          <span>{formatCost(task.total_cost_usd) || '$0.00'}</span>
          <span>Runs</span>
          <span>{task.runs.length}</span>
          {task.current_attempt ? (
            <>
              <span>Branch</span>
              <span className="font-mono">{task.current_attempt.branch}</span>
              <span>Worktree</span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono">{task.current_attempt.worktree_path}</span>
                {task.current_attempt.status === 'active' ? (
                  <a
                    className="text-blue-600 hover:underline dark:text-blue-400"
                    href={`vscode://file/${task.current_attempt.worktree_path}`}
                  >
                    Open in VS Code
                  </a>
                ) : null}
              </span>
              <span>Attempt</span>
              <span>
                {task.current_attempt.status} · base {task.current_attempt.base_commit.slice(0, 8)}
              </span>
            </>
          ) : null}
          {task.source_url ? (
            <>
              <span>Issue</span>
              <a
                className="truncate text-blue-600 hover:underline dark:text-blue-400"
                href={task.source_url}
                target="_blank"
                rel="noreferrer"
              >
                {task.source_url}
              </a>
            </>
          ) : null}
          <span>Task id</span>
          <span className="font-mono">{task.id}</span>
        </div>
      </section>
    </div>
  );
}

function Actions({
  task,
  busy,
  activeRunId,
  run,
  transition,
  confirm,
  pending,
}: {
  task: TaskDetail;
  busy: boolean;
  activeRunId?: string;
  run: (fn: () => Promise<unknown>) => void;
  transition: (target: TaskDetail['column'], payload?: { action?: 'retry' }) => () => Promise<unknown>;
  confirm: (o: { title: string; body: string; danger?: boolean; confirmLabel?: string }) => Promise<boolean>;
  pending: boolean;
}) {
  const buttons: {
    label: string;
    variant?: 'primary' | 'danger' | 'secondary';
    onClick: () => void;
    title?: string;
  }[] = [];
  const { column, substate } = task;
  if (busy && activeRunId) {
    buttons.push({
      label: 'Cancel run',
      variant: 'danger',
      onClick: () => run(() => api.runs.cancel(activeRunId)),
    });
  }
  if (column === 'backlog' && !busy) {
    if (substate !== 'needs_answer' || task.skip_refinement) {
      buttons.push({
        label: task.skip_refinement ? 'Move to To do' : 'Refine → To do',
        variant: 'primary',
        onClick: () => run(transition('todo')),
      });
    }
    if (!task.skip_refinement) {
      buttons.push({
        label: 'Skip refinement',
        onClick: () =>
          run(async () => {
            await api.tasks.update(task.id, { skip_refinement: true });
            await transition('todo')();
          }),
      });
    }
  }
  if (column === 'todo')
    buttons.push({ label: '▶ Start', variant: 'primary', onClick: () => run(transition('doing')) });
  if (column === 'doing' && substate === 'error') {
    buttons.push({
      label: 'Retry (resume session)',
      variant: 'primary',
      onClick: () => run(transition('doing', { action: 'retry' })),
    });
  }
  if ((column === 'doing' && substate === 'error') || column === 'review') {
    buttons.push({
      label: 'Restart attempt',
      title: 'Discard worktree and start over with all feedback so far',
      onClick: async () => {
        if (
          await confirm({
            title: 'Restart attempt?',
            body: 'The current worktree and branch are discarded. A new attempt starts with the description, plan and all feedback so far.',
            danger: true,
            confirmLabel: 'Restart',
          })
        )
          run(() => api.tasks.restart(task.id));
      },
    });
    buttons.push({
      label: 'Discard attempt',
      variant: 'danger',
      onClick: async () => {
        if (
          await confirm({
            title: 'Discard attempt?',
            body: 'Worktree and branch are deleted; the task goes back to To do.',
            danger: true,
            confirmLabel: 'Discard',
          })
        )
          run(() => api.tasks.discard(task.id));
      },
    });
  }
  if (column === 'review') {
    buttons.unshift({ label: '✓ Merge → Done', variant: 'primary', onClick: () => run(transition('done')) });
  }
  if (column === 'done') {
    buttons.push({ label: 'Clone task', onClick: () => run(() => api.tasks.clone(task.id)) });
  }
  if (column !== 'done' && !busy) {
    buttons.push({
      label: 'Delete task',
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
    <section className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <h3 className="mb-2 font-medium">The agent needs answers before this task is ready</h3>
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
          disabled={!allFilled || submit.isPending}
          onClick={() => submit.mutate()}
        >
          Submit answers & continue refinement
        </Button>
      </div>
    </section>
  );
}
