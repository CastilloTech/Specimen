import type { CardDef } from '../../engine';
import { FACTION_META, TYPE_META } from '../meta';

interface Props {
  def: CardDef;
  cost?: number; // effective cost (after modifiers)
  size?: 'md' | 'sm';
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  count?: number;
}

export function CardView({ def, cost, size = 'md', selected, dim, onClick, count }: Props) {
  const t = TYPE_META[def.type];
  const shownCost = cost ?? def.cost;
  const accent = def.faction === 'tech' ? '#8a948f' : FACTION_META[def.faction].color;
  const sm = size === 'sm';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative shrink-0 rounded-lg border text-left transition-transform ${sm ? 'h-[118px] w-[86px] p-1.5' : 'h-[164px] w-[112px] p-2'} ${
        selected ? '-translate-y-2 border-accent bg-panel2 shadow-lg shadow-accent/20' : 'border-line bg-panel'
      } ${dim ? 'opacity-40' : ''}`}
      style={{ borderTopColor: accent, borderTopWidth: 3 }}
      aria-pressed={selected}
    >
      <span className={`absolute -left-1.5 -top-2 grid place-items-center rounded-full bg-sky-600 font-bold text-white ${sm ? 'h-5 w-5 text-[11px]' : 'h-6 w-6 text-xs'}`} title="Energy cost">
        {shownCost}
      </span>
      {count !== undefined && <span className="absolute -right-1.5 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-black">×{count}</span>}
      <div className={`${sm ? 'text-[9px]' : 'text-[10px]'} pl-3 font-semibold uppercase tracking-wide`} style={{ color: t.color }}>
        {t.label}
        {def.signature && <span className="ml-1 text-amber-300">★</span>}
        {def.slot && <span className="ml-1 text-ink2">· {def.slot}</span>}
      </div>
      <div className={`${sm ? 'text-[11px]' : 'text-[13px]'} mt-0.5 font-semibold leading-tight`}>{def.name}</div>
      <div className={`mt-1 flex flex-wrap gap-1 ${sm ? 'text-[9px]' : 'text-[10px]'} font-semibold`}>
        {def.type === 'graft' && (
          <>
            <span className="rounded bg-red-900/60 px-1 text-red-200">ATK {def.attack}</span>
            <span className="rounded bg-sky-900/60 px-1 text-sky-200">ARM {def.armor}</span>
          </>
        )}
        {def.strain > 0 && <span className="rounded bg-amber-900/60 px-1 text-amber-200">STR {def.strain}</span>}
      </div>
      {!sm && <div className="mt-1 line-clamp-5 text-[10px] leading-snug text-ink2">{def.text}</div>}
    </button>
  );
}
