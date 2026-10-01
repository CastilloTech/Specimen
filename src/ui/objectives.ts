import { CARD_MAP, makeRng } from '../engine';
import type { EngineId, GameState, PlayerId } from '../engine';
import { ENGINE_META } from './meta';

// A small side goal for each match, beside winning: something your own deck is built to do, so it points
// you at a good line of play instead of away from it. Pays a little biomass when you have Game Modes.

export interface Objective {
  id: string;
  text: string;
  /** Progress so far, as [have, need] (need 1 for yes/no goals). */
  progress: (s: GameState, me: PlayerId) => [number, number];
  /** Also needs the match won (checked at the end). */
  needsWin?: boolean;
}

export const OBJECTIVE_REWARD = 15;

const engineGoal = (e: EngineId, n: number): Objective => ({
  id: `engine:${e}`,
  text: `Fire your ${ENGINE_META[e].name} engine ${n} times`,
  progress: (s, me) => [Math.min(n, s.players[me].stats.engineFiresBy[e] ?? 0), n],
});

const GENERAL: Objective[] = [
  { id: 'stable', text: 'Win without going past 5 Strain', needsWin: true, progress: (s, me) => [s.players[me].stats.maxStrain <= 5 ? 1 : 0, 1] },
  { id: 'block', text: 'Block 15 Clash damage', progress: (s, me) => [Math.min(15, s.players[me].stats.damageBlocked), 15] },
  { id: 'vent', text: 'Vent 8 Strain', progress: (s, me) => [Math.min(8, s.players[me].stats.strainVented), 8] },
  { id: 'deal', text: 'Deal 30 damage', progress: (s, me) => [Math.min(30, s.players[me].stats.damageDealt), 30] },
  { id: 'evolve', text: 'Evolve by round 4', progress: (s, me) => [evolvedBy4(s, me) ? 1 : 0, 1] },
  { id: 'grafts', text: 'Attach 5 grafts', progress: (s, me) => [Math.min(5, s.players[me].stats.graftsPlayed), 5] },
  { id: 'clean', text: 'Win without a rejection', needsWin: true, progress: (s, me) => [s.players[me].stats.rejectionsSuffered === 0 ? 1 : 0, 1] },
];

/** Whether the evolution happened by round 4 (read from the log, since the round moves on afterwards). */
function evolvedBy4(s: GameState, me: PlayerId): boolean {
  return s.log.some((l) => l.kind === 'evolve' && l.player === me && l.round <= 4);
}

/** The objective for a match: half the time one of your deck's engines (the one with the most payoffs), else a general goal. Fixed by the seed. */
export function pickObjective(s: GameState, me: PlayerId, seed: number): Objective {
  const rng = makeRng((seed ^ 0x6f1d2c3b) >>> 0);
  const deck = [...s.players[me].deck, ...s.players[me].hand].map((c) => CARD_MAP[c.cardId]);
  const payoffs = new Map<EngineId, number>();
  for (const d of deck) for (const t of d?.engines ?? []) if (t.role === 'payoff') payoffs.set(t.id, (payoffs.get(t.id) ?? 0) + 1);
  const best = [...payoffs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (best && rng.float() < 0.5) return engineGoal(best[0], 3);
  return rng.pick(GENERAL);
}

/** Done: the progress is full and, for "win" goals, the match was won. */
export function objectiveDone(o: Objective, s: GameState, me: PlayerId): boolean {
  const [have, need] = o.progress(s, me);
  if (have < need) return false;
  return !o.needsWin || (s.phase === 'over' && s.result?.winner === me);
}

/** Lost for good: a "keep it clean" goal already broken mid-match. */
export function objectiveFailed(o: Objective, s: GameState, me: PlayerId): boolean {
  if (s.phase === 'over') return !objectiveDone(o, s, me);
  if (o.id === 'stable') return s.players[me].stats.maxStrain > 5;
  if (o.id === 'clean') return s.players[me].stats.rejectionsSuffered > 0;
  if (o.id === 'evolve') return s.round > 4 && !evolvedBy4(s, me);
  return false;
}
