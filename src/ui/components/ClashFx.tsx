import { useEffect, useRef, useState } from 'react';
import type { GameState, PlayerId } from '../../engine';

export interface ClashHit {
  target: PlayerId;
  dmg: number;
  note: string; // e.g. "halved by Fortify, +1 Overclocked"
  hold: boolean; // the attacker held: no Clash damage by choice
  big: boolean; // at or above config.ui.bigHitThreshold
}
export interface ClashEvent {
  key: number;
  hits: ClashHit[];
  big: boolean;
}

const CLASH_MS = 1700;
let clashKey = 0;

/** Watches the log for the round's Clash lines and turns them into a short-lived animation event. */
export function useClashEvent(state: GameState): ClashEvent | null {
  const seen = useRef(state.log.length);
  const [event, setEvent] = useState<ClashEvent | null>(null);
  useEffect(() => {
    const fresh = state.log.slice(seen.current);
    seen.current = state.log.length;
    const hits: ClashHit[] = [];
    for (const l of fresh) {
      if (l.player === null) continue;
      if (l.text.startsWith('Clash:')) {
        const dmg = l.amount ?? 0;
        hits.push({ target: l.player, dmg, note: /\(([^)]*)\)\.?$/.exec(l.text)?.[1] ?? '', hold: false, big: dmg >= state.config.ui.bigHitThreshold });
      } else if (/holds and deals no Clash damage/.test(l.text)) {
        hits.push({ target: l.player, dmg: 0, note: '', hold: true, big: false });
      }
    }
    if (!hits.length) return;
    const ev = { key: ++clashKey, hits, big: hits.some((h) => h.big) };
    setEvent(ev);
    const t = setTimeout(() => setEvent((cur) => (cur?.key === ev.key ? null : cur)), CLASH_MS);
    return () => clearTimeout(t);
  }, [state.log, state.config.ui.bigHitThreshold]);
  return event;
}

/** Classes for a Specimen's wrapper during a clash: lunge toward the middle, and shake if it was hit. */
export function clashClasses(ev: ClashEvent | null, player: PlayerId, side: 'left' | 'right'): string {
  if (!ev) return '';
  const hit = ev.hits.find((h) => h.target === player);
  return `${side === 'left' ? 'clash-lunge-r' : 'clash-lunge-l'} ${hit && hit.dmg > 0 ? (hit.big ? 'clash-shake-big' : 'clash-shake') : ''}`;
}

/** Damage number and red flash over one Specimen's tank. */
export function ClashDamage({ ev, player }: { ev: ClashEvent | null; player: PlayerId }) {
  if (!ev) return null;
  const hit = ev.hits.find((h) => h.target === player);
  if (!hit) return null;
  const label = hit.hold ? 'HOLD' : hit.dmg > 0 ? `−${hit.dmg}` : 'BLOCKED';
  return (
    <div key={ev.key} className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
      {hit.dmg > 0 && <div className="clash-flash absolute inset-0 rounded-[26px] bg-red-600/45" />}
      <div className="clash-num flex flex-col items-center">
        <span className={`font-display font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] ${hit.dmg > 0 ? `${hit.big ? 'text-5xl' : 'text-4xl'} text-red-400` : 'text-2xl text-sky-200'}`}>{label}</span>
        {hit.note && hit.dmg > 0 && <span className="mt-0.5 rounded bg-black/70 px-1.5 text-[10px] font-semibold text-ink2">{hit.note}</span>}
      </div>
    </div>
  );
}

/** The impact burst between the two Specimens. */
export function ClashBurst({ ev }: { ev: ClashEvent | null }) {
  if (!ev) return null;
  const rays = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <div key={ev.key} className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2">
      <svg viewBox="-50 -50 100 100" className={`clash-burst ${ev.big ? 'h-40 w-40' : 'h-28 w-28'}`} aria-hidden>
        {rays.map((a, i) => (
          <line key={a} x1="0" y1="0" x2={Math.cos((a * Math.PI) / 180) * (i % 2 ? 46 : 34)} y2={Math.sin((a * Math.PI) / 180) * (i % 2 ? 46 : 34)} stroke={i % 2 ? '#fbbf24' : '#f87171'} strokeWidth={i % 2 ? 2 : 3.5} strokeLinecap="round" />
        ))}
        <circle r="15" fill="#fff7d6" />
        <circle r="9" fill="#fbbf24" />
      </svg>
      <div className="clash-word absolute inset-0 grid place-items-center font-display text-sm font-bold tracking-[0.3em] text-amber-100 [text-shadow:0_0_2px_#000,0_0_6px_#000,0_1px_0_#000]">CLASH</div>
    </div>
  );
}
