import { lazy, Suspense, useMemo } from 'react';
import { CARD_MAP, SLOT_LABEL } from '../../engine';
import type { CardDef, SlotId } from '../../engine';
import { accentFor } from './CardView';
import { Creature2D } from './Specimen';
import { use3dPref } from '../three/pref';
import type { GraftView, StageState } from '../three/actor';

// The fitting room: the Specimen in 3D on a turntable, wearing a set of grafts (one card per slot), so a card's
// model can be seen on the body before it goes in a deck. Only where 3D is on.

const Creature3D = lazy(() => import('../three/Creature3D'));

export type Fit = Partial<Record<SlotId, string>>;
const ORDER: SlotId[] = ['head', 'nerve', 'organ', 'limbA', 'limbB'];

/** The slot a graft card goes on in a fitting: its own, or for a Limb the free forearm (the right one first). */
export function fitSlot(def: CardDef, fit: Fit): SlotId | null {
  if (def.type !== 'graft' || !def.slot) return null;
  if (def.slot === 'Head') return 'head';
  if (def.slot === 'Nerve') return 'nerve';
  if (def.slot === 'Organ') return 'organ';
  if (fit.limbA === def.id || !fit.limbA) return 'limbA';
  if (fit.limbB === def.id || !fit.limbB) return 'limbB';
  return 'limbA';
}

/** A fitting with this card tried on (replacing whatever was on its slot). */
export function tryOn(fit: Fit, def: CardDef): Fit {
  const slot = fitSlot(def, fit);
  if (!slot || fit[slot] === def.id || (def.slot === 'Limb' && (fit.limbA === def.id || fit.limbB === def.id))) return fit;
  return { ...fit, [slot]: def.id };
}

export function Fitting({ fit, onClear, height = 260, focus, zoom = 1 }: { fit: Fit; onClear?: (slot: SlotId) => void; height?: number; focus?: string; zoom?: number }) {
  const on3d = use3dPref();
  const state = useMemo<StageState>(
    () => ({
      grafts: ORDER.filter((s) => fit[s] && CARD_MAP[fit[s]!]).map(
        (slot): GraftView => ({ slot, uid: `fit-${slot}-${fit[slot]}`, cardId: fit[slot]!, faceDown: false, color: accentFor(CARD_MAP[fit[slot]!].faction), poisoned: false, disabled: false, rank: 0 }),
      ),
      necrosis: [],
      strain: 0,
      hp: 1,
      tint: null,
      dead: false,
      won: false,
      color: '#7be0b0',
      stance: null,
      rejecting: false,
    }),
    [fit],
  );
  if (!on3d) return <p className="text-[11px] text-mute">Turn on 3D Specimens (sound & display menu) to see grafts on the body.</p>;
  const worn = ORDER.filter((s) => fit[s] && CARD_MAP[fit[s]!]);
  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-line bg-[radial-gradient(ellipse_at_50%_45%,rgba(123,224,176,0.12),transparent_70%)]" style={{ height }}>
        <Suspense fallback={<Creature2D />}>
          <Creature3D state={state} zoom={zoom} turntable />
        </Suspense>
        <span className="pointer-events-none absolute bottom-1.5 right-2 text-[10px] text-mute">Drag to turn</span>
      </div>
      {worn.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {worn.map((slot) => {
            const def = CARD_MAP[fit[slot]!];
            return (
              <li key={slot} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${def.id === focus ? 'bg-black/40' : ''}`} style={{ borderColor: `${accentFor(def.faction)}99` }}>
                <span className="text-mute">{SLOT_LABEL[slot]}</span>
                <span className="font-semibold">{def.name}</span>
                {onClear && (
                  <button onClick={() => onClear(slot)} className="ml-0.5 text-mute hover:text-ink" aria-label={`Take ${def.name} off`}>
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
