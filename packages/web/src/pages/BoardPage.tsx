import type { Task } from '@agent-kanban/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { keys, upsertTask, useProject, useTasks } from '../api/queries';
import { useProjectEvents } from '../api/sse';
import { Board } from '../components/board/Board';
import { TaskDrawer } from '../components/drawer/TaskDrawer';
import { Shell } from '../components/Shell';
import { Button, Field, inputClass, Modal, Switch } from '../components/ui';
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

  const stats = tasks.data
    ? {
        running: tasks.data.filter((t) => t.column === 'doing' && t.substate === 'running').length,
        review: tasks.data.filter((t) => t.column === 'review').length,
        cost: tasks.data.reduce((s, t) => s + (t.total_cost_usd ?? 0), 0),
      }
    : null;

  return (
    <Shell
      projectId={projectId}
      live={sse}
      right={
        <>
          {stats ? (
            <span className="hidden gap-3 text-[11px] text-zinc-500 md:flex">
              <span>{stats.running} running</span>
              <span>{stats.review} in review</span>
              <span>${stats.cost.toFixed(2)} spent</span>
            </span>
          ) : null}
          <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            New task
          </Button>
        </>
      }
    >
      {project.isError ? <div className="p-6 text-sm text-red-600">Project not found.</div> : null}
      {project.data && tasks.data ? (
        <Board
          project={project.data}
          tasks={tasks.data}
          onOpen={open}
          onNewTask={() => setCreating(true)}
          selectedId={selected}
        />
      ) : (
        <div className="p-6 text-sm text-zinc-500">Loading…</div>
      )}
      {creating ? (
        <NewTaskModal
          projectId={projectId}
          refinementEnabled={project.data?.refinement_enabled ?? true}
          onClose={() => setCreating(false)}
          onCreated={(t) => open(t.id)}
        />
      ) : null}
      {selected && project.data ? (
        <TaskDrawer taskId={selected} project={project.data} onClose={() => open(null)} />
      ) : null}
    </Shell>
  );
}

function NewTaskModal({
  projectId,
  refinementEnabled,
  onClose,
  onCreated,
}: {
  projectId: string;
  refinementEnabled: boolean;
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
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!title.trim()}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Create in Backlog
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Title">
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            placeholder="Add rate limiting to the login endpoint"
            onKeyDown={(e) => e.key === 'Enter' && title.trim() && create.mutate()}
          />
        </Field>
        <Field
          label="Description"
          hint="Markdown. This is the prompt the agent receives, so be specific: scope, acceptance criteria, files you already know about."
        >
          <textarea
            className={`${inputClass} min-h-44 font-mono text-xs`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        {refinementEnabled ? (
          <Switch
            checked={skip}
            onChange={setSkip}
            label="Skip refinement for this task (go straight to To do)"
          />
        ) : null}
      </div>
    </Modal>
  );
}
