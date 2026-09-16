import type { ExecutorId, Project, UpdateProjectInput } from '@agent-kanban/shared';
import { EXECUTOR_IDS } from '@agent-kanban/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { keys, useProject } from '../api/queries';
import { Button, Field, inputClass, useConfirm } from '../components/ui';
import { useToast } from '../components/ui/Toast';

export function SettingsPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  if (!project.data)
    return (
      <div className="p-6 text-sm text-zinc-500">{project.isError ? 'Project not found.' : 'Loading…'}</div>
    );
  return <SettingsForm project={project.data} />;
}

function SettingsForm({ project }: { project: Project }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirm, confirmNode] = useConfirm();
  const [form, setForm] = useState<UpdateProjectInput & { name: string }>({
    name: project.name,
    default_executor: project.default_executor,
    base_branch: project.base_branch,
    setup_script: project.setup_script ?? '',
    test_script: project.test_script ?? '',
    auto_done: project.auto_done,
    refinement_enabled: project.refinement_enabled,
    max_concurrent_runs: project.max_concurrent_runs,
    run_timeout_minutes: project.run_timeout_minutes,
    refinement_prompt: project.refinement_prompt ?? '',
  });
  useEffect(() => {
    setForm({
      name: project.name,
      default_executor: project.default_executor,
      base_branch: project.base_branch,
      setup_script: project.setup_script ?? '',
      test_script: project.test_script ?? '',
      auto_done: project.auto_done,
      refinement_enabled: project.refinement_enabled,
      max_concurrent_runs: project.max_concurrent_runs,
      run_timeout_minutes: project.run_timeout_minutes,
      refinement_prompt: project.refinement_prompt ?? '',
    });
  }, [project]);

  const save = useMutation({
    mutationFn: () =>
      api.projects.update(project.id, {
        ...form,
        setup_script: form.setup_script?.trim() ? form.setup_script : null,
        test_script: form.test_script?.trim() ? form.test_script : null,
        refinement_prompt: form.refinement_prompt?.trim() ? form.refinement_prompt : null,
      }),
    onSuccess: (p) => {
      qc.setQueryData(keys.project(p.id), p);
      void qc.invalidateQueries({ queryKey: keys.projects });
      toast.push({ kind: 'success', text: 'Settings saved' });
    },
    onError: (err) => toast.error(err, 'Save failed'),
  });
  const remove = useMutation({
    mutationFn: () => api.projects.delete(project.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.projects });
      navigate('/');
    },
    onError: (err) => toast.error(err, 'Delete failed'),
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="mx-auto max-w-2xl p-6">
      {confirmNode}
      <header className="mb-4 flex items-center gap-3 text-sm">
        <Link to="/" className="text-blue-600 hover:underline dark:text-blue-400">
          Projects
        </Link>
        <span>/</span>
        <Link to={`/p/${project.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
          {project.name}
        </Link>
        <span>/</span>
        <span>Settings</span>
      </header>
      <form
        className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Repository">
          <input className={`${inputClass} font-mono`} value={project.repo_path} readOnly disabled />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default executor">
            <select
              className={inputClass}
              value={form.default_executor}
              onChange={(e) => set('default_executor', e.target.value as ExecutorId)}
            >
              {EXECUTOR_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Base branch">
            <input
              className={`${inputClass} font-mono`}
              value={form.base_branch}
              onChange={(e) => set('base_branch', e.target.value)}
            />
          </Field>
          <Field label="Max concurrent runs">
            <input
              type="number"
              min={1}
              max={16}
              className={inputClass}
              value={form.max_concurrent_runs}
              onChange={(e) => set('max_concurrent_runs', Number(e.target.value))}
            />
          </Field>
          <Field label="Run timeout (minutes)">
            <input
              type="number"
              min={1}
              className={inputClass}
              value={form.run_timeout_minutes}
              onChange={(e) => set('run_timeout_minutes', Number(e.target.value))}
            />
          </Field>
        </div>
        <Field label="Setup script" hint="Runs in the worktree before the agent starts (e.g. pnpm install).">
          <input
            className={`${inputClass} font-mono`}
            value={form.setup_script ?? ''}
            onChange={(e) => set('setup_script', e.target.value)}
            placeholder="pnpm install"
          />
        </Field>
        <Field
          label="Test script"
          hint="Runs after the agent finishes; result shown on the card and in the Tests tab."
        >
          <input
            className={`${inputClass} font-mono`}
            value={form.test_script ?? ''}
            onChange={(e) => set('test_script', e.target.value)}
            placeholder="pnpm test"
          />
        </Field>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!form.refinement_enabled}
              onChange={(e) => set('refinement_enabled', e.target.checked)}
            />
            Refinement step (Backlog → To do asks the agent to plan and raise questions)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!form.auto_done}
              onChange={(e) => set('auto_done', e.target.checked)}
            />
            Auto-merge to Done when tests pass
          </label>
        </div>
        <Field
          label="Refinement prompt template"
          hint="Optional. Placeholders: {{title}} {{description}} {{qa}}. Leave empty for the default."
        >
          <textarea
            className={`${inputClass} min-h-32 font-mono text-xs`}
            value={form.refinement_prompt ?? ''}
            onChange={(e) => set('refinement_prompt', e.target.value)}
          />
        </Field>
        <div className="flex items-center justify-between">
          <Button
            variant="danger"
            type="button"
            onClick={async () => {
              if (
                await confirm({
                  title: 'Delete project?',
                  body: 'Tasks, runs and comments are deleted. Worktrees of active attempts block deletion.',
                  danger: true,
                  confirmLabel: 'Delete',
                })
              )
                remove.mutate();
            }}
          >
            Delete project
          </Button>
          <Button variant="primary" type="submit" disabled={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
