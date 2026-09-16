import type { Comment, DiffFile as DiffFileMeta, TaskDetail } from '@agent-kanban/shared';
import { DiffModeEnum, DiffView } from '@git-diff-view/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { keys, upsertTask, useDiff } from '../../api/queries';
import { Button, inputClass } from '../ui';
import { useToast } from '../ui/Toast';

interface FilePatch {
  path: string;
  oldPath: string;
  hunks: string;
  binary: boolean;
}

/** Split a combined `git diff` into per-file sections. */
export function splitPatch(patch: string): FilePatch[] {
  const out: FilePatch[] = [];
  const sections = patch.split(/^(?=diff --git )/m).filter((s) => s.trim());
  for (const section of sections) {
    const header = section.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    if (!header) continue;
    const oldPath = header[1] ?? '';
    const path = header[2] ?? oldPath;
    const binary = /^Binary files/m.test(section) || section.includes('GIT binary patch');
    // @git-diff-view needs the ---/+++ header together with the @@ hunks; pass the whole section.
    out.push({ path, oldPath, hunks: section.includes('\n@@') ? section : '', binary });
  }
  return out;
}

const useDark = () => {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return dark;
};

export function DiffTab({ task }: { task: TaskDetail }) {
  const attempt = task.current_attempt;
  // Active attempts diff the worktree; merged ones diff base..branch (worktree is gone but the branch stays).
  const viewable = attempt && attempt.status !== 'discarded' ? attempt : null;
  const active = attempt?.status === 'active' ? attempt : null;
  const diff = useDiff(viewable?.id ?? null);
  const [split, setSplit] = useState<boolean>(() => localStorage.getItem('ak.diff.split') === '1');
  const _toggleSplit = () => {
    localStorage.setItem('ak.diff.split', split ? '0' : '1');
    setSplit(!split);
  };
  const files = useMemo(() => (diff.data ? splitPatch(diff.data.patch) : []), [diff.data]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selected = files.find((f) => f.path === selectedPath) ?? files[0] ?? null;
  const dark = useDark();
  const qc = useQueryClient();
  const toast = useToast();
  const [general, setGeneral] = useState('');
  const feedback = task.comments.filter((c) => c.kind === 'feedback');
  const pending = feedback.filter((c) => !c.consumed_by_run_id);

  const refresh = () => void qc.invalidateQueries({ queryKey: keys.task(task.id) });
  const addComment = useMutation({
    mutationFn: (input: { body: string; file_path?: string | null; line?: number | null }) =>
      api.tasks.addComment(task.id, { kind: 'feedback', ...input }),
    onSuccess: refresh,
    onError: (err) => toast.error(err, 'Cannot add comment'),
  });
  const removeComment = useMutation({
    mutationFn: (id: string) => api.comments.delete(id),
    onSuccess: refresh,
    onError: (err) => toast.error(err, 'Cannot delete comment'),
  });
  const send = useMutation({
    mutationFn: async () => {
      if (general.trim()) {
        await api.tasks.addComment(task.id, { kind: 'feedback', body: general.trim() });
        setGeneral('');
      }
      return api.tasks.transition(task.id, { target: 'doing' });
    },
    onSuccess: (t) => {
      upsertTask(qc, t);
      refresh();
      toast.push({ kind: 'success', text: 'Feedback sent; the agent is resuming.' });
    },
    onError: (err) => {
      toast.error(err, 'Cannot send feedback');
      refresh();
    },
  });

  if (!attempt) return <div className="p-4 text-sm text-zinc-500">No attempt yet.</div>;
  if (!active)
    return (
      <div className="p-4 text-sm text-zinc-500">
        Attempt is {attempt.status}; the worktree no longer exists. Branch:{' '}
        <span className="font-mono">{attempt.branch}</span>
      </div>
    );

  const canSend = task.column === 'review' && (pending.length > 0 || general.trim().length > 0);
  const commentsForFile = selected ? feedback.filter((c) => c.file_path === selected.path && c.line) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <aside className="scrollbar-thin w-60 shrink-0 overflow-y-auto border-zinc-200 border-r bg-white text-xs dark:border-zinc-800 dark:bg-zinc-900">
          {diff.data ? (
            <div className="border-zinc-100 border-b px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800">
              {diff.data.files.length} files ·{' '}
              <span className="text-emerald-600">
                +{diff.data.files.reduce((s, f) => s + f.additions, 0)}
              </span>{' '}
              <span className="text-red-600">-{diff.data.files.reduce((s, f) => s + f.deletions, 0)}</span>
            </div>
          ) : null}
          {diff.isLoading ? <div className="p-3 text-zinc-500">Loading diff…</div> : null}
          {diff.isError ? <div className="p-3 text-red-600">{(diff.error as Error).message}</div> : null}
          {diff.data?.files.length === 0 ? <div className="p-3 text-zinc-500">No changes.</div> : null}
          {diff.data?.files.map((f) => (
            <FileRow
              key={f.path}
              file={f}
              selected={selected?.path === f.path}
              onClick={() => setSelectedPath(f.path)}
              commentCount={feedback.filter((c) => c.file_path === f.path).length}
            />
          ))}
        </aside>
        <div className="scrollbar-thin min-w-0 flex-1 overflow-auto bg-white dark:bg-zinc-900">
          {selected ? (
            selected.binary || !selected.hunks ? (
              <div className="p-4 text-sm text-zinc-500">
                {selected.binary ? 'Binary file' : 'No textual changes (mode change or empty file).'}
              </div>
            ) : (
              <DiffView<Comment[]>
                key={selected.path}
                data={{
                  oldFile: { fileName: selected.oldPath },
                  newFile: { fileName: selected.path },
                  hunks: [selected.hunks],
                }}
                diffViewMode={split ? DiffModeEnum.Split : DiffModeEnum.Unified}
                diffViewTheme={dark ? 'dark' : 'light'}
                diffViewHighlight
                diffViewFontSize={12}
                diffViewAddWidget={!!active}
                onAddWidgetClick={() => {}}
                renderWidgetLine={({ lineNumber, onClose }) => (
                  <InlineCommentForm
                    onCancel={onClose}
                    onSubmit={(body) => {
                      addComment.mutate({ body, file_path: selected.path, line: lineNumber });
                      onClose();
                    }}
                  />
                )}
                extendData={{
                  newFile: Object.fromEntries(
                    groupByLine(commentsForFile).map(([line, cs]) => [String(line), { data: cs }]),
                  ),
                }}
                renderExtendLine={({ data }) => (
                  <div className="grid gap-1 bg-blue-50 px-3 py-2 dark:bg-blue-950/30">
                    {data.map((c) => (
                      <CommentLine key={c.id} comment={c} onDelete={() => removeComment.mutate(c.id)} />
                    ))}
                  </div>
                )}
              />
            )
          ) : null}
        </div>
      </div>
      <div className="border-zinc-200 border-t bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium">
            Feedback{' '}
            {pending.length ? (
              <span className="text-xs text-zinc-500">({pending.length} not yet sent)</span>
            ) : null}
          </h3>
          <Button
            variant="primary"
            size="sm"
            disabled={!canSend || send.isPending}
            onClick={() => send.mutate()}
            title={task.column !== 'review' ? 'Available while the task is in Review' : ''}
          >
            Send feedback & re-run
          </Button>
        </div>
        {feedback.length ? (
          <ul className="mb-2 grid max-h-40 gap-1 overflow-y-auto">
            {feedback.map((c) => (
              <li key={c.id}>
                <CommentLine
                  comment={c}
                  onDelete={c.consumed_by_run_id ? undefined : () => removeComment.mutate(c.id)}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          className={`${inputClass} min-h-16`}
          placeholder="General feedback for the agent (markdown). Click a line in the diff to comment on a specific line."
          value={general}
          onChange={(e) => setGeneral(e.target.value)}
        />
      </div>
    </div>
  );
}

function groupByLine(comments: Comment[]): [number, Comment[]][] {
  const map = new Map<number, Comment[]>();
  for (const c of comments) {
    if (!c.line) continue;
    map.set(c.line, [...(map.get(c.line) ?? []), c]);
  }
  return [...map.entries()];
}

function FileRow({
  file,
  selected,
  onClick,
  commentCount,
}: {
  file: DiffFileMeta;
  selected: boolean;
  onClick: () => void;
  commentCount: number;
}) {
  const color =
    file.status === 'added'
      ? 'text-emerald-600'
      : file.status === 'deleted'
        ? 'text-red-600'
        : file.status === 'renamed'
          ? 'text-violet-600'
          : 'text-zinc-500';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${selected ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
    >
      <span className={`w-3 font-mono ${color}`}>{file.status[0]?.toUpperCase()}</span>
      <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
        {file.path}
      </span>
      {commentCount ? <span className="text-blue-600">💬{commentCount}</span> : null}
      <span className="text-emerald-600">+{file.additions}</span>
      <span className="text-red-600">-{file.deletions}</span>
    </button>
  );
}

function InlineCommentForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState('');
  return (
    <div className="grid gap-2 bg-zinc-50 p-2 dark:bg-zinc-800">
      <textarea
        className={`${inputClass} min-h-14`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Feedback for this line…"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!body.trim()} onClick={() => onSubmit(body.trim())}>
          Add comment
        </Button>
      </div>
    </div>
  );
}

function CommentLine({ comment, onDelete }: { comment: Comment; onDelete?: () => void }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={`mt-0.5 ${comment.consumed_by_run_id ? 'text-zinc-400' : 'text-blue-600'}`}>
        {comment.consumed_by_run_id ? '✓' : '●'}
      </span>
      <span className="min-w-0 flex-1">
        {comment.file_path ? (
          <span className="mr-1 font-mono text-zinc-500">
            {comment.file_path}
            {comment.line ? `:${comment.line}` : ''}
          </span>
        ) : null}
        <span className="whitespace-pre-wrap">{comment.body}</span>
      </span>
      {onDelete ? (
        <button type="button" className="text-zinc-400 hover:text-red-600" onClick={onDelete} title="delete">
          ✕
        </button>
      ) : null}
    </div>
  );
}
