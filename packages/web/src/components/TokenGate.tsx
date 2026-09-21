/**
 * Shown when the API answers 401. Two flavours, picked from /api/health:
 * - password: ask for the password, exchange it for a session token (wrong guesses show
 *   how many attempts are left; the server stops itself after the fifth);
 * - token: paste the access token printed by the CLI.
 * Mounted once at the app root.
 */

import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, LockKeyhole } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import { getToken, setToken, UNAUTHORIZED_EVENT } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Button, Field, inputClass, Modal } from './ui';

type Mode = 'token' | 'password';

export function TokenGate() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('token');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const on = () => {
      setOpen(true);
      // health is never guarded: it tells us which prompt to show
      api.health().then(
        (h) => setMode(h.auth_mode === 'password' ? 'password' : 'token'),
        () => {},
      );
    };
    window.addEventListener(UNAUTHORIZED_EVENT, on);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, on);
  }, []);
  if (!open) return null;

  const adopt = (token: string) => {
    setToken(token);
    setOpen(false);
    setValue('');
    setError(null);
    void qc.invalidateQueries();
    // EventSource connections carry the token in their URL: reconnect with it
    if (!getToken()) return;
    window.location.reload();
  };
  const submit = async () => {
    const v = value.trim();
    if (!v || busy || locked) return;
    if (mode === 'token') return adopt(v);
    setBusy(true);
    try {
      const { token } = await api.auth.login(v);
      adopt(token);
    } catch (err) {
      const details =
        err instanceof ApiError ? (err.details as { remaining?: number; locked?: boolean }) : null;
      if (details?.locked) {
        setLocked(true);
        setError(t('password.locked'));
      } else if (typeof details?.remaining === 'number') {
        setError(t('password.wrong', { remaining: details.remaining }));
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setValue('');
    } finally {
      setBusy(false);
    }
  };
  const isPassword = mode === 'password';
  return (
    <Modal
      title={isPassword ? t('password.title') : t('token.title')}
      onClose={() => setOpen(false)}
      footer={
        <Button
          variant="primary"
          icon={isPassword ? <LockKeyhole size={14} /> : <KeyRound size={14} />}
          disabled={!value.trim() || busy || locked}
          onClick={() => void submit()}
        >
          {isPassword ? t('password.submit') : t('token.save')}
        </Button>
      }
    >
      <p className="mb-3 text-zinc-600 dark:text-zinc-300">
        {isPassword ? t('password.body') : t('token.body')}
      </p>
      <Field label={isPassword ? t('password.label') : 'Token'}>
        <input
          className={inputClass}
          type={isPassword ? 'password' : 'text'}
          autoComplete={isPassword ? 'current-password' : 'off'}
          autoFocus
          disabled={locked}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </Field>
      {error ? (
        <p role="alert" className="mt-2 text-red-600 text-sm dark:text-red-400">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
