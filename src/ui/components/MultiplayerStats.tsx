import { useMemo } from 'react';
import { FACTION_META, WORLD_FACTION_META } from '../meta';
import { onlineSummary } from '../multiplayer';
import { pct } from '../stats';
import type { MatchRecord, SeriesRecord } from '../storage';
import { Collapsible } from './Collapsible';

const when = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** The Saves screen's Multiplayer section: your online series, streaks, rivals and recent results. */
export function MultiplayerStats({ series, matches }: { series: SeriesRecord[]; matches: MatchRecord[] }) {
  const o = useMemo(() => onlineSummary(series), [series]);
  // Online games by your Build / World Faction (from the per-game records).
  const builds = useMemo(() => {
    const m = new Map<string, { label: string; color: string; games: number; won: number }>();
    for (const r of matches) {
      const key = `${r.me.faction}/${r.me.worldFaction}`;
      const f = FACTION_META[r.me.faction];
      const w = WORLD_FACTION_META[r.me.worldFaction];
      const e = m.get(key) ?? { label: `${f?.name ?? r.me.faction} / ${w?.name ?? r.me.worldFaction}`, color: f?.color ?? '#999', games: 0, won: 0 };
      e.games++;
      if (r.result === 'win') e.won++;
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.games - a.games).slice(0, 5);
  }, [matches]);

  return (
    <Collapsible id="multiplayer" title="Multiplayer" meta={o.series ? `${o.won}–${o.lost} in series · ${o.games} online games` : 'no online series yet'}>
      {o.series === 0 ? (
        <p className="text-sm text-ink2">Play a friend online (Menu → Play online). Every best-of-3 you finish shows up here: your series record, streaks, and how you stand against each opponent.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Series" value={`${o.won}–${o.lost}`} sub={`${pct(o.won / o.series)} won${o.tied ? ` · ${o.tied} tied` : ''}`} />
            <Tile label="Games" value={`${o.gamesWon}–${o.gamesLost}`} sub={`${o.games ? pct(o.gamesWon / o.games) : '–'} won${o.gamesDrawn ? ` · ${o.gamesDrawn} drawn` : ''}`} />
            <Tile
              label="Streak"
              value={o.streak > 0 ? `W${o.streak}` : o.streak < 0 ? `L${-o.streak}` : '–'}
              sub={`best: ${o.bestStreak} series won in a row`}
              tone={o.streak > 0 ? 'text-emerald-300' : o.streak < 0 ? 'text-red-300' : ''}
            />
            <Tile label="Deciders" value={o.deciders ? `${o.decidersWon}/${o.deciders}` : '–'} sub={`game 3s won · ${o.sweeps} sweep${o.sweeps === 1 ? '' : 's'} · ${o.comebacks} comeback${o.comebacks === 1 ? '' : 's'}`} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="lab-label mb-1">Rivals</div>
              <ul className="flex flex-col gap-1">
                {o.rivals.slice(0, 8).map((r) => {
                  const lead = r.won > r.lost ? 'text-emerald-300' : r.won < r.lost ? 'text-red-300' : 'text-ink2';
                  return (
                    <li key={r.name} className="flex items-center gap-2 rounded-lg bg-black/25 px-2.5 py-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                      <span className={`font-display font-bold tabular-nums ${lead}`}>
                        {r.won}–{r.lost}
                      </span>
                      <span className="w-24 shrink-0 text-right text-[11px] text-mute">
                        games {r.gamesWon}–{r.gamesLost} · {when(r.last)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <div className="lab-label mb-1">Recent series</div>
              <ul className="flex flex-col gap-1">
                {[...series]
                  .reverse()
                  .slice(0, 8)
                  .map((r) => {
                    const tone = r.result === 'win' ? 'text-emerald-300' : r.result === 'loss' ? 'text-red-300' : 'text-ink2';
                    const w = r.games.filter((g) => g === 'win').length;
                    const l = r.games.filter((g) => g === 'loss').length;
                    return (
                      <li key={r.id} className="flex items-center gap-2 rounded-lg bg-black/25 px-2.5 py-1.5 text-sm">
                        <span className={`w-9 shrink-0 font-display text-xs font-bold uppercase ${tone}`}>{r.result === 'draw' ? 'tie' : r.result}</span>
                        <span className="flex shrink-0 gap-0.5" aria-label={r.games.join(', ')}>
                          {r.games.map((g, i) => (
                            <span key={i} className={`h-2 w-2 rounded-full ${g === 'win' ? 'bg-emerald-400' : g === 'loss' ? 'bg-red-400' : 'bg-mute'}`} />
                          ))}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {w}–{l} vs <b>{r.opp}</b>{' '}
                          <span className="text-[11px]" style={{ color: FACTION_META[r.oppFaction]?.color }}>
                            {FACTION_META[r.oppFaction]?.name}
                          </span>
                          <span className="text-[11px] text-mute">/</span>
                          <span className="text-[11px]" style={{ color: WORLD_FACTION_META[r.oppWorldFaction]?.color }}>
                            {WORLD_FACTION_META[r.oppWorldFaction]?.name}
                          </span>
                          {r.forfeit && <span className="ml-1 text-[10px] text-amber-200">{r.forfeit === 'me' ? '(you left)' : '(they left)'}</span>}
                        </span>
                        <span className="shrink-0 text-[11px] text-mute">{when(r.at)}</span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          </div>

          {builds.length > 0 && (
            <div>
              <div className="lab-label mb-1">Your online Specimens</div>
              <ul className="flex flex-col gap-1">
                {builds.map((b) => (
                  <li key={b.label} className="flex items-center gap-2 text-xs">
                    <span className="w-44 shrink-0 truncate font-semibold" style={{ color: b.color }}>
                      {b.label}
                    </span>
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-black/40">
                      <span className="bar-fill block h-full rounded-full bg-accent" style={{ width: `${(b.won / b.games) * 100}%` }} />
                    </span>
                    <span className="w-24 shrink-0 text-right tabular-nums text-ink2">
                      {pct(b.won / b.games)} of {b.games} game{b.games === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Collapsible>
  );
}

function Tile({ label, value, sub, tone = '' }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-black/25 p-2">
      <div className="lab-label">{label}</div>
      <div className={`font-display text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-[11px] text-mute">{sub}</div>
    </div>
  );
}
