import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { evolutionDefs, stableMax, zoneOf } from '../../engine';
import type { GameState, PlayerId, Zone } from '../../engine';
import { FACTION_META } from '../meta';

// Strain and evolution made visible. On the tank: Strain motes rising as it builds, steam as it vents, a
// callout when the Specimen crosses into Overclock / Rejection territory (and a persistent aura while it stays
// there), an alarm when it actually rejects, and a metamorphosis when it evolves (then a lasting glow).
// On the meters: segments that fill or drain animate, with a floating +N / -N.

export const ZONE_COLOR: Record<Zone, string> = { stable: '#6ee7b7', overclocked: '#fbbf24', rejection: '#f87171' };

export type StrainFxEvent =
  | { key: number; kind: 'gain' | 'vent'; amount: number; color: string }
  | { key: number; kind: 'zone'; zone: Zone }
  | { key: number; kind: 'reject' }
  | { key: number; kind: 'evolve'; name: string; color: string };

const FX_MS: Record<StrainFxEvent['kind'], number> = { gain: 1500, vent: 1600, zone: 1700, reject: 1900, evolve: 2900 };
let strainKey = 0;

/** Diffs one Specimen's Strain, zone, rejections and evolution between renders. */
export function useStrainFx(state: GameState, player: PlayerId): StrainFxEvent[] {
  const p = state.players[player];
  const zone = zoneOf(state, p);
  const snap = { strain: p.strain, zone, rejections: p.stats.rejectionsSuffered, evolution: p.evolution, round: state.round };
  const prev = useRef(snap);
  const [events, setEvents] = useState<StrainFxEvent[]>([]);
  useEffect(() => {
    const before = prev.current;
    prev.current = snap;
    if (snap.round < before.round) return; // a rematch: the match restarted, nothing actually happened
    const found: StrainFxEvent[] = [];
    const rejected = snap.rejections > before.rejections;
    if (rejected) found.push({ key: ++strainKey, kind: 'reject' });
    const delta = snap.strain - before.strain;
    if (delta > 0) found.push({ key: ++strainKey, kind: 'gain', amount: delta, color: ZONE_COLOR[zone] });
    else if (delta < 0 && !rejected) found.push({ key: ++strainKey, kind: 'vent', amount: -delta, color: ZONE_COLOR[zone] });
    // A rejection drops the Specimen back down on its own; the REJECTION alarm already says so.
    if (snap.zone !== before.zone && !rejected) found.push({ key: ++strainKey, kind: 'zone', zone: snap.zone });
    if (snap.evolution && snap.evolution !== before.evolution) {
      const def = evolutionDefs(state, p).find((d) => d.id === snap.evolution);
      found.push({ key: ++strainKey, kind: 'evolve', name: def?.name ?? snap.evolution, color: FACTION_META[p.faction].color });
    }
    if (!found.length) return;
    setEvents((cur) => [...cur, ...found]);
    for (const e of found) setTimeout(() => setEvents((cur) => cur.filter((x) => x.key !== e.key)), FX_MS[e.kind]);
  }, [snap.strain, snap.zone, snap.rejections, snap.evolution, snap.round]);
  return events;
}

const ZONE_LABEL: Record<Zone, string> = { stable: 'STABILIZED', overclocked: 'OVERCLOCKED', rejection: 'CRITICAL STRAIN' };

/**
 * Tank effects for one Specimen. `under` (drawn beneath the graft plates): the persistent zone / evolved auras.
 * `over` (above everything): the short-lived events.
 */
