import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { keys, useExecutors, useProjects } from '../api/queries';
import { Button, EmptyState, Field, inputClass } from '../components/ui';
import { useToast } from '../components/ui/Toast';

export function ProjectsPage() {
  const projects = useProjects();
  const qc = useQueryClient();
  const toast = useToast();
  const [repoPath, setRepoPath] = useState('');
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.projects.create({ repo_path: repoPath.trim(), name: name.trim() || undefined }),
    onSuccess: () => {
      setRepoPath('');
      setName('');
      void qc.invalidateQueries({ queryKey: keys.projects });
      toast.push({ kind: 'success', text: 'Project added' });
    },
    onError: (err) => toast.error(err, 'Cannot add project'),
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-semibold text-xl">🗂️ Agent Kanban</h1>
        <span className="text-xs text-zinc-500">local · {location.host}</span>
      </header>

      <section className="mb-8 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">Add project</h2>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (repoPath.trim()) create.mutate();
          }}
        >
          <div className="grid gap-3">
            <Field
              label="Repository path"
              hint="Absolute path to a local git repository. .agent-kanban.json in the repo is used for defaults."
            >
              <input
                className={inputClass}
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="/home/me/code/my-app"
              />
            </Field>
            <Field label="Name (optional)">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-app"
              />
            </Field>
          </div>
          <div className="flex items-end">
            <Button variant="primary" type="submit" disabled={create.isPending || !repoPath.trim()}>
              {create.isPending ? 'Checking…' : 'Add'}
            </Button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-3 font-medium">Projects</h2>
        {projects.isLoading ? <p className="text-sm text-zinc-500">Loading…</p> : null}
        {projects.data?.length === 0 ? (
          <EmptyState>No projects yet. Add a repository above.</EmptyState>
        ) : null}
        <ul className="grid gap-3">
          {projects.data?.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link
                    to={`/p/${p.id}`}
                    className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {p.name}
                  </Link>
                  <div className="font-mono text-xs text-zinc-500">{p.repo_path}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    base <span className="font-mono">{p.base_branch}</span> · default executor{' '}
                    {p.default_executor} · refinement {p.refinement_enabled ? 'on' : 'off'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link to={`/p/${p.id}`}>
                    <Button variant="primary" size="sm">
                      Open board
                    </Button>
                  </Link>
                  <Link to={`/p/${p.id}/settings`}>
                    <Button size="sm">Settings</Button>
                  </Link>
                </div>
              </div>
              <ExecutorStatusRow projectId={p.id} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function ExecutorStatusRow({ projectId }: { projectId: string }) {
  const execs = useExecutors(projectId);
  if (!execs.data) return <div className="mt-2 text-xs text-zinc-400">checking executors…</div>;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {execs.data.map((e) => (
        <span
          key={e.id}
          title={e.message ?? ''}
          className={`rounded px-1.5 py-0.5 text-[11px] ${
            e.ok
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
              : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
          }`}
        >
          {e.ok ? '●' : '○'} {e.displayName}
          {e.version ? <span className="opacity-70"> {e.version.split(' ')[0]}</span> : null}
        </span>
      ))}
    </div>
  );
}
