import { Bell, BellOff, ChevronDown, LayoutDashboard, Plug, Settings, Wifi, WifiOff } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useProjects } from '../api/queries';
import { notificationsEnabled, notificationsSupported, setNotificationsEnabled } from '../lib/notify';
import { IconButton } from './ui';
import { useToast } from './ui/Toast';

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-lg bg-accent-600 text-white shadow-sm"
      style={{ width: size + 8, height: size + 8 }}
    >
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect x="7" y="8" width="5" height="16" rx="1.5" fill="currentColor" />
        <rect x="13.5" y="8" width="5" height="10" rx="1.5" fill="currentColor" opacity=".85" />
        <rect x="20" y="8" width="5" height="13" rx="1.5" fill="currentColor" opacity=".7" />
      </svg>
    </span>
  );
}

/** Bell toggle for browser notifications (Review reached, run failed, planner questions). */
function NotificationToggle() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(notificationsEnabled());
  if (!notificationsSupported()) return null;
  return (
    <IconButton
      label={enabled ? 'Notifications on (click to disable)' : 'Enable browser notifications'}
      className={enabled ? 'text-accent-600 dark:text-accent-300' : ''}
      onClick={async () => {
        const next = await setNotificationsEnabled(!enabled);
        setEnabled(next);
        if (!enabled && !next)
          toast.push({ kind: 'error', text: 'Notifications were blocked by the browser' });
      }}
    >
      {enabled ? <Bell size={16} /> : <BellOff size={16} />}
    </IconButton>
  );
}

export function Shell({
  projectId,
  live,
  right,
  center,
  children,
}: {
  projectId?: string;
  live?: 'connecting' | 'open' | 'reconnecting';
  /** Right-aligned header content (actions). */
  right?: ReactNode;
  /** Header content between the breadcrumb and the actions (search/filters). */
  center?: ReactNode;
  children: ReactNode;
}) {
  const projects = useProjects();
  const navigate = useNavigate();
  const location = useLocation();
  const onSettings = location.pathname.endsWith('/settings') || location.pathname.endsWith('/integration');
  const current = projects.data?.find((p) => p.id === projectId);
  return (
    <div className="flex h-full flex-col">
      <header className="z-20 flex h-12 shrink-0 items-center gap-3 border-zinc-200 border-b bg-white/90 px-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <Link to="/" className="flex items-center gap-2 font-semibold text-sm">
          <Logo />
          <span className="hidden sm:inline">Agent Kanban</span>
        </Link>
        {projectId ? (
          <>
            <span className="text-zinc-300 dark:text-zinc-700">/</span>
            <div className="relative">
              <select
                aria-label="Project"
                className="h-8 cursor-pointer appearance-none rounded-md border border-transparent bg-transparent py-1 pr-7 pl-2 font-medium text-sm hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                value={projectId}
                onChange={(e) => navigate(`/p/${e.target.value}`)}
              >
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                )) ?? <option value={projectId}>…</option>}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute top-2.5 right-2 text-zinc-400" />
            </div>
            {current ? (
              <span className="hidden max-w-[28ch] truncate font-mono text-[11px] text-zinc-400 xl:inline">
                {current.repo_path}
              </span>
            ) : null}
          </>
        ) : null}
        {center ? (
          <div className="ml-2 flex min-w-0 flex-1 items-center gap-2">{center}</div>
        ) : (
          <span className="flex-1" />
        )}
        {live ? (
          <span
            className={`hidden items-center gap-1 rounded-full px-2 py-0.5 text-[11px] sm:inline-flex ${
              live === 'open'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
            }`}
            title={`event stream: ${live}`}
          >
            {live === 'open' ? <Wifi size={11} /> : <WifiOff size={11} />}
            {live === 'open' ? 'live' : live}
          </span>
        ) : null}
        {right}
        <NotificationToggle />
        {projectId ? (
          onSettings ? (
            <Link to={`/p/${projectId}`}>
              <IconButton label="Back to the board">
                <LayoutDashboard size={16} />
              </IconButton>
            </Link>
          ) : (
            <>
              <Link to={`/p/${projectId}/integration`}>
                <IconButton label="Issue tracker integration">
                  <Plug size={16} />
                </IconButton>
              </Link>
              <Link to={`/p/${projectId}/settings`}>
                <IconButton label="Project settings">
                  <Settings size={16} />
                </IconButton>
              </Link>
            </>
          )
        ) : null}
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
