/**
 * Ctrl/⌘+K palette: jump to a task of the current project, switch project, or run
 * a board action. Type `>` to list actions only. Pure keyboard: ↑↓ Enter Esc.
 */
import type { Project, Task } from '@agent-kanban/shared';
import { Command, CornerDownLeft, FolderGit2, Search, Zap } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFocusTrap } from '../lib/focus-trap';
import { useI18n } from '../lib/i18n';
import { COLUMN_LABELS } from '../lib/state';

export interface PaletteAction {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  run: () => void;
}

interface Row {
  key: string;
  group: 'tasks' | 'actions' | 'projects';
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
}

export function CommandPalette({
  tasks,
  projects,
  actions,
  onOpenTask,
  onClose,
}: {
  tasks: Task[];
  projects: Project[];
  actions: PaletteAction[];
  onOpenTask: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useFocusTrap(box);
  useEffect(() => input.current?.focus(), []);

  const rows = useMemo<Row[]>(() => {
    const actionsOnly = query.startsWith('>');
    const q = (actionsOnly ? query.slice(1) : query).trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const out: Row[] = [];
    if (!actionsOnly)
      for (const task of tasks.filter((x) => match(x.title) || x.id.toLowerCase() === q).slice(0, 8))
        out.push({
          key: `t:${task.id}`,
          group: 'tasks',
          label: task.title,
          hint: COLUMN_LABELS[task.column],
          icon: <Search size={14} />,
          run: () => onOpenTask(task.id),
        });
    for (const a of actions.filter((a) => match(a.label)))
      out.push({
        key: `a:${a.id}`,
        group: 'actions',
        label: a.label,
        hint: a.hint,
        icon: a.icon ?? <Zap size={14} />,
        run: a.run,
      });
    if (!actionsOnly)
      for (const p of projects.filter((p) => match(p.name)).slice(0, 5))
        out.push({
          key: `p:${p.id}`,
          group: 'projects',
          label: p.name,
          hint: p.repo_path,
          icon: <FolderGit2 size={14} />,
          run: () => navigate(`/p/${p.id}`),
        });
    return out;
  }, [query, tasks, actions, projects, navigate, onOpenTask]);

  // reset the highlight whenever the query changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: query drives the row list
  useEffect(() => setCursor(0), [query]);
  const pick = (row: Row | undefined) => {
    if (!row) return;
    onClose();
    row.run();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setCursor((c) => Math.min(rows.length - 1, c + 1));
    else if (e.key === 'ArrowUp') setCursor((c) => Math.max(0, c - 1));
    else if (e.key === 'Enter') pick(rows[cursor]);
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
  };

  let lastGroup: Row['group'] | null = null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-900/40 p-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={t('menu.palette')}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <div className="flex items-center gap-2 border-zinc-200 border-b px-3 dark:border-zinc-800">
          <Command size={16} className="text-zinc-400" />
          <input
            ref={input}
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1">
          {rows.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-zinc-500">{t('palette.empty')}</li>
          ) : null}
          {rows.map((row, i) => {
            const header = row.group !== lastGroup;
            lastGroup = row.group;
            return (
              <li key={row.key}>
                {header ? (
                  <div className="px-3 pt-2 pb-1 font-medium text-[10px] text-zinc-400 uppercase tracking-wide">
                    {t(`palette.${row.group}`)}
                  </div>
                ) : null}
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
                    i === cursor
                      ? 'bg-accent-50 text-accent-800 dark:bg-accent-900/40 dark:text-accent-100'
                      : 'text-zinc-700 dark:text-zinc-200'
                  }`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(row)}
                >
                  <span className="w-4 shrink-0 text-zinc-400">{row.icon}</span>
                  <span className="flex-1 truncate">{row.label}</span>
                  {row.hint ? (
                    <span className="max-w-[40%] truncate text-[11px] text-zinc-400">{row.hint}</span>
                  ) : null}
                  {i === cursor ? <CornerDownLeft size={12} className="text-zinc-400" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-zinc-200 border-t px-3 py-1.5 text-[11px] text-zinc-400 dark:border-zinc-800">
          {t('palette.hint')}
        </div>
      </div>
    </div>
  );
}
