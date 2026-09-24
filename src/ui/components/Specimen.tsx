import { useEffect, useRef, useState } from 'react';
import specimenArt from '../../assets/specimen.jpg';
import { CARD_MAP, publicGraft, SLOT_LABEL } from '../../engine';
import type { GameState, PlayerId, PlayerState, SlotId } from '../../engine';
import { CardArt } from './CardArt';
import { accentFor } from './CardView';
import { CastCard, ImpactBurst, usePlayFx } from './PlayFx';
import { StrainTankFx, useStrainFx } from './StrainFx';
import { StatusAura, StatusBadges, StatusCallouts, StatusIcon, useStatusEvents } from './StatusFx';

/** A short-lived graft event on one slot: Integrity lost, the graft destroyed or ejected, or the slot necrosed. */
interface GraftFx {
  key: number;
  kind: 'wear' | 'destroyed' | 'ejected' | 'necrosis';
  amount?: number;
  /** The lost graft (for its ghost); null when the viewer never saw it (an opponent's face-down graft). */
  cardId?: string | null;
}

const FX_MS: Record<GraftFx['kind'], number> = { wear: 1600, destroyed: 2000, ejected: 1800, necrosis: 1800 };
let fxKey = 0;

/** Diffs a player's grafts (and necrosis) between renders to find what just happened to each slot. */
function useGraftFx(state: GameState, p: PlayerState, viewer: PlayerId): Partial<Record<SlotId, GraftFx>> {
  type Snap = { uid: string; integrity: number; cardId: string; faceDown: boolean };
  const prev = useRef<{ grafts: Map<SlotId, Snap>; necrosis: Partial<Record<SlotId, number>> } | null>(null);
  const lastLog = useRef(state.log.length);
  const [fx, setFx] = useState<Partial<Record<SlotId, GraftFx>>>({});
  useEffect(() => {
    const now = new Map(p.grafts.map((g) => [g.slot, { uid: g.uid, integrity: g.integrity, cardId: g.cardId, faceDown: g.faceDown }] as const));
    const fresh = state.log.slice(lastLog.current);
    lastLog.current = state.log.length;
    const before = prev.current;
    prev.current = { grafts: now, necrosis: { ...p.necrosis } };
    if (!before) return;
    const found: Partial<Record<SlotId, GraftFx>> = {};
    for (const [slot, old] of before.grafts) {
      const cur = now.get(slot);
      const seen = !old.faceDown || viewer === p.id ? old.cardId : null;
      if (cur && cur.uid === old.uid && cur.integrity < old.integrity) {
        found[slot] = { key: ++fxKey, kind: 'wear', amount: old.integrity - cur.integrity };
      } else if (!cur) {
        const ejected = fresh.some((l) => l.kind === 'reject' && l.text.includes(`${p.name} ejects `) && l.text.includes(` from ${SLOT_LABEL[slot]}`));
        found[slot] = { key: ++fxKey, kind: ejected ? 'ejected' : 'destroyed', cardId: seen };
      }
    }
    for (const slot of Object.keys(p.necrosis) as SlotId[]) {
      if ((p.necrosis[slot] ?? 0) > 0 && !(before.necrosis[slot] ?? 0) && !found[slot]) found[slot] = { key: ++fxKey, kind: 'necrosis' };
    }
    const entries = Object.entries(found) as [SlotId, GraftFx][];
    if (!entries.length) return;
    setFx((f) => ({ ...f, ...found }));
    for (const [slot, e] of entries) {
      setTimeout(() => setFx((f) => (f[slot]?.key === e.key ? { ...f, [slot]: undefined } : f)), FX_MS[e.kind]);
    }
  }, [p.grafts, p.necrosis, p.name, p.id, viewer, state.log]);
  return fx;
}

