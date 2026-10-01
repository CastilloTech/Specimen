import { dayKey, liveStreak } from './daily';
import type { Progress } from './modes';

// Daily reminder, opt-in and off by default. A web app can't schedule a notification on its own clock; the
// closest thing without a push server is Periodic Background Sync, which Chrome and Edge offer to an
// *installed* app (mostly Android). The service worker (sw-plugin.ts) wakes now and then, reads the state
// the page leaves in a cache, and shows one reminder a day if today's challenge isn't won yet.

const TAG = 'specimen-daily';
const PREF = 'specimen.reminder';
const STATE_CACHE = 'specimen-state';

export type ReminderSupport = 'ok' | 'install' | 'unsupported';

interface PeriodicSync {
  register(tag: string, opts: { minInterval: number }): Promise<void>;
  unregister(tag: string): Promise<void>;
}
type Reg = ServiceWorkerRegistration & { periodicSync?: PeriodicSync };

/** Whether this browser can remind at all, and whether the app has to be installed first. */
export function reminderSupport(): ReminderSupport {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) return 'unsupported';
  if (typeof ServiceWorkerRegistration === 'undefined' || !('periodicSync' in ServiceWorkerRegistration.prototype)) return 'unsupported';
  const installed = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return installed ? 'ok' : 'install';
}

export const remindersOn = (): boolean => {
  try {
    return localStorage.getItem(PREF) === '1';
  } catch {
    return false;
  }
};

/** What the service worker reads: on/off, the last day won, the streak, and the dispatch a win recovers next. */
export function reminderState(p: Progress | null, on: boolean, key = dayKey()) {
  const won = p?.daily?.key === key && p.daily.won;
  return { on, wonDay: won ? key : (p?.dailyStreak?.last ?? null), streak: p ? liveStreak(p, key) : 0, dispatch: (p?.dailyWins ?? 0) + 1 };
}

/** Keep the worker's copy current (after a daily attempt, and whenever the app opens). Never throws. */
export async function syncReminderState(p: Progress | null): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const prev = await (await caches.open(STATE_CACHE)).match('./__reminder');
    const notifiedDay = prev ? ((await prev.json()) as { notifiedDay?: string }).notifiedDay : undefined;
    await (await caches.open(STATE_CACHE)).put('./__reminder', new Response(JSON.stringify({ ...reminderState(p, remindersOn()), ...(notifiedDay ? { notifiedDay } : {}) })));
  } catch {
    /* reminders are best effort */
  }
}

/** Turn the reminder on: ask for notification permission, then register the periodic wake-up. */
export async function enableReminders(p: Progress | null): Promise<'on' | 'denied' | 'failed'> {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return 'denied';
    const reg = (await navigator.serviceWorker.ready) as Reg;
    if (!reg.periodicSync) return 'failed';
    await reg.periodicSync.register(TAG, { minInterval: 6 * 60 * 60 * 1000 });
    localStorage.setItem(PREF, '1');
    await syncReminderState(p);
    return 'on';
  } catch {
    return 'failed';
  }
}

export async function disableReminders(p: Progress | null): Promise<void> {
  try {
    localStorage.setItem(PREF, '0');
    const reg = (await navigator.serviceWorker.getRegistration()) as Reg | undefined;
    await reg?.periodicSync?.unregister(TAG);
  } catch {
    /* already off */
  }
  await syncReminderState(p);
}
