/**
 * Push every unlinked task of the project to the tracker in one go. Missing
 * required fields are asked once (409 CONFIRM_REQUIRED) and applied to all.
 */
import type { RemoteField, Task } from '@agent-kanban/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../api/client';
import { keys } from '../api/queries';
import { useI18n } from '../lib/i18n';
import { RemoteFieldInput } from './drawer/PushToTrackerModal';
import { Button, Field, Modal } from './ui';
import { useToast } from './ui/Toast';

export function BulkPushModal({
  projectId,
  tracker,
  tasks,
  onClose,
}: {
  projectId: string;
  tracker: string;
  tasks: Task[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const candidates = tasks.filter((x) => !x.source_external_id && x.column !== 'done');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(candidates.map((x) => x.id)));
  const [missing, setMissing] = useState<RemoteField[]>([]);
  const [issueType, setIssueType] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const push = useMutation({
    mutationFn: () =>
      api.projects.pushTasks(projectId, { ids: [...selected], issue_type_id: issueType, fields: values }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.tasks(projectId) });
      toast.push({
        kind: r.failed.length ? 'info' : 'success',
        text: t('bulk.result', { ok: r.pushed.length, failed: r.failed.length }),
        duration: r.failed.length ? 10_000 : undefined,
      });
      if (r.failed.length) for (const f of r.failed.slice(0, 3)) toast.push({ kind: 'error', text: f.error });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'CONFIRM_REQUIRED') {
        const d = err.details as { issue_type: { id: string }; missing: RemoteField[] };
        setIssueType(d.issue_type.id);
        setMissing(d.missing);
        return;
      }
      toast.error(err);
    },
  });
  const complete = missing.every((f) => {
    const v = values[f.key];
    return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
  });
  const toggle = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Modal
      title={t('bulk.title', { tracker })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={<Upload size={14} />}
            disabled={selected.size === 0 || !complete}
            loading={push.isPending}
            onClick={() => push.mutate()}
          >
            {t('bulk.push', { n: selected.size })}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-zinc-600 dark:text-zinc-300">{t('bulk.body')}</p>
      {candidates.length === 0 ? (
        <p className="text-sm text-zinc-500">{t('bulk.none')}</p>
      ) : (
        <>
          <label className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
            <input
              type="checkbox"
              checked={selected.size === candidates.length}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(candidates.map((x) => x.id)) : new Set())
              }
            />
            {t('bulk.selectAll')}
          </label>
          <ul className="max-h-56 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-700">
            {candidates.map((x) => (
              <li key={x.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <input type="checkbox" checked={selected.has(x.id)} onChange={() => toggle(x.id)} />
                  <span className="flex-1 truncate">{x.title}</span>
                  <span className="text-[10px] text-zinc-400 uppercase">{x.column}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {missing.length ? (
        <div className="mt-4 grid gap-3 border-zinc-200 border-t pt-3 dark:border-zinc-700">
          {missing.map((f) => (
            <Field
              key={f.key}
              label={`${f.name}${f.required ? ' *' : ''}`}
              hint={<span className="font-mono">{f.key}</span>}
            >
              <RemoteFieldInput
                field={f}
                value={values[f.key]}
                onChange={(v) => setValues((old) => ({ ...old, [f.key]: v }))}
                projectId={projectId}
              />
            </Field>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
