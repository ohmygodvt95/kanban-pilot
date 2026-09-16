import type { TaskDetail } from '@agent-kanban/shared';

export function TestsTab({ task }: { task: TaskDetail }) {
  const a = task.current_attempt;
  if (!a) return <div className="p-4 text-sm text-zinc-500">No attempt yet.</div>;
  if (a.last_test_ok === null)
    return (
      <div className="p-4 text-sm text-zinc-500">
        No test run yet. Configure a test script in project settings; it runs after each agent run.
      </div>
    );
  return (
    <div className="p-4 text-sm">
      <div className={`mb-2 font-medium ${a.last_test_ok ? 'text-emerald-600' : 'text-red-600'}`}>
        {a.last_test_ok ? '✓ tests passed' : '✗ tests failed'}
      </div>
      <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-md bg-zinc-100 p-3 font-mono text-xs dark:bg-zinc-800">
        {a.last_test_output ?? ''}
      </pre>
    </div>
  );
}
