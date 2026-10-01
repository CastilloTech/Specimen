import { useState } from 'react';
import type { Progress } from '../modes';
import { disableReminders, enableReminders, reminderSupport, remindersOn } from '../reminders';

/** "Remind me when a new challenge is ready": off by default, and honest about where it can work. */
export function ReminderToggle({ p }: { p: Progress | null }) {
  const support = reminderSupport();
  const [on, setOn] = useState(remindersOn);
  const [note, setNote] = useState<string | null>(null);
  const toggle = async () => {
    if (on) {
      await disableReminders(p);
      setOn(false);
      setNote(null);
      return;
    }
    const r = await enableReminders(p);
    setOn(r === 'on');
    setNote(r === 'denied' ? 'Notifications are blocked for this app. Allow them in your browser settings to turn this on.' : r === 'failed' ? "Your browser didn't accept the reminder. It may need the app installed, or it doesn't support background reminders." : 'You get at most one reminder a day, between 9:00 and 22:00, only if today’s challenge isn’t won yet.');
  };
  return (
    <section className="lab-panel rounded-xl border border-line p-2.5 text-xs" aria-label="Daily reminder">
      <div className="flex items-center gap-2">
        <span aria-hidden>🔔</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">Daily reminder</span>
          <span className="block text-ink2">
            {support === 'ok'
              ? 'A notification when a new challenge is ready and you haven’t won today.'
              : support === 'install'
                ? 'Install the app (Add to Home screen) in Chrome or Edge to get reminders.'
                : 'This browser can’t send reminders while the game is closed. Installed Chrome or Edge (Android, desktop) can.'}
          </span>
        </span>
        {support === 'ok' && (
          <button onClick={toggle} role="switch" aria-checked={on} className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-panel2'}`} aria-label="Daily reminder">
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        )}
      </div>
      {note && <p className="mt-1.5 text-[11px] text-mute">{note}</p>}
    </section>
  );
}
