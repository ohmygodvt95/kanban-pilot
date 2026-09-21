import type { Attempt, Run, RunEvent, SseEvent, Task, TaskDetail } from '@agent-kanban/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../components/ui/Toast';
import { getToken } from '../lib/auth';
import { notify } from '../lib/notify';
import { keys, removeTask, upsertTask } from './queries';

export type LiveState = 'connecting' | 'open' | 'reconnecting';

/**
 * Subscribe to /api/events for a project and keep the TanStack Query caches in
 * sync. Returns the connection state for the header indicator.
 *
 * Transport: a WebSocket first — tunnels and proxies (Cloudflare quick tunnels buffer
 * chunked HTTP responses up to 256 KB) forward frames immediately. If the socket
 * closes before the server's `ready` message ever arrived, the hook falls back to
 * server-sent events for the rest of the page's life. Both carry the same JSON events.
 */
export function useProjectEvents(projectId: string, onOpenTask?: (id: string) => void): LiveState {
  const qc = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<LiveState>('connecting');
  // latest callback without making it an effect dependency (that would reconnect on every URL change)
  const openRef = useRef(onOpenTask);
  openRef.current = onOpenTask;

  useEffect(() => {
    const handlers = new Map<string, (data: unknown) => void>();
    const on = <T extends SseEvent['type']>(
      type: T,
      handler: (e: Extract<SseEvent, { type: T }>) => void,
    ) => {
      handlers.set(type, (data) => handler(data as Extract<SseEvent, { type: T }>));
    };
    let wasOpen = false;
    const ready = () => {
      setState('open');
      if (wasOpen) {
        // reconnect: caches may be stale
        void qc.invalidateQueries();
      }
      wasOpen = true;
    };
    const dispatch = (type: string, raw: unknown) => {
      if (type === 'ready') return ready();
      if (type === 'ping') return;
      const handler = handlers.get(type);
      if (!handler) return;
      try {
        handler(typeof raw === 'string' ? JSON.parse(raw) : raw);
      } catch (err) {
        console.error('bad live event payload', err);
      }
    };

    on('task.updated', (e) => {
      // Notify on milestones: entering Review, or an error while working.
      const prev = qc.getQueryData<Task[]>(keys.tasks(e.project_id))?.find((t) => t.id === e.task.id);
      if (prev && (prev.column !== e.task.column || prev.substate !== e.task.substate)) {
        if (e.task.column === 'review' && prev.column === 'doing')
          notify('Ready for review', e.task.title, e.task.id);
        else if (e.task.column === 'doing' && e.task.substate === 'error')
          notify('Agent run failed', `${e.task.title}\n${e.task.last_error ?? ''}`, e.task.id);
        else if (e.task.column === 'backlog' && e.task.substate === 'needs_answer')
          notify('The planner has questions', e.task.title, e.task.id);
        else if (e.task.column === 'done' && prev.column !== 'done')
          notify('Merged', e.task.title, e.task.id);
      }
      // auto-push (push_on_todo) could not create the issue: say so right away, with a shortcut to the task
      const pushError = e.task.last_error?.startsWith('push to tracker failed');
      if (pushError && prev?.last_error !== e.task.last_error) {
        toast.push({
          kind: 'error',
          text: `${e.task.title}: ${e.task.last_error}`,
          duration: 12_000,
          action: { label: 'Open task', onClick: () => openRef.current?.(e.task.id) },
        });
      }
      upsertTask(qc, e.task);
    });
    on('task.deleted', (e) => removeTask(qc, e.project_id, e.task_id));
    on('run.updated', (e) => {
      const run: Run = e.run;
      if (
        run.attempt_id &&
        (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled')
      ) {
        void qc.invalidateQueries({ queryKey: keys.diff(run.attempt_id) });
      }
      qc.setQueryData<TaskDetail>(keys.task(run.task_id), (old) => {
        if (!old) return old;
        const idx = old.runs.findIndex((r) => r.id === run.id);
        const runs = idx === -1 ? [...old.runs, run] : old.runs.map((r) => (r.id === run.id ? run : r));
        return { ...old, runs };
      });
    });
    on('attempt.updated', (e) => {
      const attempt: Attempt = e.attempt;
      qc.setQueryData<TaskDetail>(keys.task(attempt.task_id), (old) => {
        if (!old) return old;
        const attempts = old.attempts.some((a) => a.id === attempt.id)
          ? old.attempts.map((a) => (a.id === attempt.id ? attempt : a))
          : [...old.attempts, attempt];
        const current_attempt = old.current_attempt_id === attempt.id ? attempt : old.current_attempt;
        return { ...old, attempts, current_attempt };
      });
      void qc.invalidateQueries({ queryKey: keys.diff(attempt.id) });
    });
    on('run.event', (e) => {
      const ev: RunEvent = e.event;
      const key = keys.runEvents(e.run_id);
      const old = qc.getQueryData<RunEvent[]>(key);
      if (!old) return; // nobody is looking at this run yet; it will be fetched on demand
      const last = old.at(-1)?.seq ?? 0;
      if (ev.seq === last + 1) qc.setQueryData<RunEvent[]>(key, [...old, ev]);
      else if (ev.seq > last + 1) void qc.invalidateQueries({ queryKey: key });
    });
    on('job.failed', (e) => toast.push({ kind: 'error', text: `Job ${e.job.kind} failed: ${e.error}` }));

    // --- connection management -------------------------------------------------
    const token = getToken();
    const query = `project_id=${encodeURIComponent(projectId)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    let disposed = false;
    let useSse = false;
    let ws: WebSocket | null = null;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const connectSse = () => {
      es = new EventSource(`/api/events?${query}`);
      es.addEventListener('ready', () => dispatch('ready', null));
      for (const type of handlers.keys())
        es.addEventListener(type, (raw) => dispatch(type, (raw as MessageEvent).data));
      es.onerror = () => setState('reconnecting'); // EventSource reconnects by itself
    };
    const connectWs = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${proto}//${window.location.host}/api/events?${query}`);
      ws = socket;
      let gotReady = false;
      socket.onmessage = (m) => {
        try {
          const msg = JSON.parse(String(m.data)) as { type: string };
          if (msg.type === 'ready') {
            gotReady = true;
            attempt = 0;
          }
          dispatch(msg.type, msg);
        } catch (err) {
          console.error('bad live event payload', err);
        }
      };
      socket.onclose = () => {
        if (disposed || ws !== socket) return;
        ws = null;
        if (!gotReady && !wasOpen) {
          // never got through (proxy without WebSocket support, old server): use SSE from now on
          useSse = true;
          setState('connecting');
          connectSse();
          return;
        }
        setState('reconnecting');
        attempt++;
        retry = setTimeout(connect, Math.min(10_000, 1000 * 2 ** Math.min(attempt, 4)));
      };
    };
    const connect = () => (useSse ? connectSse() : connectWs());
    connect();

    return () => {
      disposed = true;
      clearTimeout(retry);
      ws?.close();
      es?.close();
    };
  }, [projectId, qc, toast]);

  return state;
}
