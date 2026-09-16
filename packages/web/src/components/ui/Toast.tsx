import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export interface ToastItem {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

interface ToastApi {
  push(t: Omit<ToastItem, 'id'>): void;
  error(err: unknown, prefix?: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((old) => [...old, { ...t, id }]);
    setTimeout(() => setItems((old) => old.filter((x) => x.id !== id)), t.kind === 'error' ? 8000 : 4000);
  }, []);
  const api = useMemo<ToastApi>(
    () => ({
      push,
      error: (err, prefix) => {
        const message = err instanceof Error ? err.message : String(err);
        push({ kind: 'error', text: prefix ? `${prefix}: ${message}` : message });
      },
    }),
    [push],
  );
  const icons = {
    error: <AlertCircle size={16} />,
    success: <CheckCircle2 size={16} />,
    info: <Info size={16} />,
  };
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 max-w-[90vw] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg backdrop-blur ${
              t.kind === 'error'
                ? 'border-red-200 bg-red-50/95 text-red-900 dark:border-red-900 dark:bg-red-950/90 dark:text-red-100'
                : t.kind === 'success'
                  ? 'border-emerald-200 bg-emerald-50/95 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/90 dark:text-emerald-100'
                  : 'border-zinc-200 bg-white/95 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800/95 dark:text-zinc-100'
            }`}
          >
            <span className="mt-0.5 shrink-0">{icons[t.kind]}</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('ToastProvider missing');
  return ctx;
}
