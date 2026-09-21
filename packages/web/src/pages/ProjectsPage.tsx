import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FolderGit2, Plus, Settings, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { keys, useExecutors, useProjects } from '../api/queries';
import { Shell } from '../components/Shell';
import { TOUR_LABELS, Tour } from '../components/Tour';
import { Button, Card, EmptyState, Field, inputClass, Modal } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { useI18n } from '../lib/i18n';
import { EXECUTOR_LABELS } from '../lib/state';
import { markTourSeen, tourSeen, tourSteps } from '../lib/tour';

export function ProjectsPage() {
  const projects = useProjects();
  const qc = useQueryClient();
  const toast = useToast();
  const { lang } = useI18n();
  const [repoPath, setRepoPath] = useState('');
  // Welcome tour on the very first visit (no projects yet).
  const [tour, setTour] = useState(false);
  useEffect(() => {
    if (projects.data?.length === 0 && !tourSeen('projects')) setTour(true);
  }, [projects.data]);
  const closeTour = () => {
    markTourSeen('projects');
    setTour(false);
  };
  const [name, setName] = useState('');
  /** Scripts found in the repo's .agent-kanban.json awaiting the user's confirmation. */
  const [pendingScripts, setPendingScripts] = useState<{
    setup_script: string | null;
    test_script: string | null;
  } | null>(null);
  const create = useMutation({
    mutationFn: (accept: boolean) =>
      api.projects.create({
        repo_path: repoPath.trim(),
        name: name.trim() || undefined,
        accept_repo_scripts: accept,
      }),
    onSuccess: () => {
      setRepoPath('');
      setName('');
      setPendingScripts(null);
      void qc.invalidateQueries({ queryKey: keys.projects });
      toast.push({ kind: 'success', text: 'Project added' });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'CONFIRM_REQUIRED') {
        setPendingScripts(err.details as { setup_script: string | null; test_script: string | null });
        return;
      }
      toast.error(err, 'Cannot add project');
    },
  });

  return (
    <Shell>
      {pendingScripts ? (
        <Modal
          title="This repository ships scripts"
          onClose={() => setPendingScripts(null)}
          footer={
            <>
              <Button onClick={() => setPendingScripts(null)}>Cancel</Button>
              <Button variant="primary" loading={create.isPending} onClick={() => create.mutate(true)}>
                Adopt scripts & add project
              </Button>
            </>
          }
        >
          <p className="mb-3 text-zinc-600 dark:text-zinc-300">
            <span className="font-mono">.agent-kanban.json</span> defines commands that agent-kanban would run
            on this machine (in worktrees). Only adopt them if you trust the repository; you can change them
            later in Settings.
          </p>
          <dl className="grid gap-2 font-mono text-xs">
            {pendingScripts.setup_script ? (
              <div className="rounded-md bg-zinc-100 p-2 dark:bg-zinc-800">
                <dt className="text-zinc-500">setup_script</dt>
                <dd>{pendingScripts.setup_script}</dd>
              </div>
            ) : null}
            {pendingScripts.test_script ? (
              <div className="rounded-md bg-zinc-100 p-2 dark:bg-zinc-800">
                <dt className="text-zinc-500">test_script</dt>
                <dd>{pendingScripts.test_script}</dd>
              </div>
            ) : null}
          </dl>
        </Modal>
      ) : null}
      {tour ? (
        <Tour steps={tourSteps('projects', lang)} labels={TOUR_LABELS[lang]} onClose={closeTour} />
      ) : null}
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

          <Card title="Add project" data-tour="add-project">
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (repoPath.trim()) create.mutate(false);
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
                Tip: <code className="font-mono">npx kanban-pilot add .</code> from inside a repo does the
                same.
              </p>
            </form>
          </Card>
          <BackupCard />
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

/** Export the whole database as JSON, or merge a previous export into it. */
function BackupCard() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const download = async (events: boolean) => {
    setBusy(true);
    try {
      const doc = await api.backup.export(events);
      const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kanban-pilot-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const counts = await api.backup.import(JSON.parse(await f.text()));
      const summary = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ');
      toast.push({
        kind: 'success',
        text: t('backup.imported', { summary: summary || '0' }),
        duration: 8000,
      });
      void qc.invalidateQueries();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };
  return (
    <Card title={t('backup.title')}>
      <p className="mb-3 text-xs text-zinc-500">{t('backup.body')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Download size={13} />} loading={busy} onClick={() => download(true)}>
          {t('backup.export')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => download(false)}>
          {t('backup.exportNoEvents')}
        </Button>
        <Button size="sm" icon={<Upload size={13} />} disabled={busy} onClick={() => file.current?.click()}>
          {t('backup.import')}
        </Button>
        <input
          ref={file}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </div>
    </Card>
  );
}
