import type { Substate } from '@agent-kanban/shared';
import { type ButtonHTMLAttributes, type ReactNode, useCallback, useState } from 'react';
import { SUBSTATE_LABELS, SUBSTATE_STYLE } from '../../lib/state';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400',
  secondary:
    'bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-700',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-400',
  ghost: 'text-zinc-700 hover:bg-zinc-200 dark:text-zinc-200 dark:hover:bg-zinc-700',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
      } ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Badge({ substate, extra }: { substate: Substate | null; extra?: string }) {
  if (!substate) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-[11px] ${SUBSTATE_STYLE[substate]}`}
    >
      {substate === 'running' || substate === 'refining' ? <Spinner size={10} /> : null}
      {SUBSTATE_LABELS[substate]}
      {extra ? <span className="opacity-70">{extra}</span> : null}
    </span>
  );
}

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="loading"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path
        d="M4 12a8 8 0 018-8"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        className="opacity-90"
      />
    </svg>
  );
}

export function Modal({
  title,
  children,
  onClose,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white p-4 shadow-xl dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="mb-3 font-semibold text-base">{title}</h2>
        <div className="text-sm">{children}</div>
        {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

/** Promise-based confirm dialog. */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...opts, resolve })),
    [],
  );
  const node = state ? (
    <Modal
      title={state.title}
      onClose={() => {
        state.resolve(false);
        setState(null);
      }}
      footer={
        <>
          <Button
            onClick={() => {
              state.resolve(false);
              setState(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant={state.danger ? 'danger' : 'primary'}
            onClick={() => {
              state.resolve(true);
              setState(null);
            }}
          >
            {state.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      {state.body}
    </Modal>
  ) : null;
  return [confirm, node];
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800';

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-zinc-300 border-dashed p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
      {children}
    </div>
  );
}
