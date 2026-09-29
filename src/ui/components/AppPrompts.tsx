import { useState } from 'react';
import { usePwa } from '../pwa';

const DISMISS = 'specimen.installDismissed';
const dismissed = () => {
  try {
    return localStorage.getItem(DISMISS) === '1';
  } catch {
    return false;
  }
};

/** "A new version is ready": shown outside matches; reloading switches to it. */
export function UpdateToast() {
  const { updateReady, applyUpdate } = usePwa();
  if (!updateReady) return null;
  return (
    <div className="coach-pop fixed bottom-3 left-1/2 z-[70] flex w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 items-center gap-2 rounded-xl border border-accent/70 bg-panel px-3 py-2 text-sm shadow-[0_8px_30px_rgba(0,0,0,0.6)]" role="status">
      <span className="min-w-0 flex-1">A new version of Specimen is ready.</span>
      <button onClick={applyUpdate} className="shrink-0 rounded-lg bg-accent px-3 py-1 text-xs font-bold text-black">
        Reload
      </button>
    </div>
  );
}

/** Menu card: install the game as an app (or, on iPhone and iPad, how to). */
export function InstallCard() {
  const { canPrompt, iosManual, install } = usePwa();
  const [hidden, setHidden] = useState(dismissed);
  const [howTo, setHowTo] = useState(false);
  if (hidden || (!canPrompt && !iosManual)) return null;
  const hide = () => {
    try {
      localStorage.setItem(DISMISS, '1');
    } catch {
      /* shown again next time */
    }
    setHidden(true);
  };
  return (
    <section className="lab-panel rounded-xl border border-line p-2 phone:rounded-lg phone:p-1.5" aria-label="Install the app">
      <div className="flex items-center gap-2">
        <img src="./icon-192.png" alt="" className="h-9 w-9 shrink-0 rounded-lg phone:h-7 phone:w-7" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-bold">Install Specimen</div>
          <div className="text-[11px] text-ink2 phone:hidden">Full screen, plays offline, and keeps your saves safer.</div>
        </div>
        <button onClick={() => (canPrompt ? void install() : setHowTo((v) => !v))} className="shrink-0 rounded-lg bg-accent px-3 py-1.5 font-display text-xs font-bold text-black">
          {canPrompt ? 'Install' : 'How?'}
        </button>
        <button onClick={hide} className="shrink-0 px-1 text-mute hover:text-ink" aria-label="Don't show again" title="Don't show again">
          ✕
        </button>
      </div>
      {howTo && (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-ink2">
          <li>
            Tap the <b className="text-ink">Share</b> button (the square with an arrow) in Safari.
          </li>
          <li>
            Choose <b className="text-ink">Add to Home Screen</b>, then <b className="text-ink">Add</b>.
          </li>
          <li>Open Specimen from your home screen.</li>
        </ol>
      )}
    </section>
  );
}
