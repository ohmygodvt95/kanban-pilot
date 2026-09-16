/**
 * API access token (only required when the server is bound to a non-loopback
 * address). The CLI prints a URL with `?token=…`; the first page load stores it
 * and strips it from the address bar so it never lingers in history/bookmarks.
 */
const KEY = 'agent-kanban.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Call once at start-up: adopt `?token=` from the URL. */
export function captureTokenFromUrl(): void {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (!token) return;
  setToken(token);
  url.searchParams.delete('token');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/** Query-string form for EventSource (which cannot send headers). */
export function tokenQuery(): string {
  const t = getToken();
  return t ? `&token=${encodeURIComponent(t)}` : '';
}

/** Fired by the API client on 401 so the app can ask for a token. */
export const UNAUTHORIZED_EVENT = 'agent-kanban:unauthorized';
