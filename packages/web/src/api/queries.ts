import type { Task, TaskDetail } from '@agent-kanban/shared';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { api } from './client';

export const keys = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  executors: (id: string) => ['executors', id] as const,
  provider: (id: string) => ['provider', id] as const,
  integration: (id: string) => ['integration', id] as const,
  providerModules: ['providerModules'] as const,
  tasks: (projectId: string) => ['tasks', projectId] as const,
  task: (id: string) => ['task', id] as const,
  diff: (attemptId: string) => ['diff', attemptId] as const,
  runEvents: (runId: string) => ['runEvents', runId] as const,
};

export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: api.projects.list });
export const useProject = (id: string) =>
  useQuery({ queryKey: keys.project(id), queryFn: () => api.projects.get(id) });
export const useExecutors = (id: string) =>
  useQuery({ queryKey: keys.executors(id), queryFn: () => api.projects.executors(id), staleTime: 60_000 });
export const useProvider = (id: string) =>
  useQuery({ queryKey: keys.provider(id), queryFn: () => api.projects.provider(id), staleTime: 60_000 });
export const useIntegration = (id: string) =>
  useQuery({ queryKey: keys.integration(id), queryFn: () => api.projects.integration(id) });
export const useProviderModules = () =>
  useQuery({ queryKey: keys.providerModules, queryFn: api.providers, staleTime: Number.POSITIVE_INFINITY });
export const useTasks = (projectId: string) =>
  useQuery({ queryKey: keys.tasks(projectId), queryFn: () => api.projects.tasks(projectId) });
export const useTask = (id: string | null) =>
  useQuery({ queryKey: keys.task(id ?? ''), queryFn: () => api.tasks.get(id!), enabled: !!id });
export const useDiff = (attemptId: string | null) =>
  useQuery({
    queryKey: keys.diff(attemptId ?? ''),
    queryFn: () => api.attempts.diff(attemptId!),
    enabled: !!attemptId,
  });
export const useRunEvents = (runId: string | null) =>
  useQuery({
    queryKey: keys.runEvents(runId ?? ''),
    queryFn: () => api.runs.events(runId!),
    enabled: !!runId,
  });

/** Merge a task (from SSE or a mutation) into the list + detail caches. */
export function upsertTask(qc: QueryClient, task: Task) {
  qc.setQueryData<Task[]>(keys.tasks(task.project_id), (old) => {
    if (!old) return old;
    const idx = old.findIndex((t) => t.id === task.id);
    if (idx === -1) return [...old, task];
    const next = old.slice();
    next[idx] = task;
    return next;
  });
  qc.setQueryData<TaskDetail>(keys.task(task.id), (old) => (old ? { ...old, ...task } : old));
  // Runs/questions/comments/attempts hang off the detail endpoint; refetch it when the task is open.
  if (qc.getQueryData(keys.task(task.id))) void qc.invalidateQueries({ queryKey: keys.task(task.id) });
  if (task.current_attempt_id && task.column === 'review')
    void qc.invalidateQueries({ queryKey: keys.diff(task.current_attempt_id) });
}

export function removeTask(qc: QueryClient, projectId: string, taskId: string) {
  qc.setQueryData<Task[]>(keys.tasks(projectId), (old) => old?.filter((t) => t.id !== taskId));
  qc.removeQueries({ queryKey: keys.task(taskId) });
}