/** Hairline cracks over a worn graft plate: more of them the lower its Integrity. */
function Cracks({ level }: { level: 0 | 1 | 2 }) {
  if (!level) return null;
  return (
    <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <path d="M8,4 L22,18 L18,28 L30,40 L27,54" stroke="rgba(255,255,255,0.75)" strokeWidth="1.3" fill="none" />
      <path d="M22,18 L34,14" stroke="rgba(255,255,255,0.55)" strokeWidth="1" fill="none" />
      {level > 1 && (
        <>
          <path d="M92,6 L78,20 L84,32 L70,44 L74,58" stroke="rgba(255,120,120,0.85)" strokeWidth="1.4" fill="none" />
          <path d="M78,20 L64,16 M84,32 L96,36" stroke="rgba(255,120,120,0.6)" strokeWidth="1" fill="none" />
        </>
      )}
    </svg>
  );
}

/** Integrity as pips (falls back to a number for unusually tough grafts). */
function IntegrityPips({ cur, max }: { cur: number; max: number }) {
  const color = cur >= max ? 'bg-emerald-400' : cur <= 1 ? 'bg-red-500 animate-pulse' : 'bg-amber-400';
  if (max > 6) return <span className={`rounded px-[3px] py-px ${cur >= max ? 'bg-emerald-900/70 text-emerald-100' : cur <= 1 ? 'bg-red-700/90 text-white' : 'bg-amber-700/80 text-amber-50'}`}>⬢{cur}/{max}</span>;
  return (
    <span className="flex items-center gap-[2px] rounded bg-black/50 px-[3px] py-[2px]" title={`Integrity ${cur}/${max}: the graft's own HP. Clash damage and some cards wear it down; at 0 it is destroyed.`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`h-[5px] w-[5px] rotate-45 rounded-[1px] ${i < cur ? color : 'bg-white/15'}`} />
      ))}
    </span>
  );
}

/** The lost graft's plate, shattering (destroyed) or flying off (ejected), drawn where the graft was. */
function GraftGhost({ fx, x, y }: { fx: GraftFx; x: number; y: number }) {
  const def = fx.cardId ? CARD_MAP[fx.cardId] : null;
  const accent = def ? accentFor(def.faction) : '#8a948f';
  const plate = (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border bg-panel" style={{ borderColor: accent }}>
      <div className="h-[15px] overflow-hidden">{def ? <CardArt def={def} accent={accent} className="h-full w-full" /> : <div className="h-full w-full bg-[repeating-linear-gradient(45deg,#1b2521_0_3px,#111916_3px_6px)]" />}</div>
      <span className="truncate px-0.5 pt-0.5 text-center font-display text-[9px] font-bold">{def ? def.name : 'Graft'}</span>
    </div>
  );
  const destroyed = fx.kind === 'destroyed';
  const shards = ['polygon(0 0,55% 0,40% 55%,0 45%)', 'polygon(55% 0,100% 0,100% 50%,40% 55%)', 'polygon(0 45%,40% 55%,50% 100%,0 100%)', 'polygon(40% 55%,100% 50%,100% 100%,50% 100%)'];
  return (
    <div className="pointer-events-none absolute z-30 h-[40px] w-[36%] -translate-x-1/2 -translate-y-1/2 lg:w-[31%]" style={{ left: `${x}%`, top: `${y}%` }} aria-live="polite">
      {destroyed ? (
        <>
          {shards.map((clip, i) => (
            <div key={i} className={`graft-shard graft-shard-${i} absolute inset-0`} style={{ clipPath: clip }}>
              {plate}
            </div>
          ))}
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="graft-spark absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-sm" style={{ background: i % 2 ? accent : '#f87171', ['--a' as string]: `${i * 45}deg` }} />
          ))}
          <span className="graft-stamp absolute left-1/2 top-1/2 whitespace-nowrap rounded border-2 border-red-500 bg-black/85 px-1.5 font-display text-[11px] font-bold tracking-widest text-red-400">DESTROYED</span>
        </>
      ) : (
        <>
          <div className="graft-eject absolute inset-0">{plate}</div>
          <span className="graft-stamp absolute left-1/2 top-1/2 whitespace-nowrap rounded border-2 border-amber-400 bg-black/85 px-1.5 font-display text-[11px] font-bold tracking-widest text-amber-300">EJECTED</span>
        </>
      )}
    </div>
  );
}

