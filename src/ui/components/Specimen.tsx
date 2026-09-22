import { CARD_MAP, publicGraft, SLOT_LABEL } from '../../engine';
import type { GameState, PlayerId, SlotId } from '../../engine';
import { FACTION_META } from '../meta';

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
        const lit = highlight?.has(slot);
        return (
          <button
            key={slot}
            type="button"
            onClick={() => onSlot?.(slot)}
            className={`absolute grid w-[31%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md border px-0.5 py-0.5 text-center leading-[1.05] ${
              lit ? 'target-glow border-accent bg-accent/15' : pg ? 'border-line bg-panel2' : 'border-dashed border-line/80 bg-black/30'
            } ${pg?.poisoned ? 'ring-1 ring-fuchsia-500' : ''} ${pg?.disabled ? 'grayscale' : ''}`}
            style={{ left: `${x}%`, top: `${pos.y}%`, minHeight: '16%' }}
            title={def ? `${def.name}${pg?.faceDown ? ' (asleep)' : ''}: ${def.text}` : pg ? 'Face-down graft (asleep)' : SLOT_LABEL[slot]}
          >
            <span className="text-[7px] font-semibold uppercase tracking-wider text-mute">{SLOT_LABEL[slot]}</span>
            {pg ? (
              <>
                <span className="w-full truncate text-[9px] font-semibold">{def ? def.name : '? ? ?'}</span>
                {def && (
                  <span className="flex gap-0.5 leading-none">
                    <span className="rounded bg-red-900/60 px-0.5 text-[7px] font-bold text-red-200" title="Attack">
                      {def.attack}
                    </span>
                    <span className="rounded bg-sky-900/60 px-0.5 text-[7px] font-bold text-sky-200" title="Armor">
                      {def.armor}
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
            ) : (
              <span className="text-[9px] text-mute/60">empty</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
