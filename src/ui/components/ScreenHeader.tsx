import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * The one header every full screen shares: a back button, the title (with an optional line under it), and a
 * slot on the right for the screen's own controls or counters.
 */
export function ScreenHeader({ title, sub, onBack, backLabel = 'Back', right, className = '' }: { title: ReactNode; sub?: ReactNode; onBack: () => void; backLabel?: string; right?: ReactNode; className?: string }) {
  // Esc is "back" on every screen, the same as in a match.
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return el.blur();
      if (document.querySelector('[role="dialog"]')) return; // the open sheet closes first
      back.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <header className={`flex items-center gap-2 ${className}`}>
      <button onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-ink2 hover:border-mute" aria-label={backLabel} title={backLabel}>
        ←
      </button>
      <div className="min-w-0">
        <h1 className="truncate font-display text-xl font-bold leading-tight">{title}</h1>
        {sub && <div className="truncate text-[11px] text-mute">{sub}</div>}
      </div>
      {right && <div className="ml-auto flex shrink-0 items-center gap-1.5">{right}</div>}
    </header>
  );
}
