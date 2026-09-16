import type {
  DoneAction,
  ExecutorId,
  Project,
  PromptLanguage,
  ProviderId,
  UpdateProjectInput,
} from '@agent-kanban/shared';
import { EXECUTOR_IDS } from '@agent-kanban/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { keys, useProject, useProvider } from '../api/queries';
import { Shell } from '../components/Shell';
import { Button, Card, Field, inputClass, Switch, useConfirm } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { EXECUTOR_LABELS } from '../lib/state';
import { ExecutorStatusRow } from './ProjectsPage';

export function SettingsPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  return (
    <Shell projectId={projectId}>
      {project.data ? (
        <SettingsForm project={project.data} />
      ) : (
        <div className="p-6 text-sm text-zinc-500">{project.isError ? 'Project not found.' : 'Loading…'}</div>
      )}
    </Shell>
  );
}

/** Editable copy of the project; nullable text columns are edited as strings ('' = null). */
type Form = Required<
  Omit<
    UpdateProjectInput,
    | 'setup_script'
    | 'test_script'
    | 'refinement_prompt'
    | 'model'
    | 'max_budget_usd'
    | 'execute_prompt'
    | 'followup_prompt'
    | 'issue_import_labels'
    | 'issue_provider'
    | 'issue_project_ref'
  >
> & {
  issue_import_labels: string;
  issue_provider: ProviderId | '';
  issue_project_ref: string;
  setup_script: string;
  test_script: string;
  refinement_prompt: string;
  model: string;
  max_budget_usd: string;
  execute_prompt: string;
  followup_prompt: string;
};

const toForm = (p: Project): Form => ({
  name: p.name,
  default_executor: p.default_executor,
  base_branch: p.base_branch,
  setup_script: p.setup_script ?? '',
  test_script: p.test_script ?? '',
  auto_done: p.auto_done,
  refinement_enabled: p.refinement_enabled,
  max_concurrent_runs: p.max_concurrent_runs,
  run_timeout_minutes: p.run_timeout_minutes,
  refinement_prompt: p.refinement_prompt ?? '',
  model: p.model ?? '',
  max_budget_usd: p.max_budget_usd === null ? '' : String(p.max_budget_usd),
  prompt_language: p.prompt_language,
  execute_prompt: p.execute_prompt ?? '',
  followup_prompt: p.followup_prompt ?? '',
  done_action: p.done_action,
  auto_start: p.auto_start,
  browser_enabled: p.browser_enabled,
  issue_sync: p.issue_sync,
  issue_import_labels: p.issue_import_labels ?? '',
  issue_provider: p.issue_provider ?? '',
  issue_project_ref: p.issue_project_ref ?? '',
});

const orNull = (v: string) => (v.trim() ? v : null);

