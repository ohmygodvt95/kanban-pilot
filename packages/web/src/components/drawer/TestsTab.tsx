import type { TaskDetail } from '@agent-kanban/shared';
import { CheckCircle2, XCircle } from 'lucide-react';
import { EmptyState } from '../ui';

export function TestsTab({ task }: { task: TaskDetail }) {
  const a = task.current_attempt;
  if (!a)
    return (
      <div className="p-4">
        <EmptyState>No attempt yet. Tests run after each agent run once the task is in Doing.</EmptyState>
      </div>
    );
  if (a.last_test_ok === null)
    return (
      <div className="p-4">
        <EmptyState>
          No test run yet. Configure a test script in project settings; it runs after each agent run.
        </EmptyState>
      </div>
    );
  return (
    <div className="p-4 text-sm">
      <div
        className={`mb-3 flex items-center gap-2 font-medium ${a.last_test_ok ? 'text-emerald-600' : 'text-red-600'}`}
      >
        {a.last_test_ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
        {a.last_test_ok ? 'Tests passed' : 'Tests failed'}
        <span className="font-normal text-xs text-zinc-500">· last run in {a.branch}</span>
      </div>
      <pre className="scrollbar-thin max-h-[72vh] overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-950 p-3 font-mono text-[12px] text-zinc-100 dark:border-zinc-800">
        {a.last_test_output ?? ''}
      </pre>
    </div>
  );
}
