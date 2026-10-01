import type { GameState, PlayerId } from '../engine';
import type { SeriesView } from './online';
import type { SeriesRecord } from './storage';

// Online play in numbers: turning a finished series into a record for the save, and the save's series into the
// multiplayer stats (totals, streaks, and how you stand against each person you've played).

/** The record of a finished series, from this player's side. `left`: you walked out before it was decided. */
export function seriesRecord(code: string, sv: SeriesView, state: GameState, me: PlayerId, left = false): SeriesRecord {
  const opp = (1 - me) as PlayerId;
  const side = (w: PlayerId | null) => (w === null ? 'draw' : w === me ? 'win' : 'loss');
  const games = sv.games.map((g) => side(g.winner));
  // Walking out mid-game loses that game too.
  if (left && state.phase !== 'over') games.push('loss');
  const forfeit = left ? 'me' : sv.forfeit === null ? undefined : sv.forfeit === me ? 'me' : 'opp';
  return {
    id: `${code}-${sv.n}`,
    at: Date.now(),
    opp: state.players[opp].name,
    oppFaction: state.players[opp].faction,
    oppWorldFaction: state.players[opp].worldFaction,
    faction: state.players[me].faction,
    worldFaction: state.players[me].worldFaction,
    games,
    result: left ? 'loss' : side(sv.winner),
    ...(forfeit ? { forfeit } : {}),
  };
}

export interface Rival {
  name: string;
  series: number;
  won: number;
  lost: number;
  tied: number;
  gamesWon: number;
  gamesLost: number;
  last: number;
}

export interface OnlineSummary {
  series: number;
  won: number;
  lost: number;
  tied: number;
  games: number;
  gamesWon: number;
  gamesLost: number;
  gamesDrawn: number;
  /** Deciding games (the third game at 1-1) won and played. */
  decidersWon: number;
  deciders: number;
  /** Series won from a game down. */
  comebacks: number;
  /** Clean 2-0 wins. */
  sweeps: number;
  /** Positive: a winning streak; negative: a losing one. */
  streak: number;
  bestStreak: number;
  rivals: Rival[];
}

export function onlineSummary(list: SeriesRecord[]): OnlineSummary {
  const o: OnlineSummary = { series: list.length, won: 0, lost: 0, tied: 0, games: 0, gamesWon: 0, gamesLost: 0, gamesDrawn: 0, decidersWon: 0, deciders: 0, comebacks: 0, sweeps: 0, streak: 0, bestStreak: 0, rivals: [] };
  const rivals = new Map<string, Rival>();
  let run = 0;
  for (const r of list) {
    if (r.result === 'win') o.won++;
    else if (r.result === 'loss') o.lost++;
    else o.tied++;
    for (const g of r.games) {
      o.games++;
      if (g === 'win') o.gamesWon++;
      else if (g === 'loss') o.gamesLost++;
      else o.gamesDrawn++;
    }
    // The game that broke a 1-1 tie.
    let w = 0;
    let l = 0;
    for (const g of r.games) {
      if (w === 1 && l === 1 && g !== 'draw') {
        o.deciders++;
        if (g === 'win') o.decidersWon++;
      }
      if (g === 'win') w++;
      else if (g === 'loss') l++;
    }
    if (r.result === 'win' && r.games[0] === 'loss') o.comebacks++;
    if (r.result === 'win' && r.games.length === 2 && r.games.every((g) => g === 'win')) o.sweeps++;
    run = r.result === 'win' ? Math.max(run, 0) + 1 : r.result === 'loss' ? Math.min(run, 0) - 1 : 0;
    o.bestStreak = Math.max(o.bestStreak, run);
    const key = r.opp.toLowerCase();
    const rv = rivals.get(key) ?? { name: r.opp, series: 0, won: 0, lost: 0, tied: 0, gamesWon: 0, gamesLost: 0, last: 0 };
    rv.name = r.opp;
    rv.series++;
    if (r.result === 'win') rv.won++;
    if (r.result === 'loss') rv.lost++;
    if (r.result === 'draw') rv.tied++;
    rv.gamesWon += r.games.filter((g) => g === 'win').length;
    rv.gamesLost += r.games.filter((g) => g === 'loss').length;
    rv.last = Math.max(rv.last, r.at);
    rivals.set(key, rv);
  }
  o.streak = run;
  o.rivals = [...rivals.values()].sort((a, b) => b.series - a.series || b.last - a.last);
  return o;
}

/** "3–1 in series" against this opponent so far, or null if you've never finished a series with them. */
export function rivalLine(list: SeriesRecord[], name: string): string | null {
  const rv = onlineSummary(list).rivals.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (!rv) return null;
  const lead = rv.won > rv.lost ? 'you lead' : rv.won < rv.lost ? `${rv.name} leads` : 'level';
  return `Series vs ${rv.name}: ${rv.won}–${rv.lost}${rv.tied ? `, ${rv.tied} tied` : ''} (${lead})`;
}
