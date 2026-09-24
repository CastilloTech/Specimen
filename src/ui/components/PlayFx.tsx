import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { cardOf, publicPlay } from '../../engine';
import type { CardDef, GameState, PlayerId, SlotId } from '../../engine';
import { CardArt } from './CardArt';
import { accentFor } from './CardView';

// Card-play animations, themed by the card's faction: the card flares up over the caster's tank, travels to
// where it lands (a graft into its slot, a Sabotage onto the targeted enemy graft, a Toxin onto the opponent,
// a Serum / Protocol onto the caster), and a faction-specific impact fires there.

export type FxTheme = 'predator' | 'parasite' | 'bastion' | 'corrosion' | 'aegis' | 'miasma' | 'hollow' | 'tech' | 'dormant';

export interface PlayFxEvent {
  key: number;
  caster: PlayerId;
  def: CardDef | null; // null: an opponent's face-down graft (nothing about it is revealed)
  theme: FxTheme;
  color: string;
  target: { player: PlayerId; slot: SlotId | null };
  negated?: boolean;
}

const FX_MS = 1500;
let fxKey = 0;

export function usePlayFx(state: GameState, viewer: PlayerId): PlayFxEvent[] {
  const seen = useRef(state.plays.length);
  const negSeen = useRef(new Set(state.plays.filter((r) => r.negated).map((r) => r.n)));
  const [events, setEvents] = useState<PlayFxEvent[]>([]);
  useEffect(() => {
    const found: PlayFxEvent[] = [];
    for (const raw of state.plays.slice(seen.current)) {
      if (raw.kind === 'cycle' || raw.kind === 'valve') continue;
      const rec = publicPlay(raw, viewer);
      const def = rec.cardId ? cardOf(rec.cardId) : null;
      const opp = (rec.player === 0 ? 1 : 0) as PlayerId;
      const theme: FxTheme = def ? (def.faction as FxTheme) : 'dormant';
      const color = def ? accentFor(def.faction) : '#6b7a73';
      const type = def?.type ?? 'graft';
      const target =
        type === 'graft'
          ? { player: rec.player, slot: rec.slot ?? null }
          : type === 'sabotage'
            ? { player: opp, slot: rec.target ?? null }
            : type === 'toxin'
              ? { player: opp, slot: null }
              : { player: rec.player, slot: null };
      found.push({ key: ++fxKey, caster: rec.player, def, theme, color, target });
    }
    seen.current = state.plays.length;
    // A play negated by a Protocol after it landed: a follow-up "negated" effect on the caster.
    for (const r of state.plays) {
      if (r.negated && !negSeen.current.has(r.n)) {
        negSeen.current.add(r.n);
        const rec = publicPlay(r, viewer);
        const def = rec.cardId ? cardOf(rec.cardId) : null;
        found.push({ key: ++fxKey, caster: r.player, def, theme: 'tech', color: '#e5e7eb', target: { player: r.player, slot: null }, negated: true });
      }
    }
    if (!found.length) return;
    setEvents((cur) => [...cur, ...found]);
    const keys = new Set(found.map((e) => e.key));
    setTimeout(() => setEvents((cur) => cur.filter((e) => !keys.has(e.key))), FX_MS);
  }, [state.plays, viewer]);
  return events;
}

/**
 * The card flaring up over its caster's tank, then flying to `to` (percent of the tank: a slot, the tank
 * centre, or past the edge toward the other tank) and shrinking into it.
 */
export function CastCard({ ev, to }: { ev: PlayFxEvent; to: { x: number; y: number } }) {
  const style = { '--sx': `${to.x}%`, '--sy': `${to.y}%` } as CSSProperties;
  return (
    <div className={`${ev.negated ? 'cast-negated' : 'cast-card'} pointer-events-none absolute z-40 w-[34%]`} style={style}>
      <div className="overflow-hidden rounded-lg border-2 bg-panel" style={{ borderColor: ev.color, boxShadow: `0 0 0 1px ${ev.color}, 0 0 26px 6px ${ev.color}aa` }}>
        <div className="aspect-[4/3]">{ev.def ? <CardArt def={ev.def} accent={ev.color} className="h-full w-full" /> : <div className="h-full w-full bg-[repeating-linear-gradient(45deg,#1b2521_0_4px,#111916_4px_8px)]" />}</div>
        <div className="truncate px-1 py-0.5 text-center font-display text-[10px] font-bold" style={{ color: ev.color }}>
          {ev.def ? ev.def.name : 'Face-down graft'}
        </div>
      </div>
      {ev.negated && <div className="graft-stamp absolute left-1/2 top-1/2 whitespace-nowrap rounded border-2 border-zinc-200 bg-black/85 px-1.5 font-display text-[11px] font-bold tracking-widest text-zinc-100">NEGATED</div>}
    </div>
  );
}

