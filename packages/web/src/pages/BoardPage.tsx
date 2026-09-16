import type { Task } from '@agent-kanban/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { keys, upsertTask, useProject, useTasks } from '../api/queries';
import { useProjectEvents } from '../api/sse';
import { Board } from '../components/board/Board';
import { TaskDrawer } from '../components/drawer/TaskDrawer';
import { Button, Field, inputClass, Modal } from '../components/ui';
import { useToast } from '../components/ui/Toast';

export function BoardPage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const project = useProject(projectId);
  const tasks = useTasks(projectId);
  const sse = useProjectEvents(projectId);
  const [creating, setCreating] = useState(false);
  const selected = params.get('task');

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('task', id);
    else next.delete('task');
    setParams(next, { replace: true });
  };

  if (project.isError) return <div className="p-6 text-sm text-red-600">Project not found.</div>;
  if (!project.data) return <div className="p-6 text-sm text-zinc-500">Loading…</div>;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-zinc-200 border-b bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3 text-sm">
          <Link to="/" className="text-zinc-500 hover:underline">
            Projects
          </Link>
          <span className="text-zinc-400">/</span>
          <span className="font-semibold">{project.data.name}</span>
          <span className="hidden font-mono text-xs text-zinc-400 sm:inline">{project.data.repo_path}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span
            className={`flex items-center gap-1 ${sse === 'open' ? 'text-emerald-600' : 'text-amber-600'}`}
            title={`events: ${sse}`}
          >
            ● {sse === 'open' ? 'live' : sse}
          </span>
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            ＋ New task
          </Button>
          <Link to={`/p/${projectId}/settings`}>
            <Button size="sm">Settings</Button>
          </Link>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {tasks.data ? (
          <Board
            project={project.data}
            tasks={tasks.data}
            onOpen={open}
            onNewTask={() => setCreating(true)}
          />
        ) : (
          <div className="p-6 text-sm text-zinc-500">Loading tasks…</div>
        )}
      </div>
      {creating ? (
        <NewTaskModal
          projectId={projectId}
          onClose={() => setCreating(false)}
          onCreated={(t) => open(t.id)}
        />
      ) : null}
      {selected ? <TaskDrawer taskId={selected} project={project.data} onClose={() => open(null)} /> : null}
    </div>
  );
}

function NewTaskModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (t: Task) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [skip, setSkip] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      api.projects.createTask(projectId, { title: title.trim(), description, skip_refinement: skip }),
    onSuccess: (t) => {
      upsertTask(qc, t);
      void qc.invalidateQueries({ queryKey: keys.tasks(projectId) });
      onClose();
      onCreated(t);
    },
    onError: (err) => toast.error(err, 'Cannot create task'),
  });
  return (
    <Modal
      title="New task"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!title.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Title">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="Description (markdown, this is the prompt)">
          <textarea
            className={`${inputClass} min-h-40`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Skip refinement
          for this task
        </label>
      </div>
    </Modal>
  );
}
