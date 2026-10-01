import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

// Cards in the hand that feel like cards: they tilt toward the cursor, press down under a finger, and can be
// dragged onto the board to play (a graft onto your slot, a Sabotage onto their graft, an instant anywhere
// above the hand). Tapping still works exactly as before; dragging is an extra way, never the only one.

const DRAG_START_PX = 12;

interface Drag {
  uid: string;
  x: number;
  y: number;
  ghost: ReactNode;
}

/**
 * `onStart` (the card is picked up: select it so its targets glow) and `onDrop` (released over this element,
 * or nothing). Returns per-card handlers and the ghost that follows the pointer.
 */
export function useHandDrag(enabled: boolean, onStart: (uid: string) => void, onDrop: (uid: string, target: Element | null) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const down = useRef<{ uid: string; x: number; y: number; moved: boolean; ghost: ReactNode } | null>(null);
  const swallowClick = useRef(false);
  const cb = useRef({ onStart, onDrop });
  cb.current = { onStart, onDrop };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = down.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_START_PX) return;
      if (!d.moved) {
        d.moved = true;
        cb.current.onStart(d.uid);
      }
      setDrag({ uid: d.uid, x: e.clientX, y: e.clientY, ghost: d.ghost });
    };
    const up = (e: PointerEvent) => {
      const d = down.current;
      down.current = null;
      if (!d?.moved) return;
      swallowClick.current = true; // the click that follows a drag is not a tap
      setDrag(null);
      cb.current.onDrop(d.uid, document.elementFromPoint(e.clientX, e.clientY));
    };
    const cancel = () => {
      down.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);

  /** Props for one card's wrapper. `ghost` is what follows the pointer while it's dragged; unplayable cards don't drag. */
  const bind = (uid: string, ghost: ReactNode, canDrag = true) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      if (!enabled || !canDrag || e.button !== 0) return;
      down.current = { uid, x: e.clientX, y: e.clientY, moved: false, ghost };
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
    'data-dragging': drag?.uid === uid ? 'true' : undefined,
  });

  const ghost = drag ? (
    <div className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-[85%] rotate-[-4deg] opacity-90 drop-shadow-[0_12px_18px_rgba(0,0,0,0.7)]" style={{ left: drag.x, top: drag.y }} aria-hidden>
      {drag.ghost}
    </div>
  ) : null;
  return { bind, ghost, dragging: drag?.uid ?? null };
}

/** Tilt toward the cursor (mouse only): sets --rx / --ry on the card's wrapper; the CSS does the rest. */
export const tiltHandlers = {
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    e.currentTarget.style.setProperty('--rx', `${(-py * 10).toFixed(1)}deg`);
    e.currentTarget.style.setProperty('--ry', `${(px * 12).toFixed(1)}deg`);
  },
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => {
    e.currentTarget.style.setProperty('--rx', '0deg');
    e.currentTarget.style.setProperty('--ry', '0deg');
  },
};
export const tiltStyle: CSSProperties = { touchAction: 'none' };
