/**
 * App frame: a single-row header that stays uncluttered at every width. Secondary
 * actions (import, clear…) always live in the ⋯ menu; the navigation icons and
 * the live/stats badges join that menu on small screens, so the row never wraps.
 *
 *   ≥ md : logo · project · center · stats · primary · nav icons · [⋯ actions]
 *   < md : logo · project · center · primary · [⋯ actions + nav + status]
 */
import {
  Bell,
  BellOff,
  ChevronDown,
  LayoutDashboard,
  MoreVertical,
  Plug,
  Settings,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useProjects } from '../api/queries';
import { notificationsEnabled, notificationsSupported, setNotificationsEnabled } from '../lib/notify';
import { Button, IconButton, type MenuItem, MenuRow, Popover } from './ui';
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

/** A header action: the primary one is always visible, the rest fold into the overflow menu. */
export interface ShellAction extends MenuItem {
  primary?: boolean;
}

/** Browser-notification toggle state shared by the icon button and the menu row. */
function useNotificationToggle() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(notificationsEnabled());
  const toggle = async () => {
    const next = await setNotificationsEnabled(!enabled);
    setEnabled(next);
    if (!enabled && !next) toast.push({ kind: 'error', text: 'Notifications were blocked by the browser' });
  };
  return { supported: notificationsSupported(), enabled, toggle };
}

export function Shell({
  projectId,
  live,
  center,
  info,
  actions = [],
  subheader,
  children,
}: {
  projectId?: string;
  live?: 'connecting' | 'open' | 'reconnecting';
  /** Header content between the breadcrumb and the actions (search/filters). */
  center?: ReactNode;
  /** Short read-only status text (counts, cost); inline on wide screens, in the menu otherwise. */
  info?: ReactNode;
  actions?: ShellAction[];
  /** Optional second header row (e.g. filters revealed on small screens). */
  subheader?: ReactNode;
  children: ReactNode;
}) {
  const projects = useProjects();
  const navigate = useNavigate();
  const location = useLocation();
  const notify = useNotificationToggle();
  const onSettings = location.pathname.endsWith('/settings') || location.pathname.endsWith('/integration');
  const current = projects.data?.find((p) => p.id === projectId);
  const primary = actions.filter((a) => a.primary);
  const secondary = actions.filter((a) => !a.primary);

  // Navigation entries, rendered as icons (≥ md) or as menu rows (< md).
  const nav: (MenuItem & { to: string })[] = projectId
    ? onSettings
      ? [{ label: 'Back to the board', icon: <LayoutDashboard />, to: `/p/${projectId}` }]
      : [
          { label: 'Issue tracker integration', icon: <Plug />, to: `/p/${projectId}/integration` },
          { label: 'Project settings', icon: <Settings />, to: `/p/${projectId}/settings` },
        ]
    : [];
  const notifyItem: MenuItem | null = notify.supported
    ? {
        label: notify.enabled ? 'Notifications on' : 'Enable notifications',
        icon: notify.enabled ? <Bell /> : <BellOff />,
        active: notify.enabled,
        onClick: () => void notify.toggle(),
      }
    : null;
  const hasMenu = secondary.length > 0 || nav.length > 0 || notifyItem !== null || !!info || !!live;

  const liveBadge = live ? (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
        live === 'open'
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
      }`}
      title={`event stream: ${live}`}
    >
      {live === 'open' ? <Wifi size={11} /> : <WifiOff size={11} />}
      {live === 'open' ? 'live' : live}
    </span>
  ) : null;

  return (
    <div className="flex h-full flex-col">
      <header className="z-20 shrink-0 border-zinc-200 border-b bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="flex h-12 items-center gap-2 px-3 sm:gap-3">
          <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold text-sm">
            <Logo />
            <span className="hidden 2xl:inline">Agent Kanban</span>
          </Link>
          {projectId ? (
            <>
              <span className="hidden text-zinc-300 sm:inline dark:text-zinc-700">/</span>
              <div className="relative min-w-0 max-w-[38vw] shrink sm:max-w-[24ch]">
                <select
                  aria-label="Project"
                  className="h-8 w-full cursor-pointer appearance-none truncate rounded-md border border-transparent bg-transparent py-1 pr-7 pl-2 font-medium text-sm hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                  value={projectId}
                  onChange={(e) => navigate(`/p/${e.target.value}`)}
                >
                  {projects.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  )) ?? <option value={projectId}>…</option>}
                </select>
                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute top-2.5 right-2 text-zinc-400"
                />
              </div>
              {current ? (
                <span className="hidden max-w-[28ch] truncate font-mono text-[11px] text-zinc-400 2xl:inline">
                  {current.repo_path}
                </span>
              ) : null}
            </>
          ) : null}

          {center ? (
            <div className="flex min-w-0 flex-1 items-center gap-2" data-tour="center">
              {center}
            </div>
          ) : (
            <span className="flex-1" />
          )}

          {info ? (
            <span className="hidden shrink-0 text-[11px] text-zinc-500 xl:inline-flex">{info}</span>
          ) : null}
          {liveBadge ? <span className="hidden shrink-0 md:inline-flex">{liveBadge}</span> : null}
          {primary.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant="primary"
              icon={<span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{a.icon}</span>}
              title={a.title}
              disabled={a.disabled}
              onClick={a.onClick}
              className="shrink-0"
            >
              <span className="hidden sm:inline">{a.label}</span>
            </Button>
          ))}

          {/* nav icons from md up */}
          <div className="hidden shrink-0 items-center md:flex" data-tour="nav">
            {notifyItem ? (
              <IconButton
                label={
                  notify.enabled ? 'Notifications on (click to disable)' : 'Enable browser notifications'
                }
                className={notify.enabled ? 'text-accent-600 dark:text-accent-300' : ''}
                onClick={() => void notify.toggle()}
              >
                {notify.enabled ? <Bell size={16} /> : <BellOff size={16} />}
              </IconButton>
            ) : null}
            {nav.map((n) => (
              <Link key={n.to} to={n.to}>
                <IconButton label={n.label}>
                  <span className="[&>svg]:h-4 [&>svg]:w-4">{n.icon}</span>
                </IconButton>
              </Link>
            ))}
          </div>

          {/* overflow menu: always holds the secondary actions; nav/status join it below md */}
          {hasMenu ? (
            <Popover
              className="shrink-0"
              button={({ toggle }) => (
                <IconButton label="More" onClick={toggle} data-tour="menu">
                  <MoreVertical size={16} />
                </IconButton>
              )}
            >
              {(close) => (
                <div className="w-56">
                  {info || liveBadge ? (
                    <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-[11px] text-zinc-500 md:hidden">
                      {liveBadge}
                      {info}
                    </div>
                  ) : null}
                  {secondary.map((a) => (
                    <MenuRow key={a.label} item={a} onPick={close} />
                  ))}
                  {secondary.length && (nav.length || notifyItem) ? (
                    <div className="my-1 border-zinc-200 border-t md:hidden dark:border-zinc-700" />
                  ) : null}
                  <div className="md:hidden">
                    {notifyItem ? <MenuRow item={notifyItem} onPick={close} /> : null}
                    {nav.map((n) => (
                      <MenuRow key={n.to} item={{ ...n, onClick: () => navigate(n.to) }} onPick={close} />
                    ))}
                  </div>
                </div>
              )}
            </Popover>
          ) : null}
        </div>
        {subheader ? (
          <div className="flex items-center gap-2 overflow-x-auto border-zinc-200 border-t px-3 py-1.5 dark:border-zinc-800">
            {subheader}
          </div>
        ) : null}
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
