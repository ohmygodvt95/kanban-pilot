import type { Project, TaskDetail } from '@agent-kanban/shared';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, FlaskConical, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { isBusy } from '../../lib/state';
import { Button, EmptyState } from '../ui';
import { useToast } from '../ui/Toast';

export function TestsTab({ task, project }: { task: TaskDetail; project: Project }) {
  const toast = useToast();
  const a = task.current_attempt;
  const rerun = useMutation({
    mutationFn: () => api.tasks.runTests(task.id),
    onSuccess: () =>
      toast.push({ kind: 'info', text: 'Tests started; the result appears here when they finish.' }),
    onError: (err) => toast.error(err, 'Cannot run tests'),
  });
  const canRun = !!a && a.status === 'active' && !!project.test_script && !isBusy(task);
  const header = (
    <div className="mb-3 flex items-center justify-between">
      <span className="text-xs text-zinc-500">
        Test script:{' '}
        {project.test_script ? (
          <span className="font-mono">{project.test_script}</span>
        ) : (
          <em>none configured (Settings → Scripts)</em>
        )}
      </span>
      <Button
        size="sm"
        icon={<FlaskConical size={13} />}
        disabled={!canRun}
        loading={rerun.isPending}
        onClick={() => rerun.mutate()}
      >
        Run tests
      </Button>
    </div>
  );
  if (!a)
    return (
      <div className="p-4">
        {header}
        <EmptyState>No attempt yet. Tests run after each agent run once the task is in Doing.</EmptyState>
      </div>
    );
  if (a.last_test_ok === null)
    return (
      <div className="p-4">
        {header}
        <EmptyState>No test run yet.</EmptyState>
      </div>
    );
  return (
    <div className="p-4 text-sm">
      {header}
      <div
        className={`mb-3 flex items-center gap-2 font-medium ${a.last_test_ok ? 'text-emerald-600' : 'text-red-600'}`}
      >
        {a.last_test_ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
        {a.last_test_ok ? 'Tests passed' : 'Tests failed'}
        <span className="font-normal text-xs text-zinc-500">· {a.branch}</span>
      </div>
      <pre className="scrollbar-thin max-h-[68vh] overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-950 p-3 font-mono text-[12px] text-zinc-100 dark:border-zinc-800">
        {a.last_test_output ?? ''}
      </pre>
    </div>
  );
}