export function StrainTankFx({ state, player, events, flip, layer }: { state: GameState; player: PlayerId; events: StrainFxEvent[]; flip?: boolean; layer: 'under' | 'over' }) {
  const p = state.players[player];
  const zone = zoneOf(state, p);
  const evoColor = FACTION_META[p.faction].color;
  const evoName = p.evolution ? (evolutionDefs(state, p).find((d) => d.id === p.evolution)?.name ?? p.evolution) : null;
  if (layer === 'over') {
    return (
      <>
        {events.map((e) => {
          switch (e.kind) {
            case 'gain':
              return <StrainGain key={e.key} amount={e.amount} color={e.color} />;
            case 'vent':
              return <StrainVent key={e.key} amount={e.amount} />;
            case 'zone':
              return (
                <span
                  key={e.key}
                  className="status-slam absolute left-1/2 top-[30%] z-30 whitespace-nowrap rounded-lg border-2 bg-black/80 px-3 py-1 font-display text-base font-bold tracking-widest"
                  style={{ color: ZONE_COLOR[e.zone], borderColor: ZONE_COLOR[e.zone], boxShadow: `0 0 18px ${ZONE_COLOR[e.zone]}aa` }}
                  aria-live="polite"
                >
                  {e.zone === 'stable' ? '▼' : '☣'} {ZONE_LABEL[e.zone]}
                </span>
              );
            case 'reject':
              return <RejectAlarm key={e.key} />;
            case 'evolve':
              return <Metamorphosis key={e.key} name={e.name} color={e.color} />;
          }
        })}
      </>
    );
  }
  return (
    <>
      {/* Persistent: the evolved Specimen keeps a glow in its Build's colour... */}
      {p.evolution && <div className="evo-aura pointer-events-none absolute inset-0 rounded-[26px] mix-blend-screen" style={{ background: `radial-gradient(ellipse 55% 60% at 50% 48%, ${evoColor}55, transparent 70%)` }} />}
      {evoName && (
        <span className={`pointer-events-none absolute top-1.5 z-20 max-w-[62%] truncate rounded-md border bg-black/70 px-1.5 py-0.5 font-display text-[9px] font-bold tracking-wide ${flip ? 'right-1.5' : 'left-1.5'}`} style={{ color: evoColor, borderColor: `${evoColor}99` }} title={`Evolved: ${evoName}`}>
          ★ {evoName}
        </span>
      )}
      {/* ...and an Overclocked / over-threshold one crackles or sounds the alarm. */}
      {zone === 'overclocked' && (
        <div className="pointer-events-none absolute inset-0 rounded-[26px]" data-strain="overclocked">
          <div className="strain-oc-aura absolute inset-0 rounded-[26px]" />
          <Arcs color="#fbbf24" />
        </div>
      )}
      {zone === 'rejection' && (
        <div className="pointer-events-none absolute inset-0 rounded-[26px]" data-strain="rejection">
          <div className="strain-rej-aura absolute inset-0 rounded-[26px]" />
          <Arcs color="#f87171" fast />
        </div>
      )}
    </>
  );
}

/** Electric arcs flickering over the creature (Overclock and beyond). */
function Arcs({ color, fast }: { color: string; fast?: boolean }) {
  const arcs = [
    { d: 'M20,30 L27,36 L22,41 L31,47 L27,53', i: 0 },
    { d: 'M78,24 L71,31 L77,35 L69,42', i: 0.8 },
    { d: 'M60,60 L66,66 L60,70 L68,77 L63,83', i: 1.5 },
    { d: 'M38,74 L33,79 L39,82 L32,89', i: 2.1 },
  ];
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" style={{ filter: `drop-shadow(0 0 3px ${color})` }} aria-hidden>
      {arcs.map((a) => (
        <polyline key={a.d} className="strain-arc" style={{ '--i': `${a.i * (fast ? 0.4 : 1)}s`, animationDuration: fast ? '1.1s' : undefined } as CSSProperties} points={a.d.replace(/[ML]/g, ' ').trim()} stroke={color} strokeWidth="1.2" strokeLinejoin="round" fill="none" />
      ))}
    </svg>
  );
}

/** Strain building: hazard motes rise through the creature and the amount floats up. */
function StrainGain({ amount, color }: { amount: number; color: string }) {
  const motes = [18, 32, 47, 58, 70, 83];
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-[26px]" data-strain-fx="gain">
      {motes.map((x, i) => (
        <span
          key={x}
          className="strain-mote absolute bottom-[8%] h-2 w-2 rotate-45 rounded-[2px]"
          style={{ left: `${x}%`, background: color, boxShadow: `0 0 8px ${color}`, '--i': `${(i % 3) * 0.12}s`, '--dx': `${(i % 2 ? 1 : -1) * 6}px` } as CSSProperties}
        />
      ))}
      <span className="strain-rise absolute left-1/2 top-[62%] whitespace-nowrap font-display text-2xl font-bold drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]" style={{ color }}>
        +{amount} ☣
      </span>
    </div>
  );
}

/** Strain venting: steam jets from the tank's top vents and the amount floats up. */
function StrainVent({ amount }: { amount: number }) {
  const puffs = [22, 38, 62, 78];
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-[26px]" data-strain-fx="vent">
      {puffs.map((x, i) => (
        <span key={x} className="strain-steam absolute top-[14%] h-5 w-5 rounded-full bg-cyan-50/60 blur-[3px]" style={{ left: `${x}%`, '--i': `${i * 0.08}s`, '--dx': `${(i - 1.5) * 5}px` } as CSSProperties} />
      ))}
      <span className="strain-rise absolute left-1/2 top-[40%] whitespace-nowrap font-display text-2xl font-bold text-cyan-200 drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]">−{amount} ☣</span>
    </div>
  );
}

/** Rejection: red alarm strobe, hazard tape, and the word. (The ejected graft shows its own EJECTED plate.) */
function RejectAlarm() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30" data-strain-fx="reject">
      <div className="strain-alarm absolute inset-0 rounded-[26px] bg-red-600/35" />
      <div className="strain-alarm absolute inset-x-0 top-[44%] h-7 bg-[repeating-linear-gradient(-45deg,#facc15_0_8px,#111_8px_16px)] opacity-80" />
      <span className="status-slam absolute left-1/2 top-1/2 whitespace-nowrap rounded-lg border-2 border-red-500 bg-black/90 px-3 py-1 font-display text-xl font-bold tracking-[0.2em] text-red-400 shadow-[0_0_24px_rgba(239,68,68,0.8)]" aria-live="polite">
        REJECTION
      </span>
    </div>
  );
}

