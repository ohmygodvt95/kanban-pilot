import type { Attempt, Run, RunEvent, SseEvent, TaskDetail } from '@agent-kanban/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useToast } from '../components/ui/Toast';
import { keys, removeTask, upsertTask } from './queries';

/**
 * Subscribe to /api/events for a project and keep the TanStack Query caches in
 * sync. Returns the connection state for the header indicator.
 */
export function useProjectEvents(projectId: string): 'connecting' | 'open' | 'reconnecting' {
  const qc = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<'connecting' | 'open' | 'reconnecting'>('connecting');

  useEffect(() => {
    const es = new EventSource(`/api/events?project_id=${encodeURIComponent(projectId)}`);
    let wasOpen = false;
    es.addEventListener('ready', () => {
      setState('open');
      if (wasOpen) {
        // reconnect: caches may be stale
        void qc.invalidateQueries();
      }
      wasOpen = true;
    });
    es.onerror = () => setState('reconnecting');

    const on = <T extends SseEvent['type']>(
      type: T,
      handler: (e: Extract<SseEvent, { type: T }>) => void,
    ) => {
      es.addEventListener(type, (raw) => {
        try {
          handler(JSON.parse((raw as MessageEvent).data) as Extract<SseEvent, { type: T }>);
        } catch (err) {
          console.error('bad SSE payload', err);
        }
      });
    };

    on('task.updated', (e) => upsertTask(qc, e.task));
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

    return () => es.close();
  }, [projectId, qc, toast]);

  return state;
}
