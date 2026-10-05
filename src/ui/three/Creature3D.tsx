import { useEffect, useRef } from 'react';
import { SpecimenStage } from './stage';
import type { Anchors, StageEvent, StageState } from './stage';
import { disable3dForNow } from './pref';

// The Specimen in 3D, filling its container (loaded on demand, with three.js, only where 3D is on). The match
// passes what's on the body (state) and what just happened (events, each with its own id); the stage animates
// the rest. It reports where the graft sockets are on screen (anchors), so the plates can point at them.

export interface Creature3DProps {
  /** Turns the creature: positive faces right (the left-hand Specimen faces its opponent). */
  yaw?: number;
  /** Closer in (the menu's portrait), or the whole body (the board). */
  zoom?: number;
  state: StageState;
  events?: { id: number; ev: StageEvent }[];
  onAnchors?: (a: Anchors) => void;
  className?: string;
}

export default function Creature3D({ yaw = 0, zoom = 1, state, events, onAnchors, className = '' }: Creature3DProps) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const stage = useRef<SpecimenStage | null>(null);
  const seen = useRef(0);
  const anchorsCb = useRef(onAnchors);
  anchorsCb.current = onAnchors;

  useEffect(() => {
    const el = wrap.current!;
    let st: SpecimenStage;
    try {
      st = new SpecimenStage(canvas.current!, { yaw, zoom });
    } catch {
      disable3dForNow();
      return;
    }
    stage.current = st;
    const report = () => anchorsCb.current?.(st.anchors());
    const size = () => {
      const r = el.getBoundingClientRect();
      st.setSize(Math.round(r.width), Math.round(r.height));
      report();
    };
    st.whenReady(report);
    const ro = new ResizeObserver(size);
    ro.observe(el);
    size();
    // Only animate while visible: off screen or in a hidden tab, it rests.
    let onScreen = true;
    const run = () => st.setRunning(onScreen && document.visibilityState === 'visible');
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      run();
    });
    io.observe(el);
    document.addEventListener('visibilitychange', run);
    run();
    const lost = (e: Event) => {
      e.preventDefault();
      disable3dForNow();
    };
    canvas.current!.addEventListener('webglcontextlost', lost);
    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', run);
      canvas.current?.removeEventListener('webglcontextlost', lost);
      st.dispose();
      stage.current = null;
    };
    // The stage is built once per mount; its look changes through state and events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stage.current?.setState(state);
  }, [state]);

  useEffect(() => {
    const st = stage.current;
    if (!st || !events) return;
    for (const { id, ev } of events) {
      if (id <= seen.current) continue;
      seen.current = id;
      st.fire(ev);
    }
  }, [events]);

  return (
    <div ref={wrap} className={`absolute inset-0 ${className}`} aria-hidden>
      <canvas ref={canvas} className="block h-full w-full" />
    </div>
  );
}
