import { useEffect, useRef } from 'react';
import { ArenaStage } from './arena';
import { disable3dForNow } from './pref';

// The arena canvas, filling its container (loaded on demand, with three.js, only where 3D is on). It hands its
// stage to the page (onStage), which drives it; this only keeps it sized, and resting while out of sight.

export default function Arena3D({ onStage, onSize }: { onStage: (s: ArenaStage | null) => void; onSize: () => void }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const cbs = useRef({ onStage, onSize });
  cbs.current = { onStage, onSize };

  useEffect(() => {
    const el = wrap.current!;
    const cv = canvas.current!;
    let st: ArenaStage;
    try {
      st = new ArenaStage(cv);
    } catch {
      disable3dForNow();
      return;
    }
    const size = () => {
      const r = el.getBoundingClientRect();
      st.setSize(Math.round(r.width), Math.round(r.height));
      cbs.current.onSize();
    };
    const ro = new ResizeObserver(size);
    ro.observe(el);
    size();
    cbs.current.onStage(st);
    // Development only: the stage is reachable from the console (to try camera shots by hand).
    if (import.meta.env.DEV) (window as unknown as { __arena?: ArenaStage }).__arena = st;
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
    cv.addEventListener('webglcontextlost', lost);
    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', run);
      cv.removeEventListener('webglcontextlost', lost);
      cbs.current.onStage(null);
      st.dispose();
    };
  }, []);

  return (
    <div ref={wrap} className="absolute inset-0" aria-hidden>
      <canvas ref={canvas} className="block h-full w-full" />
    </div>
  );
}