/** Evolution: a flash, a pillar of light, expanding rings and rising motes, then the new form's name. */
function Metamorphosis({ name, color }: { name: string; color: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40" data-strain-fx="evolve" aria-live="polite">
      <div className="evo-flash absolute inset-0 rounded-[26px]" style={{ background: `radial-gradient(circle at 50% 50%, #ffffff, ${color}cc 45%, transparent 75%)` }} />
      <div className="evo-pillar absolute inset-y-0 left-[38%] w-[24%] rounded-full blur-md" style={{ background: `linear-gradient(0deg, transparent, ${color}, #ffffffcc, ${color}, transparent)` }} />
      {[0, 0.25, 0.5].map((d) => (
        <span key={d} className="evo-ring absolute left-[10%] top-[10%] h-[80%] w-[80%] rounded-full border-[3px]" style={{ borderColor: color, boxShadow: `0 0 16px ${color}`, '--i': `${d}s` } as CSSProperties} />
      ))}
      <div className="absolute inset-0 overflow-hidden rounded-[26px]">
        {Array.from({ length: 12 }, (_, i) => (
          <span
            key={i}
            className="evo-mote absolute bottom-[6%] h-1.5 w-1.5 rounded-full"
            style={{ left: `${10 + ((i * 37) % 80)}%`, background: i % 3 ? color : '#ffffff', boxShadow: `0 0 6px ${color}`, '--i': `${(i % 4) * 0.15}s`, '--dx': `${((i % 5) - 2) * 8}px` } as CSSProperties}
          />
        ))}
      </div>
      <div className="evo-stamp absolute left-1/2 top-1/2 flex flex-col items-center whitespace-nowrap rounded-xl border-2 bg-black/85 px-3 py-1" style={{ borderColor: color, boxShadow: `0 0 26px ${color}` }}>
        <span className="font-display text-[10px] font-bold tracking-[0.3em] text-ink2">★ EVOLVED ★</span>
        <span className="font-display text-lg font-extrabold leading-tight" style={{ color }}>
          {name}
        </span>
      </div>
    </div>
  );
}

// ---------- Meters ----------

export interface Change {
  from: number;
  to: number;
  key: number;
}

/** The last change of a number, kept for `ms` so segments and a +N / -N can animate it. */
export function useChange(value: number, ms = 1400): Change | null {
  const prev = useRef(value);
  const [chg, setChg] = useState<Change | null>(null);
  useEffect(() => {
    if (value === prev.current) return;
    const c = { from: prev.current, to: value, key: ++strainKey };
    prev.current = value;
    setChg(c);
    const t = setTimeout(() => setChg((x) => (x?.key === c.key ? null : x)), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return chg;
}

/**
 * Animation for Strain meter segment `i` (1-based): filling / draining when it just changed, otherwise a
 * steady throb on the filled segments while Overclocked, faster and red past the threshold.
 */
export function strainSegFx(state: GameState, player: PlayerId, i: number, chg: Change | null): { key: string; className: string; style?: CSSProperties } {
  const p = state.players[player];
  if (chg && chg.to > chg.from && i > chg.from && i <= chg.to) return { key: `${i}:${chg.key}`, className: 'strain-seg-in', style: { animationDelay: `${(i - chg.from - 1) * 70}ms` } };
  if (chg && chg.to < chg.from && i > chg.to && i <= chg.from) return { key: `${i}:${chg.key}`, className: 'strain-seg-out', style: { animationDelay: `${(chg.from - i) * 50}ms` } };
  if (i > p.strain) return { key: `${i}`, className: '' };
  if (p.strain > state.config.strain.threshold) return { key: `${i}`, className: 'strain-crit' };
  if (p.strain > stableMax(state, p)) return { key: `${i}`, className: 'strain-hot' };
  return { key: `${i}`, className: '' };
}

/** A floating +N / -N beside a Strain readout (inside a `relative` parent; takes no layout space). */
export function StrainDelta({ chg, side = 'right' }: { chg: Change | null; side?: 'left' | 'right' }) {
  if (!chg) return null;
  const up = chg.to > chg.from;
  return (
    <span key={chg.key} className={`strain-delta pointer-events-none absolute -top-1.5 whitespace-nowrap font-display font-bold ${side === 'right' ? 'left-full ml-1' : 'right-full mr-1'} ${up ? 'text-amber-300' : 'text-cyan-200'}`}>
      {up ? '+' : '−'}
      {Math.abs(chg.to - chg.from)}
    </span>
  );
}
