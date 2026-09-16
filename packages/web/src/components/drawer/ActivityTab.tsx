import type { NormalizedEvent, Run, RunEvent, TaskDetail } from '@agent-kanban/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { useRunEvents } from '../../api/queries';
import { formatCost, formatDuration, formatTime, short } from '../../lib/format';
import { Spinner } from '../ui';

const RUN_STATUS_STYLE: Record<Run['status'], string> = {
  queued: 'text-zinc-500',
  running: 'text-blue-600',
  succeeded: 'text-emerald-600',
  failed: 'text-red-600',
  cancelled: 'text-amber-600',
};

export function ActivityTab({ task }: { task: TaskDetail }) {
  const runs = useMemo(() => [...task.runs].reverse(), [task.runs]);
  const latest = runs[0];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find((r) => r.id === selectedId) ?? latest ?? null;
  const events = useRunEvents(selected?.id ?? null);
  const [showRaw, setShowRaw] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow && bottomRef.current) bottomRef.current.scrollIntoView({ block: 'end' });
  }, [follow]);

  if (!latest)
    return (
      <div className="p-4 text-sm text-zinc-500">
        No runs yet. Move the task to To do (refinement) or Doing to start one.
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-zinc-200 border-b px-3 py-2 text-xs dark:border-zinc-800">
        <select
          className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-600"
          value={selected?.id ?? ''}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.kind} · {r.status} · {formatTime(r.created_at)} · #{short(r.id)}
            </option>
          ))}
        </select>
        {selected ? (
          <span className={`flex items-center gap-1 ${RUN_STATUS_STYLE[selected.status]}`}>
            {selected.status === 'running' ? <Spinner size={11} /> : null}
            {selected.status}
            {selected.cost_usd != null ? ` · ${formatCost(selected.cost_usd)}` : ''}
            {selected.num_turns != null ? ` · ${selected.num_turns} turns` : ''}
            {selected.started_at ? ` · ${formatDuration(selected.started_at, selected.finished_at)}` : ''}
          </span>
        ) : null}
        <span className="flex-1" />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} /> raw
        </label>
      </div>
      {selected ? (
        <div
          className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-2"
          onScroll={(e) => {
            const el = e.currentTarget;
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
        >
          <RunMeta run={selected} />
          {events.isLoading ? <div className="text-xs text-zinc-500">Loading events…</div> : null}
          <div className="grid gap-1.5">
            {events.data?.map((ev) => (
              <EventRow key={ev.id} event={ev} showRaw={showRaw} />
            ))}
          </div>
          {selected.status === 'running' ? (
            <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
              <Spinner size={12} /> agent is working…
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      ) : null}
    </div>
  );
}

function RunMeta({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 rounded-lg border border-zinc-200 bg-white p-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300">
      <button
        type="button"
        className="flex w-full items-center justify-between"
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          {run.kind} run · session {run.session_id ? short(run.session_id, 8) : '—'}
          {run.resumed_from_session_id ? ` (resumed ${short(run.resumed_from_session_id, 8)})` : ''}
          {run.exit_code != null ? ` · exit ${run.exit_code}` : ''}
          {run.result_subtype ? ` · ${run.result_subtype}` : ''}
        </span>
        <span>{open ? '▾' : '▸'} prompt & command</span>
      </button>
      {run.error_message ? (
        <div className="mt-1 whitespace-pre-wrap text-red-600 dark:text-red-400">{run.error_message}</div>
      ) : null}
      {open ? (
        <div className="mt-2 grid gap-2">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono dark:bg-zinc-900">
            {run.command ?? '(not started)'}
          </pre>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono dark:bg-zinc-900">
            {run.prompt}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function EventRow({ event, showRaw }: { event: RunEvent; showRaw: boolean }) {
  const p = event.payload as NormalizedEvent;
  if (event.type === 'stderr') {
    return (
      <pre className="whitespace-pre-wrap font-mono text-[11px] text-red-600 dark:text-red-400">
        {(p as { text: string }).text}
      </pre>
    );
  }
  switch (p.type) {
    case 'init':
      return <div className="text-[11px] text-zinc-400">session {p.sessionId}</div>;
    case 'assistant_text':
      return (
        <div className="md rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] dark:border-zinc-700 dark:bg-zinc-800">
          <Markdown>{p.text}</Markdown>
        </div>
      );
    case 'tool_use':
      return <ToolUse name={p.name} input={p.input} />;
    case 'tool_result':
      return <Collapsible label="tool result" body={extractToolResult(p.raw)} muted />;
    case 'result':
      return (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${p.ok ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30' : 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30'}`}
        >
          <div className="font-medium">
            {p.ok ? '✓' : '✗'} {p.subtype}
            {p.costUsd != null ? ` · ${formatCost(p.costUsd)}` : ''}
            {p.numTurns != null ? ` · ${p.numTurns} turns` : ''}
          </div>
          {p.structuredOutput !== undefined ? (
            <pre className="mt-1 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
              {JSON.stringify(p.structuredOutput, null, 2)}
            </pre>
          ) : null}
        </div>
      );
    default:
      if (!showRaw) return null;
      return (
        <Collapsible label={`raw · ${describeRaw(p.raw)}`} body={JSON.stringify(p.raw, null, 2)} muted />
      );
  }
}

function describeRaw(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const r = raw as { type?: string; subtype?: string };
    return [r.type, r.subtype].filter(Boolean).join('/') || 'object';
  }
  return typeof raw === 'string' ? raw.slice(0, 60) : 'value';
}

function extractToolResult(raw: unknown): string {
  try {
    const msg = (raw as { message?: { content?: unknown } }).message?.content;
    if (Array.isArray(msg)) {
      return msg
        .map((b) => {
          const block = b as { type?: string; content?: unknown };
          if (block.type === 'tool_result') {
            if (typeof block.content === 'string') return block.content;
            if (Array.isArray(block.content))
              return block.content.map((c) => (c as { text?: string }).text ?? '').join('\n');
          }
          return '';
        })
        .join('\n')
        .trim();
    }
  } catch {
    /* fall through */
  }
  return JSON.stringify(raw, null, 2);
}

function ToolUse({ name, input }: { name: string; input: unknown }) {
  const summary = summarizeToolInput(name, input);
  return (
    <Collapsible
      label={`🔧 ${name}${summary ? ` — ${summary}` : ''}`}
      body={JSON.stringify(input, null, 2)}
    />
  );
}

function summarizeToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  if (name === 'Bash') return s(i.command).slice(0, 120);
  if (i.file_path) return s(i.file_path);
  if (i.pattern) return s(i.pattern);
  if (i.description) return s(i.description);
  return '';
}

function Collapsible({ label, body, muted }: { label: string; body: string; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`rounded-md border text-xs ${muted ? 'border-zinc-200 text-zinc-500 dark:border-zinc-800' : 'border-zinc-300 dark:border-zinc-700'}`}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1 text-left font-mono"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-zinc-400">{open ? '▾' : '▸'}</span>
        <span className="truncate">{label}</span>
      </button>
      {open ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-zinc-200 border-t px-2 py-1 font-mono text-[11px] dark:border-zinc-800">
          {body || '(empty)'}
        </pre>
      ) : null}
    </div>
  );
}
