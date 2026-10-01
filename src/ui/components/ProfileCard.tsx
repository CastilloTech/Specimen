import { FACTIONS, WORLD_FACTIONS } from '../../engine';
import type { Profile } from '../matchmaker';
import { FACTION_META, WORLD_FACTION_META } from '../meta';
import { ChipArt, Emblem } from './Emblem';

// A player's profile card: their chosen emblem, name, current Specimen and online series record. Shown in the
// lounge, on the "opponent found" moment, the VS screen and the series result.

const metaOf = (id: string) => FACTION_META[id as keyof typeof FACTION_META] ?? WORLD_FACTION_META[id as keyof typeof WORLD_FACTION_META];

export function ProfileBadge({ emblem, size = 28 }: { emblem: string; size?: number }) {
  const color = metaOf(emblem)?.color ?? '#7be0b0';
  return (
    <span className="grid shrink-0 place-items-center rounded-full border-2 bg-black/50" style={{ width: size, height: size, borderColor: color }}>
      <Emblem id={emblem} size={Math.round(size * 0.62)} />
    </span>
  );
}

/** `size`: "row" for lists, "card" for the bigger moments. */
export function ProfileCard({ p, size = 'row', tag, className = '' }: { p: Profile; size?: 'row' | 'card'; tag?: React.ReactNode; className?: string }) {
  const card = size === 'card';
  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${className}`}>
      <ProfileBadge emblem={p.emblem} size={card ? 52 : 30} />
      <div className="min-w-0 flex-1">
        <div className={`flex min-w-0 items-center gap-1.5 font-display font-bold ${card ? 'text-xl' : 'text-sm'}`}>
          <span className="truncate">{p.name}</span>
          {tag}
        </div>
        <div className={`flex items-center gap-1.5 text-ink2 ${card ? 'text-xs' : 'text-[11px]'}`}>
          <span className="flex -space-x-1.5">
            <ChipArt id={p.faction} size={card ? 20 : 15} />
            <ChipArt id={p.worldFaction} size={card ? 20 : 15} />
          </span>
          <span className="truncate">
            <span style={{ color: FACTION_META[p.faction].color }}>{FACTION_META[p.faction].name}</span>/<span style={{ color: WORLD_FACTION_META[p.worldFaction].color }}>{WORLD_FACTION_META[p.worldFaction].name}</span>
          </span>
          <span className="shrink-0 tabular-nums text-mute" title="Online series won–lost">
            · {p.won}–{p.lost}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Choosing the emblem on your card. */
export function EmblemPicker({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Your emblem">
      {[...FACTIONS, ...WORLD_FACTIONS].map((id) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} aria-label={metaOf(id)?.name ?? id} title={metaOf(id)?.name ?? id} onClick={() => onPick(id)} className={`rounded-full p-0.5 transition ${value === id ? 'ring-2 ring-accent' : 'opacity-60 hover:opacity-100'}`}>
          <ProfileBadge emblem={id} size={32} />
        </button>
      ))}
    </div>
  );
}
