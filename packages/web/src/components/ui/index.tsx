import type { Column, Substate } from '@agent-kanban/shared';
import { Loader2, X } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, useCallback, useEffect, useState } from 'react';
import { COLUMN_LABELS, COLUMN_PILL, SUBSTATE_LABELS, SUBSTATE_STYLE } from '../../lib/state';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle';
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent-600 text-white shadow-sm hover:bg-accent-700 disabled:bg-accent-300 dark:disabled:bg-accent-900',
  secondary:
    'bg-white text-zinc-800 border border-zinc-300 shadow-sm hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-700',
  danger:
    'bg-white text-red-700 border border-red-300 shadow-sm hover:bg-red-50 dark:bg-zinc-800 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-950/40',
  ghost:
    'text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-white',
  subtle:
    'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  loading,
  icon,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'xs' | 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}) {
  const sizes = {
    xs: 'h-6 px-2 text-[11px] gap-1',
    sm: 'h-7 px-2.5 text-xs gap-1.5',
    md: 'h-8 px-3 text-sm gap-2',
  };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 disabled:cursor-not-allowed disabled:opacity-60 ${sizes[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-white ${className}`}
      {...props}
    />
  );
}

export function Badge({ substate, className = '' }: { substate: Substate | null; className?: string }) {
  if (!substate) return null;
  const live = substate === 'running' || substate === 'refining';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[11px] leading-4 ${SUBSTATE_STYLE[substate]} ${className}`}
    >
      {live ? <Loader2 size={10} className="animate-spin" /> : null}
      {SUBSTATE_LABELS[substate]}
    </span>
  );
}

export function ColumnPill({ column }: { column: Column }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-semibold text-[11px] uppercase tracking-wide ${COLUMN_PILL[column]}`}
    >
      {COLUMN_LABELS[column]}
    </span>
  );
}

export function Chip({
  children,
  className = '',
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300 ${className}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} aria-label="loading" />;
}

export function Card({
  children,
  className = '',
  title,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {title ? (
        <header className="flex items-center justify-between gap-2 border-zinc-100 border-b px-4 py-2.5 dark:border-zinc-800">
          <h3 className="font-semibold text-sm text-zinc-800 dark:text-zinc-100">{title}</h3>
          {actions}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-900/40 p-4 backdrop-blur-[2px]"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-center justify-between border-zinc-100 border-b px-5 py-3 dark:border-zinc-800">
          <h2 className="font-semibold text-base">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="px-5 py-4 text-sm">{children}</div>
        {footer ? (
          <footer className="flex justify-end gap-2 border-zinc-100 border-t px-5 py-3 dark:border-zinc-800">
            {footer}
          </footer>
        ) : null}
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
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const node = state ? (
    <Modal
      title={state.title}
      onClose={() => close(false)}
      footer={
        <>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant={state.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
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

export function Field({
  label,
  children,
  hint,
  inline,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  inline?: boolean;
}) {
  return (
    <label className={`block text-sm ${inline ? 'flex items-center gap-2' : ''}`}>
      <span className={`${inline ? '' : 'mb-1 block'} font-medium text-zinc-700 dark:text-zinc-300`}>
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:disabled:bg-zinc-800/60';

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 text-sm ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !disabled && onChange(!checked)}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${checked ? 'bg-accent-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`}
        />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function EmptyState({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-zinc-300 border-dashed p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
      {icon}
      <div>{children}</div>
    </div>
  );
}

/** Two-column definition list; `k` doubles as the React key so labels must be unique. */
export function KeyValue({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-1.5 text-xs">
      {items.map((it) => (
        <div key={it.k} className="contents">
          <dt className="text-zinc-500">{it.k}</dt>
          <dd className="min-w-0 break-words text-zinc-800 dark:text-zinc-200">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}
