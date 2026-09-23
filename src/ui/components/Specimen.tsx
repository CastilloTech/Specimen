import { useEffect, useRef, useState } from 'react';
import specimenArt from '../../assets/specimen.jpg';
import { CARD_MAP, publicGraft, SLOT_LABEL } from '../../engine';
import type { GameState, PlayerId, PlayerState, SlotId } from '../../engine';
import { CardArt } from './CardArt';
import { accentFor } from './CardView';

interface WearFlash {
  key: number;
  text: string;
  destroyed: boolean;
}

const FLASH_MS = 1600;
let flashKey = 0;

/** Slots whose graft just lost Integrity (or was destroyed by losing it all), cleared after a moment. */
function useWearFlashes(state: GameState, p: PlayerState): Partial<Record<SlotId, WearFlash>> {
  const prev = useRef<Map<SlotId, { uid: string; integrity: number }> | null>(null);
  const lastLog = useRef(state.log.length);
  const [flashes, setFlashes] = useState<Partial<Record<SlotId, WearFlash>>>({});
  useEffect(() => {
    const now = new Map(p.grafts.map((g) => [g.slot, { uid: g.uid, integrity: g.integrity }] as const));
    const fresh = state.log.slice(lastLog.current);
    lastLog.current = state.log.length;
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    const found: Partial<Record<SlotId, WearFlash>> = {};
    for (const [slot, old] of before) {
      const cur = now.get(slot);
      if (cur && cur.uid === old.uid && cur.integrity < old.integrity) {
        found[slot] = { key: ++flashKey, text: `−${old.integrity - cur.integrity} INT`, destroyed: false };
      } else if (cur?.uid !== old.uid) {
        const depleted = fresh.some((l) => l.kind === 'wear' && /integrity depleted/.test(l.text) && l.text.includes(`${p.name}'s`) && l.text.includes(` in ${SLOT_LABEL[slot]}`));
        if (depleted) found[slot] = { key: ++flashKey, text: 'destroyed', destroyed: true };
      }
    }
    const entries = Object.entries(found) as [SlotId, WearFlash][];
    if (!entries.length) return;
    setFlashes((f) => ({ ...f, ...found }));
    setTimeout(() => {
      setFlashes((f) => {
        const next = { ...f };
        for (const [slot, fl] of entries) if (next[slot]?.key === fl.key) delete next[slot];
        return next;
      });
    }, FLASH_MS);
  }, [p.grafts, p.name, state.log]);
  return flashes;
}

// Slot anchor points on the creature artwork (percent of the square tank), placed on its anatomy:
// helmet, neck cables, chest, the resting hand, the far forearm, and the hip. `flip` mirrors the whole
// creature (and so every slot) so the two Specimens face each other.
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
}

/** The bio-engineered creature in its tank, behind the graft sockets. */
export function Creature({ flip, className = '' }: { flip?: boolean; className?: string }) {
  return (
    <div className={`absolute inset-0 overflow-hidden rounded-[inherit] ${className}`} aria-hidden>
      <div className="h-full w-full" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
        <img src={specimenArt} alt="" draggable={false} className="specimen-breathe h-full w-full select-none object-cover" />
      </div>
      {/* Blend the painting into the tank: a dark vignette and a little tank-glass sheen. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_70%_at_50%_45%,transparent_55%,rgba(4,8,7,0.85))]" />
    </div>
  );
}

export function Specimen({ state, player, viewer, flip, highlight, onSlot, color }: Props) {
  const p = state.players[player];
  const flashes = useWearFlashes(state, p);
  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[230px] overflow-visible rounded-[26px] border lg:max-w-[300px]"
      style={{ borderColor: `${color}66`, boxShadow: `0 0 22px -6px ${color}88, inset 0 0 0 1px rgba(255,255,255,0.05)` }}
      aria-label={`${p.name}'s Specimen`}
    >
      <Creature flip={flip} className="rounded-[26px]" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[26px]" style={{ background: `linear-gradient(180deg, ${color}14, transparent 30%, transparent 75%, ${color}1f)` }}>
        {BUBBLES.map((b, i) => (
          <span key={i} className="tank-bubble absolute bottom-1 rounded-full border border-white/30" style={{ left: b.left, width: b.size, height: b.size, animationDelay: b.delay }} />
        ))}
        <div className="absolute inset-x-3 top-1.5 h-4 rounded-full bg-white/[0.05] blur-[1px]" />
      </div>
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
        const flash = flashes[slot];
        const maxIntegrity = def?.integrity ?? state.config.integrity.default;
        const intStyle = !pg || pg.integrity >= maxIntegrity ? 'bg-emerald-900/70 text-emerald-100' : pg.integrity <= 1 ? 'bg-red-700/90 text-white' : 'bg-amber-700/80 text-amber-50';
        const accent = def ? accentFor(def.faction) : '#5a6b63';
        const asleep = !!pg?.faceDown;
        return (
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
            } ${pg?.poisoned ? 'ring-1 ring-fuchsia-500' : ''} ${pg?.disabled ? 'grayscale' : ''} ${flash ? 'wear-flash' : ''}`}
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
            {flash && (
              <span key={flash.key} className={`wear-float pointer-events-none absolute -top-3 right-0 z-20 rounded px-1 text-[9px] font-bold shadow ${flash.destroyed ? 'bg-red-700 text-white' : 'bg-orange-600 text-white'}`} aria-live="polite">
                {flash.text}
              </span>
            )}
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
                    <span className={`rounded px-[3px] py-[1px] ${intStyle}`} title="Integrity: the graft's own HP. Clash damage and some cards wear it down; at 0 the graft is destroyed.">
                      ⬢{pg.integrity}/{maxIntegrity}
                    </span>
                  </span>
                ) : (
                  <span className="pb-0.5 text-[7.5px] text-sky-300">asleep · ☣{pg.strain}</span>
                )}
                {(pg.poisoned > 0 || pg.disabled > 0) && (
                  <span className="pb-0.5 text-[7.5px] font-semibold">
                    {pg.poisoned > 0 && <span className="text-fuchsia-300">☠ poisoned </span>}
                    {pg.disabled > 0 && <span className="text-ink2">⊘ disabled</span>}
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
          </button>
        );
      })}
    </div>
  );
}