/** The faction-themed impact where a played card lands. */
export function ImpactBurst({ theme, color }: { theme: FxTheme; color: string }) {
  const rays = (n: number, r0: number, r1: number) => Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2).map((a) => [Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1]);
  let art: React.ReactNode;
  switch (theme) {
    case 'predator': // three claw slashes and flying embers
      art = (
        <>
          {[-14, 0, 14].map((o, i) => (
            <path key={o} className="fx-draw" style={{ '--i': `${i * 0.06}s` } as CSSProperties} d={`M${-26 + o},-30 Q${o},0 ${22 + o},30`} stroke={color} strokeWidth="6" strokeLinecap="round" fill="none" />
          ))}
          {rays(8, 10, 40).map(([, , x, y], i) => (
            <circle key={i} className="fx-fly" style={{ '--x': `${x}px`, '--y': `${y}px` } as CSSProperties} r="2.5" fill="#fbbf24" />
          ))}
        </>
      );
      break;
    case 'parasite': // tendrils curling out and a pulsing ring
      art = (
        <>
          <circle className="fx-ring" r="18" stroke={color} strokeWidth="3" fill="none" />
          {[0, 72, 144, 216, 288].map((a) => (
            <path key={a} className="fx-draw" transform={`rotate(${a})`} d="M0,0 C12,-6 18,-20 10,-30 C4,-38 16,-44 22,-40" stroke={color} strokeWidth="3.5" strokeLinecap="round" fill="none" />
          ))}
          <circle className="fx-pop" r="7" fill={color} />
        </>
      );
      break;
    case 'bastion': // a hex shield assembling with a shockwave
      art = (
        <>
          <circle className="fx-ring" r="30" stroke="#93c5fd" strokeWidth="2" fill="none" />
          <polygon className="fx-pop" points="0,-30 26,-15 26,15 0,30 -26,15 -26,-15" fill={`${color}33`} stroke={color} strokeWidth="4" />
          <polygon className="fx-pop" style={{ '--i': '0.1s' } as CSSProperties} points="0,-16 14,-8 14,8 0,16 -14,8 -14,-8" fill="none" stroke="#e0f2fe" strokeWidth="2.5" />
        </>
      );
      break;
    case 'corrosion': // an acid splash with droplets flying out
      art = (
        <>
          <circle className="fx-pop" r="14" fill={`${color}cc`} />
          {rays(10, 8, 42).map(([, , x, y], i) => (
            <ellipse key={i} className="fx-fly" style={{ '--x': `${x}px`, '--y': `${y + 8}px` } as CSSProperties} rx="3.5" ry="5" fill={color} />
          ))}
          <circle className="fx-ring" r="24" stroke={color} strokeWidth="2" strokeDasharray="4 3" fill="none" />
        </>
      );
      break;
    case 'aegis': // a golden ward circle with rays
      art = (
        <>
          <circle className="fx-ring" r="30" stroke="#fbbf24" strokeWidth="3" fill="none" />
          <g className="fx-spin">
            {rays(12, 16, 38).map(([x0, y0, x1, y1], i) => (
              <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={i % 2 ? '#fde68a' : '#fbbf24'} strokeWidth={i % 2 ? 1.5 : 3} strokeLinecap="round" />
            ))}
          </g>
          <circle className="fx-pop" r="12" fill="#fff7d6" stroke="#fbbf24" strokeWidth="3" />
        </>
      );
      break;
    case 'miasma': // spore clouds billowing out
      art = (
        <>
          {[
            [0, 0, 16],
            [-18, -8, 11],
            [17, -10, 12],
            [-12, 14, 10],
            [14, 13, 11],
          ].map(([x, y, r], i) => (
            <circle key={i} className="fx-puff" style={{ '--i': `${i * 0.05}s` } as CSSProperties} cx={x} cy={y} r={r} fill={i % 2 ? `${color}bb` : '#a3e63588'} />
          ))}
          {rays(6, 6, 36).map(([, , x, y], i) => (
            <circle key={`s${i}`} className="fx-fly" style={{ '--x': `${x}px`, '--y': `${y}px` } as CSSProperties} r="2.5" fill="#bef264" />
          ))}
        </>
      );
      break;
    case 'hollow': // wisps rising out of a dark vortex
      art = (
        <>
          <circle className="fx-spin" r="18" stroke={color} strokeWidth="3" strokeDasharray="10 6" fill="#1e1b2e99" />
          {[-16, 0, 16].map((x, i) => (
            <path key={x} className="fx-rise" style={{ '--i': `${i * 0.08}s` } as CSSProperties} d={`M${x},10 C${x - 8},-4 ${x + 8},-14 ${x},-30`} stroke="#e9d5ff" strokeWidth="3.5" strokeLinecap="round" fill="none" />
          ))}
        </>
      );
      break;
    case 'tech': // a targeting reticle locking on
      art = (
        <>
          <g className="fx-lock">
            <circle r="24" stroke="#e5e7eb" strokeWidth="2" fill="none" strokeDasharray="12 6" />
            {[0, 90, 180, 270].map((a) => (
              <line key={a} transform={`rotate(${a})`} x1="0" y1="-34" x2="0" y2="-18" stroke="#e5e7eb" strokeWidth="3" strokeLinecap="round" />
            ))}
          </g>
          <rect className="fx-pop" x="-6" y="-6" width="12" height="12" transform="rotate(45)" fill="#38bdf8" />
          <circle className="fx-ring" r="30" stroke="#38bdf8" strokeWidth="1.5" fill="none" />
        </>
      );
      break;
    default: // dormant: a dark cocoon closing
      art = (
        <>
          <circle className="fx-ring" r="26" stroke="#6b7a73" strokeWidth="3" fill="none" />
          <ellipse className="fx-pop" rx="12" ry="16" fill="#1f2a26" stroke="#6b7a73" strokeWidth="2.5" />
        </>
      );
  }
  return (
    <svg viewBox="-50 -50 100 100" className="fx-impact h-full w-full overflow-visible" aria-hidden>
      {art}
    </svg>
  );
}
