import { useState } from 'react';
import { CARD_MAP } from '../../engine';
import { FACTION_ACHIEVEMENTS, FACTION_IDS, masteryCard, masteryDone } from '../achievements';
import { FACTION_META, WORLD_FACTION_META } from '../meta';
import type { MatchRecord } from '../storage';
import { CardDetail } from './CardDetail';
import { Collapsible } from './Collapsible';
import { ChipArt } from './Emblem';

const metaOf = (f: string) => FACTION_META[f as keyof typeof FACTION_META] ?? WORLD_FACTION_META[f as keyof typeof WORLD_FACTION_META];

/** Per Build / World Faction: its three Faction achievements and the Mastery Signature they unlock. */
export function FactionMastery({ records }: { records: MatchRecord[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const mastered = FACTION_IDS.filter((f) => masteryDone(records, f)).length;
  return (
    <Collapsible id="mastery" title="Faction mastery" meta={`${mastered} of ${FACTION_IDS.length} mastered`}>
      <p className="text-xs text-mute">Complete all five achievements of a Build or World Faction (playing as it) to unlock its Mastery Signature card in the deck builder.</p>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {FACTION_IDS.map((f) => {
          const m = metaOf(f);
          const list = FACTION_ACHIEVEMENTS.filter((a) => a.faction === f);
          const done = masteryDone(records, f);
          const card = masteryCard(f);
          return (
            <div key={f} className={`rounded-lg border p-2.5 ${done ? 'border-amber-400/60 bg-amber-950/20' : 'border-line bg-black/20'}`}>
              <div className="flex items-center gap-2">
                <ChipArt id={f} size={32} />
                <span className="font-display text-sm font-bold" style={{ color: m.color }}>
                  {m.name}
                </span>
                {card && (
                  <button onClick={() => setOpen(card.id)} className={`ml-auto truncate rounded-md border px-2 py-0.5 text-[11px] font-semibold ${done ? 'border-amber-300 bg-amber-500 text-black' : 'border-line text-ink2'}`} title="Show the card">
                    {done ? '★' : '🔒'} {card.name}
                  </button>
                )}
              </div>
              <ul className="mt-2 space-y-1.5">
                {list.map((a) => {
                  const [have, need] = a.progress(records);
                  const ok = have >= need;
                  return (
                    <li key={a.id} className="flex items-center gap-2 text-[11px]">
                      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-display text-xs ${ok ? 'bg-amber-400 text-black' : 'bg-panel2 text-mute'}`}>{a.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className={`font-semibold ${ok ? 'text-amber-200' : 'text-ink'}`}>{a.name}</span> <span className="text-ink2">{a.text}</span>
                      </span>
                      <span className={`shrink-0 tabular-nums ${ok ? 'text-emerald-300' : 'text-mute'}`}>{ok ? '✓' : `${Math.min(have, need)}/${need}`}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {open && CARD_MAP[open] && <CardDetail def={CARD_MAP[open]} onClose={() => setOpen(null)} />}
    </Collapsible>
  );
}
