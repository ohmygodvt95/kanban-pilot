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
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 max-w-[90vw] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-md px-3 py-2 text-sm shadow-lg ${
              t.kind === 'error'
                ? 'bg-red-600 text-white'
                : t.kind === 'success'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900'
            }`}
          >
            {t.text}
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
