import { useState } from 'react';
import type { ReactNode } from 'react';

const KEY = 'specimen.ui.collapsed';
function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

/**
 * A panel whose title bar opens and closes it. Whether each one is open is remembered on this device
 * (a per-viewer convenience: if storage is unavailable, it just falls back to `defaultOpen`).
 */
export function Collapsible({ id, title, meta, defaultOpen = true, bodyClass = '', children }: { id: string; title: ReactNode; meta?: ReactNode; defaultOpen?: boolean; bodyClass?: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => {
    const saved = readCollapsed()[id];
    return saved === undefined ? defaultOpen : !saved;
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...readCollapsed(), [id]: !next }));
    } catch {
      /* not remembered this time */
    }
  };
  return (
    <section className="lab-panel rounded-xl border border-line" aria-label={typeof title === 'string' ? title : id}>
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls={`panel-${id}`} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {meta && <span className="min-w-0 truncate text-xs text-mute">{meta}</span>}
        <span className={`ml-auto shrink-0 text-ink2 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div id={`panel-${id}`} className={`px-4 pb-4 ${bodyClass}`}>
          {children}
        </div>
      )}
    </section>
  );
}
