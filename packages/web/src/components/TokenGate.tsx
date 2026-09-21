/**
 * Full-screen sign-in shown while the API refuses us (401) or, on the first load, when
 * /api/health says the server is protected and we hold no token yet. Two flavours:
 * - password: ask for the password and exchange it for a session token (wrong guesses
 *   show how many attempts are left; the server stops itself after the fifth);
 * - token: paste the access token printed by the CLI.
 * Mounted once at the app root; it covers the whole app until the token works.
 */

import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, LockKeyhole } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import { getToken, setToken, UNAUTHORIZED_EVENT } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Logo } from './Shell';
import { Button, inputClass } from './ui';

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
    // health is never guarded: it tells us whether to show the gate at all and which prompt
    const probe = (force: boolean) =>
      api.health().then(
        (h) => {
          setMode(h.auth_mode === 'password' ? 'password' : 'token');
          if (force || (h.auth_required && !getToken())) setOpen(true);
        },
        () => {
          if (force) setOpen(true);
        },
      );
    void probe(false);
    const on = () => void probe(true);
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
    // live connections carry the token in their URL: reconnect with it
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950"
      role="dialog"
      aria-modal="true"
      aria-label={isPassword ? t('password.title') : t('token.title')}
    >
      <form
        className="w-full max-w-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="mb-8 flex items-center justify-center gap-3">
          <Logo size={28} />
          <span className="font-semibold text-xl tracking-tight">KanbanPilot</span>
        </div>
        <h1 className="mb-2 text-center font-semibold text-lg">
          {isPassword ? t('password.title') : t('token.title')}
        </h1>
        <p className="mb-6 text-center text-sm text-zinc-600 dark:text-zinc-300">
          {isPassword ? t('password.body') : t('token.body')}
        </p>
        <label className="block">
          <span className="mb-1 block font-medium text-sm">{isPassword ? t('password.label') : 'Token'}</span>
          <input
            className={`${inputClass} text-base`}
            type={isPassword ? 'password' : 'text'}
            autoComplete={isPassword ? 'current-password' : 'off'}
            autoFocus
            disabled={locked}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {error ? (
          <p role="alert" className="mt-3 text-red-600 text-sm dark:text-red-400">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          className="mt-6 w-full justify-center"
          icon={isPassword ? <LockKeyhole size={14} /> : <KeyRound size={14} />}
          disabled={!value.trim() || busy || locked}
        >
          {isPassword ? t('password.submit') : t('token.save')}
        </Button>
      </form>
    </div>
  );
}
