import { createContext, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PlayerId } from '../../engine';
import type { ArenaStage, Box, Side } from '../three/arena';
import type { Anchors, StageEvent, StageState } from '../three/actor';
import { CAM_VIEWS, camView, cinematic, setCamView, use3dPref, useCamPrefs } from '../three/pref';
import type { ClashEvent } from './ClashFx';

// The 3D arena behind the board: both Specimens in one scene. Each Specimen on the page registers its box and
// sends what's on its body; the arena draws the creature standing in that box (in the Broadcast view) and sends
// back where its sockets are, so the plates line up. With 3D off, this is just its children.

const Arena3D = lazy(() => import('../three/Arena3D'));

interface ArenaApi {
  /** A Specimen's box on the page (null when it goes). */
  box: (player: PlayerId, el: HTMLElement | null) => void;
  /** What's on a Specimen's body, and what just happened to it. */
  publish: (player: PlayerId, state: StageState, events: { id: number; ev: StageEvent }[]) => void;
}
export const ArenaCtx = createContext<ArenaApi | null>(null);
/** Where each Specimen's sockets are (percent of its box), and whether the plates' lines should show. */
export const ArenaViewCtx = createContext<{ anchors: Partial<Record<PlayerId, Anchors>>; lines: boolean }>({ anchors: {}, lines: true });

/** An element's place inside an ancestor, ignoring transforms (a clash lunge mustn't move the layout). */
function offsetWithin(el: HTMLElement, root: HTMLElement): Box | null {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    const parent = n.offsetParent as HTMLElement | null;
    if (parent && parent !== root && !root.contains(parent)) return null;
    n = parent;
  }
  if (n !== root) return null;
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

interface Props {
  /** Who stands on the left (the viewer) and on the right. */
  left: PlayerId;
  right: PlayerId;
  clash: ClashEvent | null;
  children: ReactNode;
}

export function Arena(props: Props) {
  const on3d = use3dPref();
  if (!on3d) return <>{props.children}</>;
  return <ArenaOn {...props} />;
}

