/**
 * Issue tracker integration screen (one tracker per project). The form is driven
 * by the provider modules exposed at /api/providers: choose a provider, fill the
 * fields it declares, test the connection, map remote statuses to kanban columns.
 */
import type {
  Column,
  Integration,
  IntegrationInput,
  ProviderModuleInfo,
  StatusMap,
} from '@agent-kanban/shared';
import { COLUMNS } from '@agent-kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Download, Plug, RefreshCw, Save, Trash2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { keys, useIntegration, useProject, useProviderModules } from '../api/queries';
import { Shell } from '../components/Shell';
import { Button, Card, Field, inputClass, Switch, useConfirm } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { formatTime } from '../lib/format';
import { COLUMN_LABELS } from '../lib/state';

interface FormState {
  provider: ProviderModuleInfo['id'];
  base_url: string;
  project_ref: string;
  username: string;
  token: string;
  password: string;
  import_filter: string;
  status_map: StatusMap;
  sync_status: boolean;
  sync_comments: boolean;
  poll_interval_seconds: number;
}

const emptyMap = (): StatusMap => ({ backlog: [], todo: [], doing: [], review: [], done: [] });

function fromIntegration(i: Integration | null, module: ProviderModuleInfo | undefined): FormState {
  return {
    provider: i?.provider ?? module?.id ?? 'github',
    base_url: i?.base_url ?? '',
    project_ref: i?.project_ref ?? '',
    username: i?.auth.username ?? '',
    token: '',
    password: '',
    import_filter: i?.import_filter ?? '',
    status_map: i?.status_map ?? module?.defaultStatusMap ?? emptyMap(),
    sync_status: i?.sync_status ?? true,
    sync_comments: i?.sync_comments ?? true,
    poll_interval_seconds: i?.poll_interval_seconds ?? 30,
  };
}

function toInput(f: FormState): IntegrationInput {
  return {
    provider: f.provider,
    base_url: f.base_url.trim() || null,
    project_ref: f.project_ref.trim(),
    username: f.username.trim() || null,
    token: f.token || null,
    password: f.password || null,
    import_filter: f.import_filter.trim() || null,
    status_map: f.status_map,
    sync_status: f.sync_status,
    sync_comments: f.sync_comments,
    poll_interval_seconds: f.poll_interval_seconds,
  };
}

export function IntegrationPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const integration = useIntegration(projectId);
  const modules = useProviderModules();
  return (
    <Shell projectId={projectId}>
      {project.data && modules.data && !integration.isLoading ? (
        <IntegrationForm
          projectId={projectId}
          projectName={project.data.name}
          modules={modules.data}
          integration={integration.data ?? null}
        />
      ) : (
        <div className="p-6 text-sm text-zinc-500">Loading…</div>
      )}
    </Shell>
  );
}

