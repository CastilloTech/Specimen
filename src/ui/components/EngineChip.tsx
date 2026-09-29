import type { CardDef } from '../../engine';
import { ENGINE_META, engineColor } from '../meta';
import { EngineIcon } from './EngineIcon';

/** A card's engine keyword(s): filled for a payoff, outlined for an enabler. Sized for the card it sits on. */
export function EngineChips({ def, size = 'md', className = '' }: { def: CardDef; size?: 'xs' | 'sm' | 'md'; className?: string }) {
  if (!def.engines?.length) return null;
  const text = size === 'xs' ? 'text-[6.5px] px-[3px]' : size === 'sm' ? 'text-[7.5px] px-1' : 'text-[8.5px] px-1.5';
  // A Mastery card bridges three engines: one compact chip keeps its art visible (the full card lists them).
  if (def.engines.length > 2) {
    return (
      <div className={`pointer-events-none flex ${className}`}>
        <span
          className={`rounded-full border border-amber-300 bg-black/75 font-display font-bold uppercase leading-[1.5] tracking-wide text-amber-200 shadow-[0_1px_3px_rgba(0,0,0,0.8)] ${text}`}
          title={`Payoff for ${def.engines.map((t) => ENGINE_META[t.id].name).join(', ')}`}
        >
          <EngineIcon className="mr-px" />×{def.engines.length} engines
        </span>
      </div>
    );
  }
  return (
    <div className={`pointer-events-none flex flex-wrap gap-0.5 ${className}`}>
      {def.engines.map((t) => {
        const c = engineColor(t.id);
        const payoff = t.role === 'payoff';
        return (
          <span
            key={t.id}
            className={`rounded-full border font-display font-bold uppercase leading-[1.5] tracking-wide shadow-[0_1px_3px_rgba(0,0,0,0.8)] ${text}`}
            style={payoff ? { background: c, borderColor: c, color: '#0b0f0d' } : { background: 'rgba(0,0,0,0.75)', borderColor: c, color: c }}
            title={`${ENGINE_META[t.id].name} ${payoff ? 'payoff' : 'enabler'}: ${ENGINE_META[t.id].text}`}
          >
            <EngineIcon className="mr-px" />{ENGINE_META[t.id].name}
          </span>
        );
      })}
    </div>
  );
}
