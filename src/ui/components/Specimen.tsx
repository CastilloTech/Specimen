import { useEffect, useRef, useState } from 'react';
import { CARD_MAP, publicGraft, SLOT_LABEL } from '../../engine';
import type { GameState, PlayerId, PlayerState, SlotId } from '../../engine';
import { FACTION_META } from '../meta';

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

// Slot anchor points in a 100x120 body box (percent). `flip` mirrors the Limbs so the
// two Specimens face each other.
const POS: Record<SlotId, { x: number; y: number }> = {
  head: { x: 50, y: 11 },
  nerve: { x: 50, y: 32 },
  limbA: { x: 15, y: 47 },
  limbB: { x: 85, y: 47 },
  organ: { x: 50, y: 54 },
  organB: { x: 50, y: 77 },
};

interface Props {
  state: GameState;
  player: PlayerId;
  viewer: PlayerId; // whose eyes: decides what face-down grafts reveal
  flip?: boolean;
  highlight?: Set<SlotId>;
  onSlot?: (slot: SlotId) => void;
  color: string;
}

export function Specimen({ state, player, viewer, flip, highlight, onSlot, color }: Props) {
  const p = state.players[player];
  const fm = FACTION_META[p.faction];
  const flashes = useWearFlashes(state, p);
  return (
    <div className="relative mx-auto aspect-[5/4.4] w-full max-w-[210px] lg:max-w-[250px]" aria-label={`${p.name}'s Specimen`}>
      <svg viewBox="0 0 100 88" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        <g transform={flip ? 'translate(100,0) scale(-1,1)' : undefined} fill="none" stroke={color} strokeWidth="1.2" opacity="0.55" vectorEffect="non-scaling-stroke">
          <ellipse cx="50" cy="48" rx="24" ry="28" fill={fm.color} fillOpacity="0.08" />
          <circle cx="50" cy="10" r="8" fill={fm.color} fillOpacity="0.1" />
          <path d="M50 18 V74" strokeDasharray="2 2" />
          <path d="M28 35 Q12 38 10 47" />
          <path d="M72 35 Q88 38 90 47" />
          <path d="M40 74 L36 86 M60 74 L64 86" />
        </g>
      </svg>
      {p.slots.map((slot) => {
        const pos = POS[slot];
        const x = flip && (slot === 'limbA' || slot === 'limbB') ? 100 - pos.x : pos.x;
        const g = p.grafts.find((gr) => gr.slot === slot);
        const pg = g ? publicGraft(g, viewer === player) : null;
        const def = pg?.cardId ? CARD_MAP[pg.cardId] : null;
        const veteranAt = state.config.veterancy.signatureThreshold;
        const veteran = !!def?.signature && !!pg && pg.roundsSurvived >= veteranAt;
        const lit = highlight?.has(slot);
        const necrotic = p.necrosis[slot] ?? 0;
        const flash = flashes[slot];
        const maxIntegrity = def?.integrity ?? state.config.integrity.default;
        const intStyle = !pg || pg.integrity >= maxIntegrity ? 'bg-emerald-900/60 text-emerald-200' : pg.integrity <= 1 ? 'bg-red-800/80 text-red-100' : 'bg-amber-800/70 text-amber-100';
        return (
          <button
            key={slot}
            type="button"
            onClick={() => onSlot?.(slot)}
            className={`absolute grid w-[31%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md border px-0.5 py-0.5 text-center leading-[1.05] ${
              lit ? 'target-glow border-accent bg-accent/15' : pg ? 'border-line bg-panel2' : necrotic > 0 ? 'border-fuchsia-800 bg-fuchsia-950/40' : 'border-dashed border-line/80 bg-black/30'
            } ${pg?.poisoned ? 'ring-1 ring-fuchsia-500' : ''} ${pg?.disabled ? 'grayscale' : ''} ${flash ? 'wear-flash' : ''}`}
            style={{ left: `${x}%`, top: `${pos.y}%`, minHeight: '16%' }}
            title={
              def
                ? `${def.name}${pg?.faceDown ? ' (asleep)' : ''}: ${def.text}${veteran ? ` (Veteran: +${state.config.veterancy.signatureAttackBonus} attack for surviving ${pg!.roundsSurvived} Strain checks)` : ''}`
                : pg
                  ? 'Face-down graft (asleep)'
                  : necrotic > 0
                    ? `Necrotic: cannot be refilled for ${necrotic} more round(s)`
                    : SLOT_LABEL[slot]
            }
          >
            {flash && (
              <span key={flash.key} className={`wear-float pointer-events-none absolute -top-2 right-0 z-10 rounded px-1 text-[9px] font-bold shadow ${flash.destroyed ? 'bg-red-700 text-white' : 'bg-orange-600 text-white'}`} aria-live="polite">
                {flash.text}
              </span>
            )}
            <span className="text-[7px] font-semibold uppercase tracking-wider text-mute">{SLOT_LABEL[slot]}</span>
            {pg ? (
              <>
                <span className="flex w-full items-center justify-center gap-0.5 truncate text-[9px] font-semibold">
                  {veteran && <span className="text-amber-300">★</span>}
                  {def ? def.name : '? ? ?'}
                </span>
                {def && (
                  <span className="flex gap-0.5 leading-none">
                    <span className="rounded bg-red-900/60 px-0.5 text-[7px] font-bold text-red-200" title="Attack">
                      {def.attack + (veteran ? state.config.veterancy.signatureAttackBonus : 0)}
                    </span>
                    <span className="rounded bg-sky-900/60 px-0.5 text-[7px] font-bold text-sky-200" title="Armor">
                      {def.armor}
                    </span>
                    <span className={`rounded px-0.5 text-[7px] font-bold ${intStyle}`} title="Integrity: the graft's own HP. Clash damage and some cards wear it down; at 0 the graft is destroyed.">
                      ⬢{pg.integrity}/{maxIntegrity}
                    </span>
                  </span>
                )}
                <span className="text-[8px] text-amber-300">
                  STR {pg.strain}
                  {pg.faceDown && ' ▣ asleep'}
                  {pg.poisoned > 0 && ' ☠'}
                  {pg.disabled > 0 && ' ⊘'}
                </span>
              </>
            ) : necrotic > 0 ? (
              <span className="text-[8px] font-semibold text-fuchsia-300">necrotic ({necrotic})</span>
            ) : (
              <span className="text-[9px] text-mute/60">empty</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