function SettingsForm({ project }: { project: Project }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirm, confirmNode] = useConfirm();
  const provider = useProvider(project.id);
  const [form, setForm] = useState<Form>(() => toForm(project));
  useEffect(() => setForm(toForm(project)), [project]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      api.projects.update(project.id, {
        ...form,
        setup_script: orNull(form.setup_script),
        test_script: orNull(form.test_script),
        refinement_prompt: orNull(form.refinement_prompt),
        execute_prompt: orNull(form.execute_prompt),
        followup_prompt: orNull(form.followup_prompt),
        model: orNull(form.model),
        max_budget_usd: form.max_budget_usd.trim() ? Number(form.max_budget_usd) : null,
        issue_import_labels: orNull(form.issue_import_labels),
        issue_provider: form.issue_provider || null,
        issue_project_ref: orNull(form.issue_project_ref),
      }),
    onSuccess: (p) => {
      qc.setQueryData(keys.project(p.id), p);
      void qc.invalidateQueries({ queryKey: keys.projects });
      void qc.invalidateQueries({ queryKey: keys.provider(p.id) });
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

  return (
    <div className="mx-auto max-w-3xl p-6">
      {confirmNode}
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <Link
            to={`/p/${project.id}`}
            className="mb-1 inline-flex items-center gap-1 text-accent-600 text-xs hover:underline dark:text-accent-300"
          >
            <ArrowLeft size={12} /> Back to board
          </Link>
          <h1 className="font-semibold text-2xl tracking-tight">Settings · {project.name}</h1>
          <p className="truncate font-mono text-xs text-zinc-500">{project.repo_path}</p>
        </div>
        <Button
          variant="primary"
          icon={<Save size={14} />}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Save changes
        </Button>
      </div>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Card title="General">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Base branch" hint="Attempts branch from here and merge back into it.">
              <input
                className={`${inputClass} font-mono`}
                value={form.base_branch}
                onChange={(e) => set('base_branch', e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card title="Executor">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Default executor">
              <select
                className={inputClass}
                value={form.default_executor}
                onChange={(e) => set('default_executor', e.target.value as ExecutorId)}
              >
                {EXECUTOR_IDS.map((id) => (
                  <option key={id} value={id}>
                    {EXECUTOR_LABELS[id] ?? id}
                  </option>
                ))}
              </select>
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
            <Field
              label="Model"
              hint="Passed to the CLI (Claude: --model, e.g. sonnet / opus). Empty = CLI default. Tasks can override it."
            >
              <input
                className={`${inputClass} font-mono`}
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
                placeholder="sonnet"
              />
            </Field>
            <Field
              label="Max budget per run (USD)"
              hint="Claude: --max-budget-usd. The run stops when the cap is reached. Empty = unlimited."
            >
              <input
                type="number"
                min={0.1}
                step={0.5}
                className={inputClass}
                value={form.max_budget_usd}
                onChange={(e) => set('max_budget_usd', e.target.value)}
                placeholder="5"
              />
            </Field>
          </div>
          <div className="mt-3">
            <ExecutorStatusRow projectId={project.id} />
          </div>
        </Card>

        <Card title="Scripts">
          <div className="grid gap-4">
            <Field
              label="Setup script"
              hint="Runs inside the fresh worktree before the agent starts (e.g. pnpm install). Failure → DOING(error)."
            >
              <input
                className={`${inputClass} font-mono`}
                value={form.setup_script}
                onChange={(e) => set('setup_script', e.target.value)}
                placeholder="pnpm install"
              />
            </Field>
            <Field
              label="Test script"
              hint="Runs after each agent run (10 min timeout). Result shows on the card and in the Tests tab."
            >
              <input
                className={`${inputClass} font-mono`}
                value={form.test_script}
                onChange={(e) => set('test_script', e.target.value)}
                placeholder="pnpm test"
              />
            </Field>
          </div>
        </Card>

        <Card title="Workflow">
          <div className="grid gap-4">
            <Switch
              checked={form.refinement_enabled}
              onChange={(v) => set('refinement_enabled', v)}
              label="Refinement step: Backlog → To do asks the agent to read the repo, plan, and raise questions first"
            />
            <Switch
              checked={form.auto_start}
              onChange={(v) => set('auto_start', v)}
              label={`Auto-start: run every task as soon as it reaches To do (at most ${form.max_concurrent_runs} agent${form.max_concurrent_runs === 1 ? '' : 's'} in parallel; the rest wait in Doing as "queued")`}
            />
            <Switch
              checked={form.browser_enabled}
              onChange={(v) => set('browser_enabled', v)}
              label="Browser access: let the agent drive Chrome (Claude in Chrome, `claude --chrome`) to verify UI flows and take screenshots. Requires the Claude in Chrome extension on this machine."
            />
            <Switch
              checked={form.auto_done}
              onChange={(v) => set('auto_done', v)}
              label="Auto-complete when the test script passes (off by default)"
            />
            <Field
              label="When a task is marked Done"
              hint={
                provider.data
                  ? `Origin is hosted on ${provider.data.id} (${provider.data.projectRef}) — ${provider.data.ok ? 'pull requests are available' : provider.data.message}`
                  : 'Pull requests need an origin remote on GitHub and GITHUB_TOKEN in the environment.'
              }
            >
              <select
                className={inputClass}
                value={form.done_action}
                onChange={(e) => set('done_action', e.target.value as DoneAction)}
              >
                <option value="merge">Merge the attempt branch into the base branch locally</option>
                <option value="pr">Push the branch and open a pull request</option>
              </select>
            </Field>
          </div>
        </Card>

        <Card title="Prompts">
          <div className="grid gap-4">
            <Field
              label="Prompt language"
              hint="Language of the built-in instructions sent to the agent (task descriptions are passed through unchanged)."
            >
              <select
                className={inputClass}
                value={form.prompt_language}
                onChange={(e) => set('prompt_language', e.target.value as PromptLanguage)}
              >
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field
              label="Refinement prompt template"
              hint={
                <>
                  Optional. Placeholders:{' '}
                  <code className="font-mono">{'{{title}} {{description}} {{qa}}'}</code>. Empty = built-in
                  template.
                </>
              }
            >
              <textarea
                className={`${inputClass} min-h-28 font-mono text-xs`}
                value={form.refinement_prompt}
                onChange={(e) => set('refinement_prompt', e.target.value)}
              />
            </Field>
            <Field
              label="Execute prompt template"
              hint={
                <>
                  Optional. Placeholders:{' '}
                  <code className="font-mono">
                    {
                      '{{title}} {{description}} {{plan_section}} {{feedback_section}} {{worktree_notice}} {{constraints}}'
                    }
                  </code>
                  .
                </>
              }
            >
              <textarea
                className={`${inputClass} min-h-28 font-mono text-xs`}
                value={form.execute_prompt}
                onChange={(e) => set('execute_prompt', e.target.value)}
              />
            </Field>
            <Field
              label="Followup prompt template"
              hint={
                <>
                  Optional. Placeholder: <code className="font-mono">{'{{feedback}}'}</code> (numbered list of
                  review comments).
                </>
              }
            >
              <textarea
                className={`${inputClass} min-h-24 font-mono text-xs`}
                value={form.followup_prompt}
                onChange={(e) => set('followup_prompt', e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card title="Issue tracker">
          <div className="grid gap-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {provider.data ? (
                <>
                  Linked to <span className="font-medium">{provider.data.id}</span> ·{' '}
                  <span className="font-mono">{provider.data.projectRef}</span> ·{' '}
                  {provider.data.ok ? (
                    <span className="text-emerald-600">token found</span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300">{provider.data.message}</span>
                  )}
                </>
              ) : (
                <>No tracker detected from the origin remote. Set one below, or add a GitHub/GitLab remote.</>
              )}
            </p>
            <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
              <Field label="Tracker">
                <select
                  className={inputClass}
                  value={form.issue_provider}
                  onChange={(e) => set('issue_provider', e.target.value as ProviderId | '')}
                >
                  <option value="">auto (origin remote)</option>
                  <option value="github">GitHub</option>
                  <option value="gitlab">GitLab</option>
                </select>
              </Field>
              <Field
                label="Project"
                hint='GitHub: "owner/repo". GitLab: full URL "https://gitlab.example.com/group/project". Empty = derived from the origin remote.'
              >
                <input
                  className={`${inputClass} font-mono`}
                  value={form.issue_project_ref}
                  onChange={(e) => set('issue_project_ref', e.target.value)}
                  placeholder="owner/repo"
                />
              </Field>
            </div>
            <Field
              label="Auto-import labels"
              hint="Comma-separated. Open issues carrying one of these labels become Backlog tasks (checked every 5 minutes and at start). Labels like bug / enhancement / priority::high set type and priority."
            >
              <input
                className={inputClass}
                value={form.issue_import_labels}
                onChange={(e) => set('issue_import_labels', e.target.value)}
                placeholder="agent, ready-for-ai"
              />
            </Field>
            <Switch
              checked={form.issue_sync}
              onChange={(v) => set('issue_sync', v)}
              label="Sync status back: comment on the issue when work starts / is ready for review, and close it when the task is Done"
            />
            <p className="text-xs text-zinc-500">
              Tokens come from the environment of the agent-kanban process:{' '}
              <code className="font-mono">GITHUB_TOKEN</code> / <code className="font-mono">GH_TOKEN</code> or{' '}
              <code className="font-mono">GITLAB_TOKEN</code> (scope api).
            </p>
          </div>
        </Card>

        <Card title="Danger zone">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-zinc-500">
              Deletes the project, its tasks, runs and comments. Refused while attempts are active.
            </p>
            <Button
              variant="danger"
              icon={<Trash2 size={14} />}
              loading={remove.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: 'Delete project?',
                    body: 'This cannot be undone.',
                    danger: true,
                    confirmLabel: 'Delete project',
                  })
                )
                  remove.mutate();
              }}
            >
              Delete project
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
