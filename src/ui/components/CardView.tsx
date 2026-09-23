import type { CardDef } from '../../engine';
import { FACTION_META, TYPE_META, WORLD_FACTION_META } from '../meta';
import { CardArt } from './CardArt';

export function accentFor(faction: CardDef['faction']): string {
  if (faction === 'tech') return '#8a948f';
  if (faction in FACTION_META) return FACTION_META[faction as keyof typeof FACTION_META].color;
  return WORLD_FACTION_META[faction as keyof typeof WORLD_FACTION_META].color;
}

export function factionName(faction: CardDef['faction']): string {
  if (faction === 'tech') return 'Tech';
  if (faction in FACTION_META) return FACTION_META[faction as keyof typeof FACTION_META].name;
  return WORLD_FACTION_META[faction as keyof typeof WORLD_FACTION_META].name;
}

interface Props {
  def: CardDef;
  cost?: number; // effective cost (after modifiers)
  size?: 'md' | 'sm';
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  count?: number;
  /** Why this card can't be played right now: shown on a strip across the card and in its tooltip. */
  reason?: string;
  /** Keyboard shortcut that selects this card (shown as a small corner badge, e.g. hand slot "3"). */
  hotkey?: string;
}

export function CardView({ def, cost, size = 'md', selected, dim, onClick, onDoubleClick, count, reason, hotkey }: Props) {
  const t = TYPE_META[def.type];
  const shownCost = cost ?? def.cost;
  const costChanged = cost !== undefined && cost !== def.cost;
  const accent = accentFor(def.faction);
  const sm = size === 'sm';
  const tooltip = `${def.name} (${factionName(def.faction)} ${t.label})${reason ? ` - ${reason}` : ''}\n${def.text}`;
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={tooltip}
      className={`group relative flex shrink-0 flex-col overflow-visible rounded-xl border text-left transition duration-150 ${sm ? 'h-[150px] w-[100px]' : 'h-[198px] w-[132px]'} ${
        selected ? '-translate-y-3 border-accent shadow-[0_0_0_1px_var(--color-accent),0_10px_28px_-6px_rgba(123,224,176,0.45)]' : 'border-line hover:-translate-y-1 hover:border-mute'
      } ${dim ? 'opacity-70 saturate-[.35]' : ''}`}
      style={{ background: `linear-gradient(180deg, ${accent}22, transparent 38%), var(--color-panel)` }}
      aria-pressed={selected}
    >
      <span
        className={`absolute -left-2 -top-2 z-10 grid place-items-center rounded-full border-2 border-bg font-display font-bold text-white shadow ${sm ? 'h-6 w-6 text-[12px]' : 'h-7 w-7 text-sm'} ${costChanged ? (cost! > def.cost ? 'bg-orange-600' : 'bg-emerald-600') : 'bg-sky-600'}`}
        title={costChanged ? `Energy cost (normally ${def.cost})` : 'Energy cost'}
      >
        {shownCost}
      </span>
      {count !== undefined && <span className="absolute -right-2 -top-2 z-10 grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-black">×{count}</span>}
      {hotkey && <span className="absolute -bottom-2 -right-2 z-10 hidden h-5 w-5 sm:grid place-items-center rounded-md border border-line bg-bg text-[10px] font-bold text-mute">{hotkey}</span>}

      <div className={`overflow-hidden rounded-t-[11px] border-b border-black/60 ${sm ? 'h-[40px]' : 'h-[58px]'}`}>
        <CardArt def={def} accent={accent} className="h-full w-full" />
      </div>

      <div className={`flex min-h-0 flex-1 flex-col ${sm ? 'px-1.5 pb-1 pt-1' : 'px-2 pb-1.5 pt-1'}`}>
        <div className={`font-display font-bold leading-[1.1] ${sm ? 'text-[11px]' : 'text-[13px]'}`}>
          {def.signature && <span className="mr-0.5 text-amber-300" title="Signature (one copy per deck)">★</span>}
          {def.name}
        </div>
        <div className={`mt-0.5 flex items-center gap-1 font-display font-semibold uppercase tracking-wider ${sm ? 'text-[8px]' : 'text-[9px]'}`}>
          <span style={{ color: t.color }}>{t.label}</span>
          {def.slot && <span className="text-ink2">· {def.slot}</span>}
          <span className="ml-auto truncate normal-case tracking-normal" style={{ color: accent }}>
            {factionName(def.faction)}
          </span>
        </div>
        {(def.type === 'graft' || def.strain > 0) && (
          <div className={`mt-1 flex flex-wrap gap-[3px] font-bold ${sm ? 'text-[8px]' : 'text-[9.5px]'}`}>
            {def.type === 'graft' && (
              <>
                <span className="rounded bg-red-900/70 px-1 text-red-100" title="Attack">
                  ⚔{def.attack}
                </span>
                <span className="rounded bg-sky-900/70 px-1 text-sky-100" title="Armor">
                  ⛨{def.armor}
                </span>
                {!!def.integrity && (
                  <span className="rounded bg-emerald-900/70 px-1 text-emerald-100" title="Integrity: the graft's own HP">
                    ⬢{def.integrity}
                  </span>
                )}
              </>
            )}
            {def.strain > 0 && (
              <span className="rounded bg-amber-900/70 px-1 text-amber-100" title="Strain it adds to your Specimen">
                ☣{def.strain}
              </span>
            )}
          </div>
        )}
        <div className={`mt-1 min-h-0 overflow-hidden text-ink2 ${sm ? 'line-clamp-3 text-[8.5px] leading-[1.2]' : 'line-clamp-5 text-[10px] leading-snug'}`}>{def.text}</div>
      </div>
      {dim && reason && (
        <div className={`absolute inset-x-0 bottom-0 rounded-b-[11px] bg-black/85 px-1.5 py-1 text-center font-semibold text-amber-300 ${sm ? 'text-[8px]' : 'text-[9.5px]'}`}>{reason}</div>
      )}
    </button>
  );
}
