// The daily reminder's state for the service worker, and support detection outside a browser.
import { describe, expect, it } from 'vitest';
import { chipsFor } from '../src/engine';
import { startProgress } from '../src/ui/modes';
import { reminderState, reminderSupport } from '../src/ui/reminders';

describe('Daily reminder', () => {
  const p = startProgress('predator', 'corrosion', chipsFor('corrosion')[0].id);

  it('tells the worker the day is won (no reminder) or not, the streak, and the next dispatch', () => {
    expect(reminderState(null, false, '2026-03-02')).toEqual({ on: false, wonDay: null, streak: 0, dispatch: 1 });
    const wonToday = { ...p, daily: { key: '2026-03-02', attempts: 1, won: true, bestHp: 10 }, dailyStreak: { count: 3, last: '2026-03-02', best: 3 }, dailyWins: 5 };
    expect(reminderState(wonToday, true, '2026-03-02')).toEqual({ on: true, wonDay: '2026-03-02', streak: 3, dispatch: 6 });
    // The next day: not won yet, the streak still alive, the next dispatch waiting.
    expect(reminderState(wonToday, true, '2026-03-03')).toEqual({ on: true, wonDay: '2026-03-02', streak: 3, dispatch: 6 });
  });

  it('reports no support where there is no browser', () => {
    expect(reminderSupport()).toBe('unsupported');
  });
});
