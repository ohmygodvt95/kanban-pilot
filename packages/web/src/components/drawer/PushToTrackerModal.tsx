/**
 * Asks for the remote fields the tracker requires before a task can be created
 * there (returned by POST /tasks/:id/push as CONFIRM_REQUIRED). Fields are rendered
 * from their remote type: selects for allowed values, text/number/date otherwise.
 */
import type { RemoteField, Task } from '@agent-kanban/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../../api/client';
import { upsertTask } from '../../api/queries';
import { Button, Field, inputClass, Modal } from '../ui';
import { useToast } from '../ui/Toast';

export interface PushRequest {
  issue_type: { id: string; name: string };
  missing: RemoteField[];
}

export function PushToTrackerModal({
  task,
  request,
  providerName,
  onClose,
}: {
  task: Task;
  request: PushRequest;
  providerName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [fields, setFields] = useState<RemoteField[]>(request.missing);
  const push = useMutation({
    mutationFn: () => api.tasks.push(task.id, { issue_type_id: request.issue_type.id, fields: values }),
    onSuccess: (t) => {
      upsertTask(qc, t);
      toast.push({ kind: 'success', text: `Created ${t.source_external_id} on ${providerName}` });
      onClose();
    },
    onError: (err) => {
      // the tracker may reveal further required fields once the first ones are set
      if (err instanceof ApiError && err.code === 'CONFIRM_REQUIRED') {
        setFields((err.details as PushRequest).missing);
        return;
      }
      toast.error(err, 'Push failed');
    },
  });
  const complete = fields.every((f) => {
    const v = values[f.key];
    return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
  });
  return (
    <Modal
      title={`Create on ${providerName} as "${request.issue_type.name}"`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={<Send size={14} />}
            disabled={!complete}
            loading={push.isPending}
            onClick={() => push.mutate()}
          >
            Create issue
          </Button>
        </>
      }
    >
      <p className="mb-3 text-zinc-600 dark:text-zinc-300">
        {providerName} requires these fields. Save frequent values once under Integration → Push defaults to
        skip this step.
      </p>
      <div className="grid gap-3">
        {fields.map((f) => (
          <Field
            key={f.key}
            label={`${f.name}${f.required ? ' *' : ''}`}
            hint={<span className="font-mono">{f.key}</span>}
          >
            <RemoteFieldInput
              field={f}
              value={values[f.key]}
              onChange={(v) => setValues((old) => ({ ...old, [f.key]: v }))}
            />
          </Field>
        ))}
      </div>
    </Modal>
  );
}

/** Input matching a remote field's type. */
export function RemoteFieldInput({
  field,
  value,
  onChange,
}: {
  field: RemoteField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (field.allowedValues?.length && (field.type === 'select' || field.type === 'multiselect')) {
    if (field.type === 'multiselect') {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <select
          multiple
          className={`${inputClass} h-28`}
          value={selected}
          onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}
        >
          {field.allowedValues.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    }
    return (
      <select
        className={inputClass}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— choose —</option>
        {field.allowedValues.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'text')
    return (
      <textarea
        className={`${inputClass} min-h-20`}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  if (field.type === 'number')
    return (
      <input
        type="number"
        className={inputClass}
        value={typeof value === 'number' || typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    );
  if (field.type === 'date')
    return (
      <input
        type="date"
        className={inputClass}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  if (field.type === 'labels')
    return (
      <input
        className={inputClass}
        placeholder="comma-separated"
        value={Array.isArray(value) ? (value as string[]).join(', ') : typeof value === 'string' ? value : ''}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
          )
        }
      />
    );
  return (
    <input
      className={inputClass}
      placeholder={field.type === 'user' ? 'username' : ''}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
