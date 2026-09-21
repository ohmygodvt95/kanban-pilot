import type {
  Attempt,
  BulkPushInput,
  Comment,
  CreateCommentInput,
  CreateMeta,
  CreateProjectInput,
  CreateTaskInput,
  DiffResult,
  DiskUsage,
  ExecutorStatus,
  ExternalIssue,
  Health,
  Integration,
  IntegrationInput,
  Project,
  ProjectCosts,
  ProviderModuleInfo,
  ProviderStatus,
  PushTaskInput,
  RemoteUser,
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
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    // JSON bodies are strings; FormData must keep its own multipart content-type (with boundary).
    headers: {
      ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
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

import { getToken, UNAUTHORIZED_EVENT } from '../lib/auth';

export const api = {
  /** Tracker modules and their configuration fields. */
  providers: () => request<ProviderModuleInfo[]>('/providers'),
  health: () => request<Health>('/health'),
  auth: {
    /** Password → session token; 401 carries `details.remaining` / `details.locked`. */
    login: (password: string) => request<{ token: string }>('/auth/login', json({ password })),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
  },
  backup: {
    /** Whole database as a JSON document (downloaded by the caller). */
    export: (events: boolean) => request<unknown>(`/backup?events=${events ? 1 : 0}`),
    import: (doc: unknown) => request<Record<string, number>>('/backup', json(doc)),
  },
  projects: {
    list: () => request<Project[]>('/projects'),
    get: (id: string) => request<Project>(`/projects/${id}`),
    create: (input: CreateProjectInput) => request<Project>('/projects', json(input)),
    update: (id: string, input: UpdateProjectInput) =>
      request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    delete: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
    executors: (id: string) => request<ExecutorStatus[]>(`/projects/${id}/executors`),
    /** Issue provider detected from the origin remote, or null. */
    provider: (id: string) => request<ProviderStatus | null>(`/projects/${id}/provider`),
    issues: (id: string, query?: string) =>
      request<ExternalIssue[]>(`/projects/${id}/issues${query ? `?query=${encodeURIComponent(query)}` : ''}`),
    importIssues: (id: string, externalIds: string[]) =>
      request<Task[]>(`/projects/${id}/import-issues`, json({ external_ids: externalIds })),
    /** One tracker connection per project (see IntegrationPage). */
    integration: (id: string) => request<Integration | null>(`/projects/${id}/integration`),
    integrationSuggest: (id: string) =>
      request<{ provider: string; base_url: string | null; project_ref: string } | null>(
        `/projects/${id}/integration/suggest`,
      ),
    saveIntegration: (id: string, input: IntegrationInput) =>
      request<Integration>(`/projects/${id}/integration`, { method: 'PUT', body: JSON.stringify(input) }),
    deleteIntegration: (id: string) => request<void>(`/projects/${id}/integration`, { method: 'DELETE' }),
    testIntegration: (id: string, input: IntegrationInput) =>
      request<{ ok: boolean; message?: string }>(`/projects/${id}/integration/test`, json(input)),
    integrationStatuses: (id: string) => request<string[]>(`/projects/${id}/integration/statuses`),
    createMeta: (id: string) => request<CreateMeta>(`/projects/${id}/integration/create-meta`),
    searchUsers: (id: string, q: string) =>
      request<RemoteUser[]>(`/projects/${id}/integration/users?q=${encodeURIComponent(q)}`),
    costs: (id: string, days = 14) => request<ProjectCosts>(`/projects/${id}/costs?days=${days}`),
    disk: (id: string) => request<DiskUsage>(`/projects/${id}/disk`),
    cleanDisk: (id: string) =>
      request<{ freed_bytes: number; removed: number }>(`/projects/${id}/disk/clean`, { method: 'POST' }),
    /** Undo a bulk clear with the ids it returned. */
    restoreTasks: (id: string, ids: string[]) =>
      request<Task[]>(`/projects/${id}/tasks/restore`, json({ ids })),
    /** Push several unlinked tasks with shared field values (409 CONFIRM_REQUIRED lists missing fields). */
    pushTasks: (id: string, input: BulkPushInput) =>
      request<{ pushed: Task[]; failed: { id: string; error: string }[] }>(
        `/projects/${id}/tasks/push`,
        json(input),
      ),
    fetchIssues: (id: string) =>
      request<{ imported: number }>(`/projects/${id}/integration/fetch`, { method: 'POST' }),
    tasks: (id: string) => request<Task[]>(`/projects/${id}/tasks`),
    /** Delete every task of the project; `force` also cancels running agents. */
    deleteAllTasks: (id: string, force: boolean) =>
      request<{ deleted: number; skipped: number; ids: string[] }>(
        `/projects/${id}/tasks${force ? '?force=1' : ''}`,
        {
          method: 'DELETE',
        },
      ),
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
    /** Send a chat message, optionally with image files (multipart). */
    chat: (id: string, message: string, files: File[] = []) => {
      if (files.length === 0) return request<Task>(`/tasks/${id}/chat`, json({ message }));
      const form = new FormData();
      form.set('message', message);
      for (const f of files) form.append('files', f, f.name);
      return request<Task>(`/tasks/${id}/chat`, { method: 'POST', body: form });
    },
    answer: (id: string, qid: string, answer: string) =>
      request<Task>(`/tasks/${id}/questions/${qid}/answer`, json({ answer })),
    restart: (id: string) => request<Task>(`/tasks/${id}/attempts/restart`, { method: 'POST' }),
    /** Merge the base branch into the attempt; conflicts go to the agent. */
    updateBase: (id: string) =>
      request<{ task: Task; conflicts: string[] }>(`/tasks/${id}/attempts/update-base`, { method: 'POST' }),
    runTests: (id: string) => request<{ ok: true }>(`/tasks/${id}/tests/run`, { method: 'POST' }),
    /** Create the task on the linked tracker (409 CONFIRM_REQUIRED → missing fields in error.details). */
    push: (id: string, input: PushTaskInput) => request<Task>(`/tasks/${id}/push`, json(input)),
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
