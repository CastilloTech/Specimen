import type { CardType, EngineId } from '../../engine';
import { defaultConfig } from '../../engine';
import { deckStats } from '../deckHelpers';
import { ENGINE_META, engineColor, TYPE_META } from '../meta';
import { EngineIcon } from './EngineIcon';

const COSTS = ['0', '1', '2', '3', '4', '5+'];
const TYPES: CardType[] = ['graft', 'serum', 'toxin', 'sabotage', 'protocol'];

/** A deck at a glance: its Energy curve, card types, Strain load and slot coverage, with plain warnings. */
export function DeckStatsPanel({ deck }: { deck: string[] }) {
  const s = deckStats(deck);
  const peak = Math.max(1, ...s.curve);
  const T = defaultConfig.strain.threshold;
  return (
    <section className="rounded-lg border border-line bg-black/20 p-2" aria-label="Deck stats">
      <div className="flex items-end gap-3">
        {/* Energy curve */}
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex justify-between text-[10px] uppercase tracking-wider text-mute">
            <span>Energy curve</span>
            <span className="normal-case tracking-normal">avg {s.avgCost.toFixed(1)}</span>
          </div>
          <div className="flex h-12 items-end gap-1" role="img" aria-label={`Energy curve: ${s.curve.map((n, i) => `${n} at cost ${COSTS[i]}`).join(', ')}`}>
            {s.curve.map((n, i) => (
              <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${n} card${n === 1 ? '' : 's'} costing ${COSTS[i]}`}>
                <span className="text-[9px] leading-none text-ink2">{n || ''}</span>
                <div className="mt-0.5 w-full rounded-t bg-sky-500/80 transition-[height] duration-300 ease-out" style={{ height: `${(n / peak) * 70}%`, minHeight: n ? 3 : 0 }} />
              </div>
            ))}
          </div>
          <div className="mt-0.5 flex gap-1 text-[9px] text-mute">
            {COSTS.map((c) => (
              <span key={c} className="flex-1 text-center">
                {c}
              </span>
            ))}
          </div>
        </div>
        {/* Strain and slots */}
        <div className="w-[46%] shrink-0 space-y-1 text-[11px]">
          <div title={`The Rejection line is ${T} Strain`}>
            <span className="text-mute">Graft Strain </span>
            <b className={s.avgGraftStrain >= 2.8 ? 'text-amber-300' : 'text-ink'}>{s.avgGraftStrain.toFixed(1)}</b>
            <span className="text-mute"> each · limit {T}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(s.slots).map(([slot, n]) => (
              <span key={slot} className={`rounded px-1 py-px text-[10px] ${n === 0 ? 'bg-red-950/60 text-red-300' : 'bg-black/40 text-ink2'}`} title={`${n} ${slot} graft${n === 1 ? '' : 's'}`}>
                {slot} {n}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px]">
        {TYPES.map((t) => (
          <span key={t} style={{ color: TYPE_META[t].color }} className={s.types[t] ? '' : 'opacity-50'}>
            {TYPE_META[t].label} <b>{s.types[t]}</b>
          </span>
        ))}
      </div>
      {Object.keys(s.engines).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px]" aria-label="Engines">
          <span className="text-mute">Engines</span>
          {(Object.entries(s.engines) as [EngineId, { enablers: number; payoffs: number }][]).map(([id, e]) => (
            <span key={id} style={{ color: engineColor(id) }} title={`${ENGINE_META[id].name}: ${e.enablers} enabler${e.enablers === 1 ? '' : 's'}, ${e.payoffs} payoff${e.payoffs === 1 ? '' : 's'}. ${ENGINE_META[id].text}`}>
              <EngineIcon /> {ENGINE_META[id].name}{' '}
              <b key={`${id}-${e.enablers}-${e.payoffs}`} className="count-pop">
                {e.enablers}/{e.payoffs}
              </b>
            </span>
          ))}
        </div>
      )}
      {s.warnings.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-amber-200">
          {s.warnings.slice(0, 3).map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
