import type { Comment, NormalizedEvent, Project, Run, TaskDetail } from '@agent-kanban/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  ImagePlus,
  Link2,
  Send,
  User,
  X,
} from 'lucide-react';
import {
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Markdown from 'react-markdown';
import { api } from '../../api/client';
import { keys, upsertTask, useRunEvents } from '../../api/queries';
import { formatClock, formatCost, formatDuration } from '../../lib/format';
import { isBusy } from '../../lib/state';
import { Button, inputClass } from '../ui';
import { useToast } from '../ui/Toast';

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const MAX_FILES = 6;

/** Images picked for the next message, with object URLs for previews. */
interface Pending {
  file: File;
  url: string;
}

/** A conversation view over runs + comments, with a composer that calls POST /tasks/:id/chat. */
export function ChatTab({ task, project }: { task: TaskDetail; project: Project }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = isBusy(task);
  const activeRun = task.runs.find((r) => r.status === 'running');

  const send = useMutation({
    mutationFn: ({ message, files }: { message: string; files: File[] }) =>
      api.tasks.chat(task.id, message, files),
    onSuccess: (t) => {
      upsertTask(qc, t);
      setDraft('');
      clearPending();
      void qc.invalidateQueries({ queryKey: keys.task(task.id) });
    },
    onError: (err) => toast.error(err, 'Cannot send'),
  });

  const addFiles = (files: Iterable<File>) => {
    const images = [...files].filter((f) => ACCEPT.split(',').includes(f.type));
    if (images.length === 0) return;
    setPending((old) => {
      const next = [...old, ...images.map((file) => ({ file, url: URL.createObjectURL(file) }))];
      if (next.length > MAX_FILES)
        toast.push({ kind: 'error', text: `At most ${MAX_FILES} images per message` });
      return next.slice(0, MAX_FILES);
    });
  };
  const clearPending = () =>
    setPending((old) => {
      for (const p of old) URL.revokeObjectURL(p.url);
      return [];
    });
  const removePending = (url: string) =>
    setPending((old) => {
      URL.revokeObjectURL(url);
      return old.filter((p) => p.url !== url);
    });
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const timeline = useMemo(() => buildTimeline(task), [task]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the timeline changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [timeline.length, activeRun?.id]);

  const state = composerState(task, project);
  const canSend = !state.disabled && (draft.trim().length > 0 || pending.length > 0);
  const submit = () => {
    if (!canSend) return;
    send.mutate({ message: draft.trim(), files: pending.map((p) => p.file) });
  };
  const attemptId = task.current_attempt?.status === 'active' ? task.current_attempt.id : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {timeline.length === 0 ? (
          <div className="mx-auto max-w-md py-10 text-center text-sm text-zinc-500">
            <Bot size={28} className="mx-auto mb-2 text-zinc-400" />
            No conversation yet. Ask the planner about the task, or start it and come back with feedback. You
            can paste or drop screenshots.
          </div>
        ) : null}
        <div className="grid gap-3">
          {timeline.map((item) => (
            <TimelineItem key={item.key} item={item} attemptId={attemptId} />
          ))}
          {activeRun ? <LiveAssistant run={activeRun} attemptId={attemptId} /> : null}
        </div>
        <div ref={bottomRef} />
      </div>

      <div
        className={`border-zinc-200 border-t bg-white p-3 transition dark:border-zinc-800 dark:bg-zinc-900 ${dragging ? 'ring-2 ring-accent-400 ring-inset' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!state.disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-zinc-500">
          <span>{state.hint}</span>
          <span className="hidden sm:inline">
            <kbd className="rounded border border-zinc-300 px-1 dark:border-zinc-600">Ctrl</kbd> +{' '}
            <kbd className="rounded border border-zinc-300 px-1 dark:border-zinc-600">Enter</kbd> to send ·
            paste or drop images
          </span>
        </div>
        {pending.length ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((p) => (
              <div
                key={p.url}
                className="group relative h-16 w-16 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700"
              >
                <img src={p.url} alt={p.file.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label={`Remove ${p.file.name}`}
                  onClick={() => removePending(p.url)}
                  className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <button
            type="button"
            title="Attach images (png, jpeg, gif, webp)"
            aria-label="Attach images"
            disabled={state.disabled}
            onClick={() => fileInput.current?.click()}
            className="flex h-[60px] w-10 shrink-0 items-center justify-center rounded-md border border-zinc-300 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
          >
            <ImagePlus size={18} />
          </button>
          <textarea
            className={`${inputClass} min-h-[60px] max-h-48 flex-1 resize-y`}
            placeholder={state.placeholder}
            value={draft}
            disabled={state.disabled}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit();
            }}
          />
          <Button
            variant="primary"
            className="h-[60px] px-4"
            disabled={!canSend}
            loading={send.isPending}
            onClick={submit}
            icon={<Send size={14} />}
          >
            {state.action}
          </Button>
        </div>
        {busy && task.unconsumed_feedback ? (
          <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            {task.unconsumed_feedback} message{task.unconsumed_feedback === 1 ? '' : 's'} queued for the next
            run.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function composerState(
  task: TaskDetail,
  project: Project,
): { disabled: boolean; hint: string; placeholder: string; action: string } {
  const busy = isBusy(task);
  if (task.column === 'done')
    return {
      disabled: true,
      hint: 'Task is done and immutable.',
      placeholder: 'Clone the task to continue the conversation.',
      action: 'Send',
    };
  if (task.column === 'doing' && busy)
    return {
      disabled: false,
      hint: 'Agent is working. Your message is queued and sent as soon as this run finishes.',
      placeholder: 'e.g. "When you are done, also add a changelog entry"',
      action: 'Queue',
    };
  if (busy)
    return {
      disabled: true,
      hint: 'The planner is answering…',
      placeholder: 'Wait for the current run to finish.',
      action: 'Send',
    };
  if (task.column === 'review')
    return {
      disabled: false,
      hint: 'Message goes to the agent as feedback; it resumes the same session in the worktree and the task returns to Review.',
      placeholder: 'e.g. "Also handle the empty-list case and add a test for it"',
      action: 'Send & re-run',
    };
  if (task.column === 'doing' && task.substate === 'error')
    return {
      disabled: false,
      hint: 'Message is sent together with a retry of the failed run (same session).',
      placeholder: 'e.g. "The build fails because X; use Y instead"',
      action: 'Send & retry',
    };
  const planner = project.refinement_enabled || task.refinement_session_id;
  return {
    disabled: false,
    hint: planner
      ? 'Chat with the planner (read-only). It answers here and can update the plan; the task stays where it is.'
      : 'Chat with the agent about this task (read-only, no files are changed).',
    placeholder: 'e.g. "Which files would you touch? Prefer the existing utils module."',
    action: 'Ask',
  };
}

// ---- markdown with images ---------------------------------------------------

/**
 * Markdown renderer for agent replies. Relative image paths (or absolute paths
 * inside the worktree) are rewritten to the worktree image endpoint so screenshots
 * produced by the agent show up inline.
 */
function AgentMarkdown({ text, attemptId }: { text: string; attemptId: string | null }) {
  return (
    <Markdown
      components={{
        img: ({ src, alt }) => {
          const resolved = resolveImageSrc(typeof src === 'string' ? src : '', attemptId);
          if (!resolved) return <span className="text-zinc-400">[image: {alt || src}]</span>;
          return (
            <a href={resolved} target="_blank" rel="noreferrer">
              <img
                src={resolved}
                alt={alt ?? ''}
                className="my-1 max-h-72 rounded-md border border-zinc-200 dark:border-zinc-700"
              />
            </a>
          );
        },
      }}
    >
      {text}
    </Markdown>
  );
}

function resolveImageSrc(src: string, attemptId: string | null): string | null {
  if (!src) return null;
  if (/^(https?:|data:|blob:)/i.test(src) || src.startsWith('/api/')) return src;
  if (!attemptId) return null;
  // strip a leading "./" or the absolute worktree prefix (…/worktrees/<project>/<attempt>/)
  const rel = src.replace(/^\.\//, '').replace(/^.*\/worktrees\/[^/]+\/[^/]+\//, '');
  return `/api/attempts/${attemptId}/file?path=${encodeURIComponent(rel)}`;
}

// ---- timeline ---------------------------------------------------------------

type Item =
  | { key: string; kind: 'user'; comments: Comment[]; at: string }
  | { key: string; kind: 'tracker'; comment: Comment; at: string }
  | { key: string; kind: 'system'; text: ReactNode; detail?: string; at: string }
  | { key: string; kind: 'assistant'; run: Run; body: string | null; extra?: ReactNode; at: string };

function buildTimeline(task: TaskDetail): Item[] {
  const items: Item[] = [];
  const consumedBy = new Map<string, Comment[]>();
  for (const c of task.comments) {
    if (c.consumed_by_run_id)
      consumedBy.set(c.consumed_by_run_id, [...(consumedBy.get(c.consumed_by_run_id) ?? []), c]);
  }
  const questionsByRun = new Map<string, TaskDetail['questions']>();
  for (const q of task.questions) questionsByRun.set(q.run_id, [...(questionsByRun.get(q.run_id) ?? []), q]);

  for (const run of task.runs) {
    const comments = consumedBy.get(run.id) ?? [];
    if (comments.length) items.push({ key: `u-${run.id}`, kind: 'user', comments, at: run.created_at });
    else
      items.push({
        key: `s-${run.id}`,
        kind: 'system',
        text: describeRunStart(run),
        detail: run.prompt,
        at: run.created_at,
      });

    if (run.status === 'queued' || run.status === 'running') continue;
    const so = (run.structured_output ?? null) as Record<string, unknown> | null;
    let body: string | null = run.result_text;
    let extra: ReactNode;
    if (run.kind === 'chat' && so && typeof so.reply === 'string') {
      body = so.reply;
      if (typeof so.plan === 'string' && so.plan.trim())
        extra = <Collapsed label="Updated plan" text={so.plan} />;
    } else if (run.kind === 'refine' && so) {
      const qs = questionsByRun.get(run.id) ?? [];
      const plan = typeof so.plan === 'string' ? so.plan : '';
      body = so.ready
        ? `Plan is ready.${plan ? `\n\n${plan}` : ''}`
        : qs.length
          ? 'I need a few answers before this is ready:'
          : plan;
      if (qs.length) {
        extra = (
          <ol className="mt-2 grid list-decimal gap-1 pl-5">
            {qs.map((q) => (
              <li key={q.id}>{q.question}</li>
            ))}
          </ol>
        );
      }
    }
    items.push({
      key: `a-${run.id}`,
      kind: 'assistant',
      run,
      body,
      extra,
      at: run.finished_at ?? run.created_at,
    });

    const answered = (questionsByRun.get(run.id) ?? []).filter((q) => q.answer);
    if (answered.length) {
      items.push({
        key: `ans-${run.id}`,
        kind: 'user',
        at: answered[0]?.answered_at ?? run.finished_at ?? run.created_at,
        comments: answered.map((q) => ({
          id: q.id,
          task_id: task.id,
          attempt_id: null,
          kind: 'answer',
          body: `**${q.question}**\n${q.answer}`,
          file_path: null,
          line: null,
          consumed_by_run_id: null,
          created_at: q.answered_at ?? '',
          attachments: [],
        })),
      });
    }
  }
  // unconsumed comments (pending feedback) go last
  const pending = task.comments.filter(
    (c) => !c.consumed_by_run_id && (c.kind === 'feedback' || c.kind === 'chat'),
  );
  if (pending.length)
    items.push({ key: 'pending', kind: 'user', comments: pending, at: pending[0]?.created_at ?? '' });
  // comments pulled from the issue tracker slot in by time (pending feedback stays last)
  for (const c of task.comments.filter((c) => c.kind === 'tracker')) {
    const item: Item = { key: `tr-${c.id}`, kind: 'tracker', comment: c, at: c.created_at };
    const idx = items.findIndex((x) => x.key !== 'pending' && x.at > c.created_at);
    const pendingIdx = items.findIndex((x) => x.key === 'pending');
    const at = idx === -1 ? (pendingIdx === -1 ? items.length : pendingIdx) : idx;
    items.splice(at, 0, item);
  }
  return items;
}

function describeRunStart(run: Run): string {
  switch (run.kind) {
    case 'refine':
      return run.resumed_from_session_id ? 'Refinement resumed with your answers' : 'Refinement requested';
    case 'execute':
      return run.fallback_of_run_id
        ? 'Session lost — restarted with a fresh session'
        : 'Attempt started with the description and plan';
    case 'followup':
      return run.fallback_of_run_id
        ? 'Session lost — feedback re-sent with the current diff'
        : 'Retry requested';
    case 'chat':
      return 'Message sent';
  }
}

/** Thumbnails of a comment's image attachments; click opens the full image. */
function AttachmentStrip({ attachments }: { attachments: Comment['attachments'] }) {
  if (!attachments.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {attachments.map((a) => (
        <a
          key={a.id}
          href={`/api/attachments/${a.id}`}
          target="_blank"
          rel="noreferrer"
          title={`${a.name} · ${Math.round(a.size / 1024)} KB`}
        >
          <img
            src={`/api/attachments/${a.id}`}
            alt={a.name}
            className="h-24 max-w-48 rounded-md border border-white/30 object-cover"
          />
        </a>
      ))}
    </div>
  );
}

function TimelineItem({ item, attemptId }: { item: Item; attemptId: string | null }) {
  if (item.kind === 'tracker') {
    const c = item.comment;
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-sky-200 bg-sky-50 px-3.5 py-2 text-[13px] text-zinc-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-zinc-100">
          <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-sky-700 dark:text-sky-300">
            <Link2 size={11} />
            <span className="font-medium">{c.author ?? 'tracker'}</span>
            <span className="opacity-70">· from the issue tracker · {formatClock(c.created_at)}</span>
          </div>
          <div className="md">
            <Markdown>{c.body}</Markdown>
          </div>
        </div>
      </div>
    );
  }
  if (item.kind === 'system') {
    return (
      <div className="flex justify-center">
        <details className="group max-w-[85%] text-center text-[11px] text-zinc-500">
          <summary className="cursor-pointer list-none rounded-full bg-zinc-200/70 px-3 py-1 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700">
            {item.text} · {formatClock(item.at)} <span className="opacity-60">(prompt)</span>
          </summary>
          {item.detail ? (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-100 p-2 text-left font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {item.detail}
            </pre>
          ) : null}
        </details>
      </div>
    );
  }
  if (item.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%]">
          {item.comments.map((c) => (
            <div
              key={c.id}
              className="mb-1 rounded-2xl rounded-br-md bg-accent-600 px-3.5 py-2 text-[13px] text-white shadow-sm"
            >
              {c.file_path ? (
                <div className="mb-0.5 font-mono text-[10px] text-accent-100">
                  {c.file_path}
                  {c.line ? `:${c.line}` : ''}
                </div>
              ) : null}
              <div className="md [&_a]:text-white [&_code]:bg-white/20">
                <Markdown>{c.body}</Markdown>
              </div>
              <AttachmentStrip attachments={c.attachments} />
            </div>
          ))}
          <div className="flex items-center justify-end gap-1 text-[10px] text-zinc-400">
            <User size={10} /> you · {formatClock(item.at)}
            {item.key === 'pending' ? (
              <span className="text-amber-600 dark:text-amber-300"> · queued, not sent yet</span>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
  const { run } = item;
  const failed = run.status === 'failed' || run.status === 'cancelled';
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%]">
        <div
          className={`rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-[13px] shadow-sm ${failed ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40' : 'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800'}`}
        >
          {failed ? (
            <div className="mb-1 font-medium text-red-700 text-xs dark:text-red-300">
              Run {run.status}
              {run.error_message ? `: ${run.error_message}` : ''}
            </div>
          ) : null}
          {item.body ? (
            <div className="md leading-relaxed">
              <AgentMarkdown text={item.body} attemptId={attemptId} />
            </div>
          ) : !failed ? (
            <span className="text-zinc-400 italic">(no summary returned)</span>
          ) : null}
          {item.extra}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-zinc-400">
          <Bot size={10} /> agent · {run.kind} · {formatClock(item.at)}
          {run.cost_usd != null ? ` · ${formatCost(run.cost_usd)}` : ''}
          {run.started_at ? ` · ${formatDuration(run.started_at, run.finished_at)}` : ''}
        </div>
      </div>
    </div>
  );
}

function Collapsed({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50/60 text-xs dark:border-violet-900 dark:bg-violet-950/30">
      <button
        type="button"
        className="flex w-full items-center gap-1 px-2 py-1.5 font-medium text-violet-800 dark:text-violet-200"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {label}
      </button>
      {open ? (
        <div className="md border-violet-200 border-t px-3 py-2 dark:border-violet-900">
          <Markdown>{text}</Markdown>
        </div>
      ) : null}
    </div>
  );
}

/** Streams the running agent's latest text into the conversation. */
function LiveAssistant({ run, attemptId }: { run: Run; attemptId: string | null }) {
  const events = useRunEvents(run.id);
  const texts = (events.data ?? [])
    .map((e) => e.payload as NormalizedEvent)
    .filter((p): p is Extract<NormalizedEvent, { type: 'assistant_text' }> => p.type === 'assistant_text');
  const tools = (events.data ?? []).filter((e) => (e.payload as NormalizedEvent).type === 'tool_use').length;
  const last = texts.at(-1);
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%]">
        <div className="rounded-2xl rounded-bl-md border border-accent-200 bg-white px-3.5 py-2.5 text-[13px] shadow-sm dark:border-accent-900 dark:bg-zinc-800">
          {last ? (
            <div className="md leading-relaxed">
              <AgentMarkdown text={last.text} attemptId={attemptId} />
            </div>
          ) : null}
          <div className="ak-typing mt-1 flex items-center gap-1 text-accent-600 dark:text-accent-300">
            <span>●</span>
            <span>●</span>
            <span>●</span>
            <span className="ml-2 text-[11px] text-zinc-500">
              {tools ? `${tools} tool calls so far` : 'thinking…'}
            </span>
          </div>
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-zinc-400">
          <CornerDownLeft size={10} /> live · {run.kind} · {formatDuration(run.started_at, null)}
        </div>
      </div>
    </div>
  );
}