// Slot anchor points on the creature artwork (percent of the square tank), placed on its anatomy:
// helmet, neck cables, chest, the resting hand, the far forearm, and the hip. `flip` mirrors the whole
// creature (and so every slot); the match flips the left-hand tank so the two Specimens face each other.
const POS: Record<SlotId, { x: number; y: number }> = {
  head: { x: 46, y: 16 },
  nerve: { x: 57, y: 33 },
  organ: { x: 55, y: 51 },
  limbA: { x: 17, y: 71 },
  limbB: { x: 82, y: 66 },
  organB: { x: 50, y: 86 },
};

const BUBBLES = [
  { left: '12%', delay: '0s', size: 4 },
  { left: '27%', delay: '1.8s', size: 3 },
  { left: '71%', delay: '0.9s', size: 5 },
  { left: '88%', delay: '3.1s', size: 3 },
  { left: '56%', delay: '2.4s', size: 2 },
];

interface Props {
  state: GameState;
  player: PlayerId;
  viewer: PlayerId; // whose eyes: decides what face-down grafts reveal
  flip?: boolean;
  highlight?: Set<SlotId>;
  onSlot?: (slot: SlotId) => void;
  color: string;
  /** Size to the parent's height (phone landscape board) instead of a capped width. */
  fill?: boolean;
}

