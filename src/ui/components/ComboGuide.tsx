import { useMemo, useState } from 'react';
import { CARD_MAP, defaultConfig } from '../../engine';
import { ALL_COMBOS, BUILD_GUIDE, comboNote, comboReport, formName, WORLD_GUIDE } from '../comboGuide';
import { FACTION_META, TYPE_META, WORLD_FACTION_META } from '../meta';
import type { MatchRecord } from '../storage';
import { CardDetail } from './CardDetail';
import { ChipArt, Emblem } from './Emblem';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A guide for each Build / World Faction combo: its game plan, evolutions, and how your own games and cards went. */
export function ComboGuide({ records }: { records: MatchRecord[] }) {
  const counts = useMemo(() => {
    const m = new Map<string, { games: number; score: number }>();
    for (const r of records) {
      const k = `${r.me.faction}/${r.me.worldFaction}`;
      const c = m.get(k) ?? { games: 0, score: 0 };
      c.games++;
      c.score += r.result === 'win' ? 1 : r.result === 'draw' ? 0.5 : 0;
      m.set(k, c);
    }
    return m;
  }, [records]);
  const mostPlayed = [...counts.entries()].sort((a, b) => b[1].games - a[1].games)[0]?.[0] ?? ALL_COMBOS[0].key;
  const [key, setKey] = useState(mostPlayed);
  const [open, setOpen] = useState<string | null>(null);
  const [allTips, setAllTips] = useState(false);
  const combo = ALL_COMBOS.find((c) => c.key === key)!;
  const report = useMemo(() => comboReport(records, combo), [records, combo]);
  const fm = FACTION_META[combo.faction];
  const wm = WORLD_FACTION_META[combo.worldFaction];
  const b = BUILD_GUIDE[combo.faction];
  const w = WORLD_GUIDE[combo.worldFaction];
  const forms = (defaultConfig.evolutions as Record<string, { id: string; name: string; text: string }[]>)[combo.faction];

  return (
    <section className="lab-panel flex flex-col gap-4 rounded-xl border border-line p-4" aria-label="Combo guide">
      <div>
        <h2 className="font-display text-lg font-bold">Combo guide</h2>
        <p className="text-xs text-mute">Pick a Build / World Faction combo for its game plan and what your matches with it say, card by card.</p>
      </div>

      {/* The 12 combos: Build rows, World Faction columns. */}
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Combo">
        {ALL_COMBOS.map((c) => {
          const on = c.key === key;
          const k = counts.get(c.key);
          return (
            <button
              key={c.key}
              role="radio"
              aria-checked={on}
              onClick={() => setKey(c.key)}
              className={`flex flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 ${on ? 'bg-black/35' : 'border-line hover:border-mute'}`}
              style={on ? { borderColor: FACTION_META[c.faction].color } : undefined}
              title={`${FACTION_META[c.faction].name} / ${WORLD_FACTION_META[c.worldFaction].name}`}
              aria-label={`${FACTION_META[c.faction].name} / ${WORLD_FACTION_META[c.worldFaction].name}: ${k ? `${k.games} matches` : 'unplayed'}`}
            >
              <span className="flex items-center gap-0.5">
                <Emblem id={c.faction} size={20} />
                <Emblem id={c.worldFaction} size={20} />
              </span>
              <span className="max-w-full truncate text-[10px] font-semibold leading-tight" style={{ color: FACTION_META[c.faction].color }}>
                {FACTION_META[c.faction].name.slice(0, 4)}/<span style={{ color: WORLD_FACTION_META[c.worldFaction].color }}>{WORLD_FACTION_META[c.worldFaction].name.slice(0, 4)}</span>
              </span>
              <span className="text-[9px] text-mute">{k ? `${k.games} · ${pct(k.score / k.games)}` : 'unplayed'}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <ChipArt id={combo.faction} size={44} />
        <ChipArt id={combo.worldFaction} size={44} />
        <div className="min-w-0">
          <div className="font-display text-base font-bold">
            <span style={{ color: fm.color }}>{fm.name}</span> <span className="text-mute">/</span> <span style={{ color: wm.color }}>{wm.name}</span>
          </div>
          <div className="text-xs text-ink2">{report ? `${report.games} match${report.games === 1 ? '' : 'es'} · ${pct(report.rate)} win rate · ${report.rounds.toFixed(1)} rounds on average` : 'Not played yet with this save.'}</div>
        </div>
      </div>

      {report && (
        <div>
          <div className="lab-label mb-1.5">Tips from your games with this combo</div>
          <ul className="space-y-1.5">
            {report.tips.length ? (
              (allTips ? report.tips : report.tips.slice(0, 4)).map((t) => (
                <li key={t} className="rounded-lg border-l-2 border-accent bg-black/25 px-3 py-2 text-xs text-ink">
                  {t}
                </li>
              ))
            ) : (
              <li className="rounded-lg bg-black/25 px-3 py-2 text-xs text-ink2">No weak spot stands out with this combo. Keep it up.</li>
            )}
          </ul>
          {report.tips.length > 4 && (
            <button onClick={() => setAllTips((v) => !v)} className="mt-1.5 text-xs text-accent underline">
              {allTips ? 'Show fewer' : `Show ${report.tips.length - 4} more`}
            </button>
          )}
        </div>
      )}

      <div>
        <div className="lab-label mb-1.5">Game plan</div>
        <p className="rounded-lg bg-accent/10 px-3 py-2 text-xs text-ink">{comboNote(combo.key)}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {[
            { id: combo.faction, meta: fm, g: b },
            { id: combo.worldFaction, meta: wm, g: w },
          ].map(({ id, meta, g }) => (
            <div key={id} className="rounded-lg border border-line p-2.5 text-xs">
              <div className="mb-1 flex items-center gap-1.5 font-display font-bold" style={{ color: meta.color }}>
                <Emblem id={id} size={18} />
                {meta.name}
              </div>
              <p className="text-ink2">{g.plan}</p>
              <ul className="mt-1.5 space-y-0.5">
                {g.do.map((t) => (
                  <li key={t} className="flex gap-1.5">
                    <span className="text-emerald-300">✓</span>
                    <span>{t}</span>
                  </li>
                ))}
                {g.avoid.map((t) => (
                  <li key={t} className="flex gap-1.5">
                    <span className="text-red-300">✕</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="lab-label mb-1.5">Evolutions</div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {forms.map((d) => {
            const mine = report?.forms.find((f) => f.id === d.id);
            return (
              <li key={d.id} className="rounded-lg border border-line p-2.5 text-xs">
                <div className="flex items-baseline gap-2">
                  <span className="font-display font-bold" style={{ color: fm.color }}>
                    {formName(d.id)}
                  </span>
                  <span className="ml-auto text-[10px] text-mute">{mine ? `reached in ${mine.games} · ${pct(mine.rate)}` : report ? 'not reached yet' : ''}</span>
                </div>
                <p className="mt-0.5 text-ink2">{d.text}</p>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <div className="lab-label mb-1.5">Your cards with this combo</div>
        {!report || report.tracked === 0 ? (
          <p className="rounded-lg bg-black/25 px-3 py-2 text-xs text-ink2">Card stats start with your next match as {fm.name} / {wm.name}.</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead className="bg-black/30 text-[10px] uppercase tracking-wider text-mute">
                  <tr>
                    <th className="px-2 py-1 text-left font-semibold">Card</th>
                    <th className="px-1 py-1 text-right font-semibold" title="Total times played">Played</th>
                    <th className="px-1 py-1 text-right font-semibold" title="Your score in the games you played it">Win%</th>
                    <th className="px-2 py-1 text-right font-semibold" title="Rejected / destroyed, severed or necrosed / negated">Lost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {report.cards.map((c) => {
                    const def = CARD_MAP[c.id];
                    if (!def) return null;
                    const lostParts = [c.rejected && `${c.rejected} rej`, c.lost && `${c.lost} destr`, c.negated && `${c.negated} neg`].filter(Boolean).join(' · ');
                    const wr = c.winRate;
                    return (
                      <tr key={c.id}>
                        <td className="max-w-0 px-2 py-1">
                          <button onClick={() => setOpen(c.id)} className="block w-full truncate text-left font-semibold hover:underline" title="Show the full card">
                            {def.signature && <span className="text-amber-300">★</span>}
                            {def.name}
                            <span className="ml-1 hidden text-[10px] font-normal sm:inline" style={{ color: TYPE_META[def.type].color }}>
                              {TYPE_META[def.type].label}
                            </span>
                          </button>
                        </td>
                        <td className="px-1 py-1 text-right tabular-nums">
                          {c.played}
                          <span className="text-mute"> /{c.games}g</span>
                        </td>
                        <td className={`px-1 py-1 text-right font-bold tabular-nums ${wr === null ? 'text-mute' : wr >= report.rate + 0.1 ? 'text-emerald-300' : wr <= report.rate - 0.15 ? 'text-red-300' : ''}`}>{wr === null ? '—' : pct(wr)}</td>
                        <td className={`whitespace-nowrap px-2 py-1 text-right ${lostParts ? 'text-orange-300' : 'text-mute'}`}>{lostParts || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[10px] text-mute">
              From {report.tracked} tracked match{report.tracked === 1 ? '' : 'es'}. Win% is your score in the games you played that card (green: well above your {pct(report.rate)} with this combo; red: well below).
              {report.unplayed.length > 0 && ` Never played: ${report.unplayed.map((id) => CARD_MAP[id]?.name ?? id).join(', ')}.`}
            </p>
          </>
        )}
      </div>
      {open && CARD_MAP[open] && <CardDetail def={CARD_MAP[open]} onClose={() => setOpen(null)} />}
    </section>
  );
}
