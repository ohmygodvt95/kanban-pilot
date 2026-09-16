import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderGit2, Plus, Settings } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { keys, useExecutors, useProjects } from '../api/queries';
import { Shell } from '../components/Shell';
import { Button, Card, EmptyState, Field, inputClass } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { EXECUTOR_LABELS } from '../lib/state';

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
    <Shell>
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-6">
          <h1 className="font-semibold text-2xl tracking-tight">Projects</h1>
          <p className="text-sm text-zinc-500">
            Each project is a local git repository. Agents work in separate worktrees, never in your checkout.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid min-w-0 content-start gap-3">
            {projects.isLoading ? <p className="text-sm text-zinc-500">Loading…</p> : null}
            {projects.data?.length === 0 ? (
              <EmptyState icon={<FolderGit2 size={28} className="text-zinc-400" />}>
                No projects yet. Add a repository to get started.
              </EmptyState>
            ) : null}
            {projects.data?.map((p) => (
              <Card key={p.id} className="transition hover:border-accent-300 dark:hover:border-accent-700">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link to={`/p/${p.id}`} className="font-semibold text-base hover:text-accent-600">
                      {p.name}
                    </Link>
                    <div className="truncate font-mono text-xs text-zinc-500">{p.repo_path}</div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span>
                        base{' '}
                        <span className="font-mono text-zinc-700 dark:text-zinc-300">{p.base_branch}</span>
                      </span>
                      <span>
                        executor{' '}
                        <span className="text-zinc-700 dark:text-zinc-300">
                          {EXECUTOR_LABELS[p.default_executor] ?? p.default_executor}
                        </span>
                      </span>
                      <span>refinement {p.refinement_enabled ? 'on' : 'off'}</span>
                      <span>auto-done {p.auto_done ? 'on' : 'off'}</span>
                      {p.test_script ? (
                        <span>
                          tests{' '}
                          <span className="font-mono text-zinc-700 dark:text-zinc-300">{p.test_script}</span>
                        </span>
                      ) : null}
                    </div>
                    <ExecutorStatusRow projectId={p.id} />
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Link to={`/p/${p.id}`}>
                      <Button variant="primary" size="sm">
                        Open board
                      </Button>
                    </Link>
                    <Link to={`/p/${p.id}/settings`}>
                      <Button size="sm" icon={<Settings size={13} />}>
                        Settings
                      </Button>
                    </Link>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <Card title="Add project">
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (repoPath.trim()) create.mutate();
              }}
            >
              <Field
                label="Repository path"
                hint="Absolute path to a local git repository. A .agent-kanban.json in the repo provides defaults."
              >
                <input
                  className={`${inputClass} font-mono`}
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
              <Button
                variant="primary"
                type="submit"
                disabled={!repoPath.trim()}
                loading={create.isPending}
                icon={<Plus size={14} />}
              >
                Add project
              </Button>
              <p className="text-xs text-zinc-500">
                Tip: <code className="font-mono">npx agent-kanban add .</code> from inside a repo does the
                same.
              </p>
            </form>
          </Card>
        </div>
      </div>
    </Shell>
  );
}

export function ExecutorStatusRow({ projectId }: { projectId: string }) {
  const execs = useExecutors(projectId);
  if (!execs.data) return <div className="mt-2 text-xs text-zinc-400">checking executors…</div>;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {execs.data.map((e) => (
        <span
          key={e.id}
          title={e.message ?? ''}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
            e.ok
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${e.ok ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
          {e.displayName}
          {e.version ? <span className="opacity-70">{e.version.split(' ')[0]}</span> : null}
        </span>
      ))}
    </div>
  );
}
