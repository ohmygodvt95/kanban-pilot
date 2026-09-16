export const formatCost = (usd: number | null | undefined) =>
  usd === null || usd === undefined ? '' : usd === 0 ? '$0.00' : usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;

export const formatTime = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
};

export const formatClock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';

export const relativeTime = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return '';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const s = Math.round(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
};

export const formatDuration = (start: string | null, end: string | null) => {
  if (!start) return '';
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
};

export const short = (id: string, n = 6) => id.slice(-n);

/** Fractional index between two neighbours. */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return (after as number) - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}