function ArenaOn({ left, right, clash, children }: Props) {
  const layer = useRef<HTMLDivElement | null>(null);
  const stage = useRef<ArenaStage | null>(null);
  const els = useRef(new Map<PlayerId, HTMLElement>());
  const boxes = useRef(new Map<PlayerId, Box>());
  const latest = useRef(new Map<PlayerId, { state: StageState; events: { id: number; ev: StageEvent }[] }>());
  const seen = useRef(new Map<PlayerId, number>());
  const [anchors, setAnchors] = useState<Partial<Record<PlayerId, Anchors>>>({});
  const [lines, setLines] = useState(false);
  const cam = useCamPrefs();
  const sideOf = useCallback((p: PlayerId): Side => (p === left ? 'left' : 'right'), [left]);

  /** The sockets, from canvas pixels to percent of each Specimen's box. */
  const readAnchors = useCallback(() => {
    const st = stage.current;
    if (!st) return;
    const next: Partial<Record<PlayerId, Anchors>> = {};
    for (const p of [left, right]) {
      const b = boxes.current.get(p);
      const px = st.anchors(sideOf(p));
      if (!b || !Object.keys(px).length) continue;
      const a: Anchors = {};
      for (const [slot, v] of Object.entries(px) as [keyof Anchors, { x: number; y: number }][]) a[slot] = { x: ((v.x - b.x) / b.w) * 100, y: ((v.y - b.y) / b.h) * 100 };
      next[p] = a;
    }
    setAnchors(next);
  }, [left, right, sideOf]);

  const measure = useCallback(() => {
    const root = layer.current?.parentElement;
    if (!root) return;
    const out: Partial<Record<Side, Box>> = {};
    for (const p of [left, right]) {
      const el = els.current.get(p);
      const b = el ? offsetWithin(el, root) : null;
      if (b) {
        boxes.current.set(p, b);
        out[sideOf(p)] = b;
      } else boxes.current.delete(p);
    }
    stage.current?.setBoxes(out);
  }, [left, right, sideOf]);

  // The boxes move when the page reflows; re-measure then.
  const ro = useMemo(() => (typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())), [measure]);
  useEffect(() => () => ro?.disconnect(), [ro]);

  const api = useMemo<ArenaApi>(
    () => ({
      box: (player, el) => {
        const had = els.current.get(player);
        if (had) ro?.unobserve(had);
        if (el) {
          els.current.set(player, el);
          ro?.observe(el);
        } else els.current.delete(player);
        measure();
      },
      publish: (player, state, events) => {
        latest.current.set(player, { state, events });
        const st = stage.current;
        if (!st) return;
        st.setActor(sideOf(player), state);
        const last = seen.current.get(player) ?? 0;
        for (const { id, ev } of events) if (id > last) st.fire(sideOf(player), ev);
        seen.current.set(player, events.at(-1)?.id ?? last);
      },
    }),
    [measure, ro, sideOf],
  );

  const onStage = useCallback(
    (st: ArenaStage | null) => {
      stage.current = st;
      if (!st) return;
      st.onLayout = readAnchors;
      st.onLines = setLines;
      st.setView(camView());
      st.setCinematic(cinematic());
      // Catch up on what's on each body (but don't replay old events).
      for (const [p, { state, events }] of latest.current) {
        st.setActor(sideOf(p), state);
        seen.current.set(p, events.at(-1)?.id ?? 0);
      }
      measure();
    },
    [measure, readAnchors, sideOf],
  );

  useEffect(() => {
    stage.current?.setView(cam.view);
    stage.current?.setCinematic(cam.cinematic);
  }, [cam.view, cam.cinematic]);

  const lastClash = useRef(0);
  useEffect(() => {
    if (!clash || clash.key === lastClash.current) return;
    lastClash.current = clash.key;
    stage.current?.clash({ kind: 'clash', hits: clash.hits.map((h) => ({ side: sideOf(h.target), dmg: h.hold ? 0 : h.dmg, big: h.big, hold: h.hold })) });
  }, [clash, sideOf]);

  const view = useMemo(() => ({ anchors, lines }), [anchors, lines]);
  return (
    <>
      {/* Behind everything in the arena (its section isolates it, so it stays above the section's own background). */}
      <div ref={layer} className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
        <Suspense fallback={null}>
          <Arena3D onStage={onStage} onSize={measure} />
        </Suspense>
      </div>
      <ArenaCtx.Provider value={api}>
        <ArenaViewCtx.Provider value={view}>{children}</ArenaViewCtx.Provider>
      </ArenaCtx.Provider>
    </>
  );
}

/** Switches the arena camera to its next view (shown only while 3D is on). */
export function CamButton({ className = '', compact }: { className?: string; compact?: boolean }) {
  const on3d = use3dPref();
  const { view } = useCamPrefs();
  if (!on3d) return null;
  const i = CAM_VIEWS.findIndex((c) => c.id === view);
  const next = CAM_VIEWS[(i + 1) % CAM_VIEWS.length];
  return (
    <button type="button" onClick={() => setCamView(next.id)} className={`flex items-center gap-1 whitespace-nowrap rounded border border-line bg-black/50 px-1.5 text-[10px] text-ink2 ${className}`} title={`Camera: ${CAM_VIEWS[i]?.name ?? 'Broadcast'}. Tap for ${next.name}.`} aria-label={`Camera view: ${CAM_VIEWS[i]?.name ?? 'Broadcast'}. Switch to ${next.name}.`}>
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="2" y="6" width="14" height="12" rx="2" />
        <path d="M16 10l6-3v10l-6-3z" />
      </svg>
      <span className={compact ? 'hidden min-[760px]:inline' : ''}>{CAM_VIEWS[i]?.name ?? 'Broadcast'}</span>
    </button>
  );
}