/** The bio-engineered creature in its tank, behind the graft sockets. */
export function Creature({ flip, surge, className = '' }: { flip?: boolean; surge?: boolean; className?: string }) {
  return (
    <div className={`absolute inset-0 overflow-hidden rounded-[inherit] ${surge ? 'evo-surge' : ''} ${className}`} aria-hidden>
      <div className="h-full w-full" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
        <img src={specimenArt} alt="" draggable={false} className="specimen-breathe h-full w-full select-none object-cover" />
      </div>
      {/* Blend the painting into the tank: a dark vignette and a little tank-glass sheen. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_70%_at_50%_45%,transparent_55%,rgba(4,8,7,0.85))]" />
    </div>
  );
}

export function Specimen({ state, player, viewer, flip, highlight, onSlot, color, fill }: Props) {
  const p = state.players[player];
  const fx = useGraftFx(state, p, viewer);
  const statusEvents = useStatusEvents(state);
  const plays = usePlayFx(state, viewer);
  const at = (slot: SlotId) => ({ x: flip ? 100 - POS[slot].x : POS[slot].x, y: POS[slot].y });
  const strainFx = useStrainFx(state, player);
  const lostOne = Object.values(fx).some((f) => f && f.kind === 'destroyed') || strainFx.some((e) => e.kind === 'reject');
  const evolving = strainFx.some((e) => e.kind === 'evolve');
  return (
    <div
      className={`relative aspect-square overflow-visible rounded-[26px] border ${fill ? 'h-full' : 'mx-auto w-full max-w-[230px] lg:max-w-[300px]'} ${lostOne ? 'graft-lost-shake' : ''}`}
      style={{ borderColor: `${color}66`, boxShadow: `0 0 22px -6px ${color}88, inset 0 0 0 1px rgba(255,255,255,0.05)` }}
      aria-label={`${p.name}'s Specimen`}
    >
      <Creature flip={flip} surge={evolving} className="rounded-[26px]" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[26px]" style={{ background: `linear-gradient(180deg, ${color}14, transparent 30%, transparent 75%, ${color}1f)` }}>
        {BUBBLES.map((b, i) => (
          <span key={i} className="tank-bubble absolute bottom-1 rounded-full border border-white/30" style={{ left: b.left, width: b.size, height: b.size, animationDelay: b.delay }} />
        ))}
        <div className="absolute inset-x-3 top-1.5 h-4 rounded-full bg-white/[0.05] blur-[1px]" />
      </div>
      <StatusAura state={state} player={player} />
      <StrainTankFx state={state} player={player} events={strainFx} flip={flip} layer="under" />
      {lostOne && <div className="graft-lost-flash pointer-events-none absolute inset-0 z-20 rounded-[26px] bg-red-600/35" />}
      <StatusBadges state={state} player={player} side={flip ? 'left' : 'right'} />
      {p.slots.map((slot) => {
        const pos = POS[slot];
        const x = flip ? 100 - pos.x : pos.x;
        const g = p.grafts.find((gr) => gr.slot === slot);
        const pg = g ? publicGraft(g, viewer === player) : null;
        const def = pg?.cardId ? CARD_MAP[pg.cardId] : null;
        const veteranAt = state.config.veterancy.signatureThreshold;
        const veteran = !!def?.signature && !!pg && pg.roundsSurvived >= veteranAt;
        const lit = highlight?.has(slot);
        const necrotic = p.necrosis[slot] ?? 0;
        const f = fx[slot];
        const wear = f?.kind === 'wear' ? f : null;
        const maxIntegrity = Math.max(def?.integrity ?? state.config.integrity.default, pg?.integrity ?? 0);
        const accent = def ? accentFor(def.faction) : '#5a6b63';
        const asleep = !!pg?.faceDown;
        const crack: 0 | 1 | 2 = !pg || !def || asleep || pg.integrity >= maxIntegrity ? 0 : pg.integrity <= 1 ? 2 : 1;
        return [
          f && (f.kind === 'destroyed' || f.kind === 'ejected') ? <GraftGhost key={`ghost-${f.key}`} fx={f} x={x} y={pos.y} /> : null,
          <button
            key={slot}
            type="button"
            onClick={() => onSlot?.(slot)}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-stretch overflow-visible border text-center leading-[1.05] transition ${
              lit
                ? 'target-glow z-10 w-[36%] rounded-lg lg:w-[31%] border-accent bg-black/70'
                : pg
                  ? 'w-[36%] rounded-lg lg:w-[31%] bg-panel/90 shadow-lg shadow-black/70 backdrop-blur-sm hover:brightness-125'
                  : necrotic > 0
                    ? 'w-[36%] rounded-lg lg:w-[31%] border-fuchsia-700 bg-fuchsia-950/75'
                    : 'rounded-full border-dashed border-cyan-200/35 bg-black/55 px-1.5 hover:border-cyan-200/70'
            } ${pg?.poisoned ? 'graft-poisoned ring-2 ring-fuchsia-500' : ''} ${pg?.disabled ? 'grayscale' : ''} ${wear ? 'wear-flash' : ''}`}
            style={{ left: `${x}%`, top: `${pos.y}%`, borderColor: pg && !lit ? `${accent}aa` : undefined }}
            title={
              def
                ? `${def.name}${asleep ? ' (asleep)' : ''}: ${def.text}${veteran ? ` (Veteran: +${state.config.veterancy.signatureAttackBonus} attack for surviving ${pg!.roundsSurvived} Strain checks)` : ''}`
                : pg
                  ? 'Face-down graft (asleep)'
                  : necrotic > 0
                    ? `Necrotic: cannot be refilled for ${necrotic} more round(s)`
                    : lit
                      ? `Attach your graft to the ${SLOT_LABEL[slot]}`
                      : `${SLOT_LABEL[slot]} (empty)`
            }
          >
            {wear && (
              <span key={wear.key} className="wear-float pointer-events-none absolute -top-4 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-orange-300 bg-orange-600 px-1.5 font-display text-[12px] font-bold text-white shadow-lg" aria-live="polite">
                −{wear.amount} ⬢
              </span>
            )}
            {f?.kind === 'necrosis' && (
              <span key={f.key} className="status-slam pointer-events-none absolute left-1/2 top-1/2 z-20 flex items-center gap-1 whitespace-nowrap rounded-md border-2 border-fuchsia-500 bg-black/85 px-1.5 font-display text-[11px] font-bold tracking-widest text-fuchsia-300">
                <StatusIcon kind="necrosis" className="h-3.5 w-3.5" />
                NECROSIS
              </span>
            )}
            <Cracks level={crack} />
            {pg ? (
              <>
                <div className={`relative h-[15px] overflow-hidden rounded-t-[7px] ${asleep ? 'opacity-40 grayscale' : ''}`}>
                  {def ? <CardArt def={def} accent={accent} className="h-full w-full" /> : <div className="h-full w-full bg-[repeating-linear-gradient(45deg,#1b2521_0_3px,#111916_3px_6px)]" />}
                  <span className="absolute left-1 top-0 font-display text-[7px] font-semibold uppercase tracking-wider text-white/80 drop-shadow">{SLOT_LABEL[slot]}</span>
                </div>
                <span className="flex min-w-0 items-center justify-center gap-0.5 px-0.5 pt-0.5 font-display text-[9px] font-bold lg:text-[10px]">
                  {veteran && <span className="text-amber-300">★</span>}
                  <span className="min-w-0 truncate">{def ? def.name : 'Dormant graft'}</span>
                </span>
                {def && !asleep ? (
                  <span className="flex justify-center gap-[2px] px-0.5 pb-0.5 pt-[2px] text-[7.5px] font-bold leading-none lg:text-[8.5px]">
                    <span className="rounded bg-red-900/70 px-[3px] py-[1px] text-red-100" title="Attack">
                      ⚔{def.attack + (veteran ? state.config.veterancy.signatureAttackBonus : 0)}
                    </span>
                    <span className="rounded bg-sky-900/70 px-[3px] py-[1px] text-sky-100" title="Armor">
                      ⛨{def.armor}
                    </span>
                    <IntegrityPips cur={pg.integrity} max={maxIntegrity} />
                  </span>
                ) : (
                  <span className="pb-0.5 text-[7.5px] text-sky-300">asleep · ☣{pg.strain}</span>
                )}
                {(pg.poisoned > 0 || pg.disabled > 0) && (
                  <span className="flex justify-center gap-1 pb-0.5 text-[8px] font-bold">
                    {pg.poisoned > 0 && <span className="rounded bg-fuchsia-800/80 px-1 text-fuchsia-100">☠ poison {pg.poisoned}</span>}
                    {pg.disabled > 0 && <span className="rounded bg-zinc-700/90 px-1 text-zinc-100">⊘ off {pg.disabled}</span>}
                  </span>
                )}
              </>
            ) : necrotic > 0 ? (
              <span className="py-1 font-display text-[8px] font-semibold uppercase text-fuchsia-300">
                {SLOT_LABEL[slot]}
                <br />
                necrotic {necrotic}
              </span>
            ) : (
              <span className={`whitespace-nowrap font-display text-[8px] font-semibold uppercase tracking-wider ${lit ? 'py-1.5 text-accent' : 'py-0.5 text-cyan-100/70'}`}>
                {lit ? `+ ${SLOT_LABEL[slot]}` : SLOT_LABEL[slot]}
              </span>
            )}
          </button>,
        ];
      })}
      <StatusCallouts events={statusEvents} player={player} />
      <StrainTankFx state={state} player={player} events={strainFx} flip={flip} layer="over" />
      {/* Card plays: the card rises over its caster's tank and flies to where it lands... */}
      {plays
        .filter((e) => e.caster === player)
        .map((e) => {
          // The left tank is the flipped one, so the other Specimen lies to the right of it.
          const to = e.negated ? { x: 50, y: 45 } : e.target.player !== player ? { x: flip ? 150 : -50, y: 45 } : e.target.slot ? at(e.target.slot) : { x: 50, y: 45 };
          return <CastCard key={`cast${e.key}`} ev={e} to={to} />;
        })}
      {/* ...and a faction-themed impact fires there. */}
      {plays
        .filter((e) => !e.negated && e.target.player === player)
        .map((e) => {
          const pos = e.target.slot ? at(e.target.slot) : { x: 50, y: 45 };
          return (
            <div key={`impact${e.key}`} data-fx={e.theme} className="pointer-events-none absolute z-40 aspect-square w-[46%] -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
              <ImpactBurst theme={e.theme} color={e.color} />
            </div>
          );
        })}
    </div>
  );
}

