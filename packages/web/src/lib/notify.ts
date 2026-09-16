/**
 * Browser notifications for task milestones (Review reached, run failed).
 * Opt-in per browser; the preference is remembered in localStorage.
 */
const KEY = 'ak.notifications';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationsEnabled(): boolean {
  try {
    return (
      notificationsSupported() && Notification.permission === 'granted' && localStorage.getItem(KEY) === '1'
    );
  } catch {
    return false;
  }
}

/** Ask for permission (if needed) and toggle the preference. Returns the new state. */
export async function setNotificationsEnabled(enabled: boolean): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (!enabled) {
    localStorage.setItem(KEY, '0');
    return false;
  }
  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  const ok = permission === 'granted';
  localStorage.setItem(KEY, ok ? '1' : '0');
  return ok;
}

export function notify(title: string, body: string, tag?: string): void {
  if (!notificationsEnabled()) return;
  try {
    const n = new Notification(title, { body, tag, icon: '/favicon.ico' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* notifications can throw in some contexts (e.g. insecure origins) */
  }
}
