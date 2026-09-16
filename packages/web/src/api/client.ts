import type {
  Attempt,
  Comment,
  CreateCommentInput,
  CreateProjectInput,
  CreateTaskInput,
  DiffResult,
  ExecutorStatus,
  Project,
  Run,
  RunEvent,
  Task,
  TaskDetail,
  TransitionRequest,
  UpdateProjectInput,
  UpdateTaskInput,
} from '@agent-kanban/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | undefined)
      ?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `${res.status} ${res.statusText}`,
      err?.details,
    );
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  projects: {
    list: () => request<Project[]>('/projects'),
    get: (id: string) => request<Project>(`/projects/${id}`),
    create: (input: CreateProjectInput) => request<Project>('/projects', json(input)),
    update: (id: string, input: UpdateProjectInput) =>
      request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    delete: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
    executors: (id: string) => request<ExecutorStatus[]>(`/projects/${id}/executors`),
    tasks: (id: string) => request<Task[]>(`/projects/${id}/tasks`),
    createTask: (id: string, input: CreateTaskInput) => request<Task>(`/projects/${id}/tasks`, json(input)),
  },
  tasks: {
    get: (id: string) => request<TaskDetail>(`/tasks/${id}`),
    update: (id: string, input: UpdateTaskInput) =>
      request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    delete: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
    transition: (id: string, input: TransitionRequest) =>
      request<Task>(`/tasks/${id}/transition`, json(input)),
    clone: (id: string) => request<Task>(`/tasks/${id}/clone`, { method: 'POST' }),
    addComment: (id: string, input: CreateCommentInput) =>
      request<Comment>(`/tasks/${id}/comments`, json(input)),
    answer: (id: string, qid: string, answer: string) =>
      request<Task>(`/tasks/${id}/questions/${qid}/answer`, json({ answer })),
    restart: (id: string) => request<Task>(`/tasks/${id}/attempts/restart`, { method: 'POST' }),
    discard: (id: string) => request<Task>(`/tasks/${id}/attempts/discard`, { method: 'POST' }),
  },
  comments: { delete: (id: string) => request<void>(`/comments/${id}`, { method: 'DELETE' }) },
  attempts: {
    get: (id: string) => request<Attempt>(`/attempts/${id}`),
    diff: (id: string) => request<DiffResult>(`/attempts/${id}/diff`),
    tests: (id: string) => request<{ ok: boolean | null; output: string | null }>(`/attempts/${id}/tests`),
  },
  runs: {
    get: (id: string) => request<Run>(`/runs/${id}`),
    events: (id: string, after = 0) => request<RunEvent[]>(`/runs/${id}/events?after=${after}`),
    cancel: (id: string) => request<{ ok: true }>(`/runs/${id}/cancel`, { method: 'POST' }),
  },
};