function IntegrationForm({
  projectId,
  projectName,
  modules,
  integration,
}: {
  projectId: string;
  projectName: string;
  modules: ProviderModuleInfo[];
  integration: Integration | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
  const [form, setForm] = useState<FormState>(() => fromIntegration(integration, modules[0]));
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const module = useMemo(() => modules.find((m) => m.id === form.provider), [modules, form.provider]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Prefill a fresh form from the origin remote.
  const suggest = useQuery({
    queryKey: ['integration-suggest', projectId],
    queryFn: () => api.projects.integrationSuggest(projectId),
    enabled: !integration,
  });
  useEffect(() => {
    if (integration || !suggest.data) return;
    const m = modules.find((x) => x.id === suggest.data?.provider);
    setForm((f) => ({
      ...f,
      provider: suggest.data!.provider as FormState['provider'],
      base_url: suggest.data!.base_url ?? '',
      project_ref: suggest.data!.project_ref,
      status_map: m?.defaultStatusMap ?? f.status_map,
    }));
  }, [suggest.data, integration, modules]);

  const remoteStatuses = useQuery({
    queryKey: ['integration-statuses', projectId, integration?.updated_at],
    queryFn: () => api.projects.integrationStatuses(projectId),
    enabled: !!integration,
    retry: false,
  });

  const save = useMutation({
    mutationFn: () => api.projects.saveIntegration(projectId, toInput(form)),
    onSuccess: (saved) => {
      qc.setQueryData(keys.integration(projectId), saved);
      void qc.invalidateQueries({ queryKey: keys.provider(projectId) });
      setForm((f) => ({ ...f, token: '', password: '' }));
      toast.push({ kind: 'success', text: 'Integration saved' });
    },
    onError: (err) => toast.error(err, 'Save failed'),
  });
  const test = useMutation({
    mutationFn: () => api.projects.testIntegration(projectId, toInput(form)),
    onSuccess: setTestResult,
    onError: (err) => setTestResult({ ok: false, message: (err as Error).message }),
  });
  const fetchNow = useMutation({
    mutationFn: () => api.projects.fetchIssues(projectId),
    onSuccess: (r) => {
      toast.push({ kind: 'success', text: `Imported ${r.imported} new issue(s)` });
      void qc.invalidateQueries({ queryKey: keys.tasks(projectId) });
      void qc.invalidateQueries({ queryKey: keys.integration(projectId) });
    },
    onError: (err) => toast.error(err, 'Fetch failed'),
  });
  const remove = useMutation({
    mutationFn: () => api.projects.deleteIntegration(projectId),
    onSuccess: () => {
      qc.setQueryData(keys.integration(projectId), null);
      void qc.invalidateQueries({ queryKey: keys.provider(projectId) });
      setForm(fromIntegration(null, modules[0]));
      toast.push({ kind: 'info', text: 'Integration removed' });
    },
    onError: (err) => toast.error(err, 'Remove failed'),
  });

  const switchProvider = (id: ProviderModuleInfo['id']) => {
    const m = modules.find((x) => x.id === id);
    setTestResult(null);
    setForm((f) => ({
      ...f,
      provider: id,
      status_map: integration?.provider === id ? integration.status_map : (m?.defaultStatusMap ?? emptyMap()),
    }));
  };

  const secretHint = (key: 'token' | 'password') =>
    integration &&
    integration.provider === form.provider &&
    (key === 'token' ? integration.auth.has_token : integration.auth.has_password)
      ? 'A secret is stored; leave blank to keep it.'
      : undefined;

  return (
    <div className="mx-auto max-w-3xl p-6">
      {confirmNode}
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <Link
            to={`/p/${projectId}`}
            className="mb-1 inline-flex items-center gap-1 text-accent-600 text-xs hover:underline dark:text-accent-300"
          >
            <ArrowLeft size={12} /> Back to board
          </Link>
          <h1 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
            <Plug size={22} /> Integration · {projectName}
          </h1>
          <p className="text-sm text-zinc-500">
            Connect one issue tracker. New issues are pulled every {form.poll_interval_seconds}s; task moves
            are written back through the status map.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Save size={14} />}
          loading={save.isPending}
          disabled={!form.project_ref.trim()}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>

      <div className="grid gap-4">
        <Card title="Provider">
          <div className="grid gap-3 sm:grid-cols-3">
            {modules.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => switchProvider(m.id)}
                className={`rounded-lg border p-3 text-left transition ${
                  form.provider === m.id
                    ? 'border-accent-500 bg-accent-50 ring-2 ring-accent-500/30 dark:bg-accent-900/20'
                    : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-700'
                }`}
              >
                <div className="font-medium text-sm">{m.displayName}</div>
                <div className="mt-1 text-xs text-zinc-500">{m.description}</div>
              </button>
            ))}
          </div>
        </Card>

        {module ? (
          <Card title={`${module.displayName} connection`}>
            <div className="grid gap-4">
              {module.fields.map((f) => (
                <Field
                  key={f.key}
                  label={`${f.label}${f.required ? ' *' : ''}`}
                  hint={f.key === 'token' || f.key === 'password' ? (secretHint(f.key) ?? f.help) : f.help}
                >
                  {f.type === 'textarea' ? (
                    <textarea
                      className={`${inputClass} min-h-20 font-mono text-xs`}
                      value={form[f.key]}
                      onChange={(e) => set(f.key, e.target.value)}
                      placeholder={f.placeholder}
                    />
                  ) : (
                    <input
                      type={f.type === 'password' ? 'password' : 'text'}
                      autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                      className={`${inputClass} ${f.key === 'project_ref' || f.key === 'base_url' ? 'font-mono' : ''}`}
                      value={form[f.key]}
                      onChange={(e) => set(f.key, e.target.value)}
                      placeholder={f.placeholder}
                    />
                  )}
                </Field>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  icon={<CheckCircle2 size={14} />}
                  loading={test.isPending}
                  disabled={!form.project_ref.trim()}
                  onClick={() => test.mutate()}
                >
                  Test connection
                </Button>
                {testResult ? (
                  <span
                    className={`inline-flex items-center gap-1 text-sm ${testResult.ok ? 'text-emerald-600' : 'text-red-600'}`}
                  >
                    {testResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}{' '}
                    {testResult.message ?? (testResult.ok ? 'OK' : 'failed')}
                  </span>
                ) : null}
              </div>
            </div>
          </Card>
        ) : null}

        <Card
          title="Status mapping"
          actions={
            integration ? (
              <span className="text-xs text-zinc-500">
                {remoteStatuses.data
                  ? `${remoteStatuses.data.length} remote statuses`
                  : remoteStatuses.isError
                    ? 'could not load remote statuses'
                    : ''}
              </span>
            ) : null
          }
        >
          <p className="mb-3 text-xs text-zinc-500">
            Left: kanban column. Right: remote{' '}
            {module?.statusModel === 'workflow' ? 'workflow statuses' : 'labels'} that mean this column.
            Imported issues land in the column of their status (Done is skipped; Doing/Review land in To do).
            When a task moves, the <strong>first</strong> entry is written back
            {module?.statusModel === 'workflow' ? ' as a transition' : ' as a label'}.
          </p>
          <div className="grid gap-2">
            {COLUMNS.map((c) => (
              <StatusRow
                key={c}
                column={c}
                values={form.status_map[c] ?? []}
                options={remoteStatuses.data ?? []}
                onChange={(v) => set('status_map', { ...form.status_map, [c]: v })}
              />
            ))}
          </div>
        </Card>

        <Card title="Sync">
          <div className="grid gap-4">
            <Field label="Poll interval (seconds)" hint="How often new issues are fetched from the tracker.">
              <input
                type="number"
                min={10}
                max={3600}
                className={`${inputClass} w-40`}
                value={form.poll_interval_seconds}
                onChange={(e) => set('poll_interval_seconds', Number(e.target.value))}
              />
            </Field>
            <Switch
              checked={form.sync_status}
              onChange={(v) => set('sync_status', v)}
              label="Write the mapped status back to the issue when a task changes column"
            />
            <Switch
              checked={form.sync_comments}
              onChange={(v) => set('sync_comments', v)}
              label="Also leave a short comment on the issue at each milestone"
            />
            {integration ? (
              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                <Button
                  size="sm"
                  icon={<Download size={13} />}
                  loading={fetchNow.isPending}
                  onClick={() => fetchNow.mutate()}
                >
                  Fetch now
                </Button>
                <span>
                  last poll: {integration.last_polled_at ? formatTime(integration.last_polled_at) : 'never'}
                </span>
                {integration.last_error ? (
                  <span className="text-red-600">last error: {integration.last_error}</span>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RefreshCw size={13} />}
                  onClick={() => void qc.invalidateQueries({ queryKey: keys.integration(projectId) })}
                >
                  refresh
                </Button>
              </div>
            ) : null}
          </div>
        </Card>

        {integration ? (
          <Card title="Danger zone">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="min-w-0 flex-1 text-sm text-zinc-500">
                Removes the connection and stored credentials. Imported tasks stay.
              </p>
              <Button
                variant="danger"
                icon={<Trash2 size={14} />}
                loading={remove.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: 'Remove integration?',
                      body: 'Credentials are deleted; tasks are kept.',
                      danger: true,
                      confirmLabel: 'Remove',
                    })
                  )
                    remove.mutate();
                }}
              >
                Remove integration
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/** One row of the status map: chips of selected remote statuses + an input with suggestions. */
function StatusRow({
  column,
  values,
  options,
  onChange,
}: {
  column: Column;
  values: string[];
  options: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const listId = `statuses-${column}`;
  const add = (v: string) => {
    const s = v.trim();
    if (!s || values.some((x) => x.toLowerCase() === s.toLowerCase())) return;
    onChange([...values, s]);
    setDraft('');
  };
  return (
    <div className="grid items-start gap-2 sm:grid-cols-[120px_1fr]">
      <div className="pt-1.5 font-medium text-sm">{COLUMN_LABELS[column]}</div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-zinc-300 p-1.5 dark:border-zinc-600">
        {values.map((v, i) => (
          <span
            key={v}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${i === 0 ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/50 dark:text-accent-200' : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200'}`}
            title={i === 0 ? 'written back on sync' : 'import only'}
          >
            {v}
            <button
              type="button"
              aria-label={`remove ${v}`}
              className="opacity-60 hover:opacity-100"
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          list={listId}
          className="min-w-32 flex-1 bg-transparent px-1 py-0.5 text-xs outline-none"
          placeholder={values.length ? 'add…' : 'remote status or label…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            }
          }}
          onBlur={() => add(draft)}
        />
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
