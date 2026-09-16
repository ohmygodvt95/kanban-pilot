/**
 * Shown when the API answers 401: asks for the access token printed by the CLI,
 * stores it and reloads the queries. Mounted once at the app root.
 */

import { useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getToken, setToken, UNAUTHORIZED_EVENT } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Button, Field, inputClass, Modal } from './ui';

export function TokenGate() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(UNAUTHORIZED_EVENT, on);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, on);
  }, []);
  if (!open) return null;
  const save = () => {
    const token = value.trim();
    if (!token) return;
    setToken(token);
    setOpen(false);
    setValue('');
    void qc.invalidateQueries();
    // EventSource connections carry the token in their URL: reconnect with it
    if (!getToken()) return;
    window.location.reload();
  };
  return (
    <Modal
      title={t('token.title')}
      onClose={() => setOpen(false)}
      footer={
        <Button variant="primary" icon={<KeyRound size={14} />} disabled={!value.trim()} onClick={save}>
          {t('token.save')}
        </Button>
      }
    >
      <p className="mb-3 text-zinc-600 dark:text-zinc-300">{t('token.body')}</p>
      <Field label="Token">
        <input
          className={inputClass}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </Field>
    </Modal>
  );
}
