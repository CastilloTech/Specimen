// Higher bot tiers for Game Modes (the Tower). Both still use only what a player could know: the search bot
// re-deals the opponent's hand and both decks at random before each simulation ("determinization"), so it
// never plays against the true hidden cards.
import { basicAction, botReaction, oppToxinsPlayed } from './bot';
import { budgetOf } from './budget';
import { cardOf } from './data';
import { legalPlays, pendingPlayers, reactionOptions, reduce } from './reducer';
import { makeRng } from './rng';
import type { Action, GameState, PlayerId, Stance } from './types';
import { other, STANCES } from './types';

type Rng = ReturnType<typeof makeRng>;
const BEATS: Record<Stance, Stance> = { aggress: 'adapt', adapt: 'fortify', fortify: 'aggress' };

// ---------- Reader ----------

/**
 * Predicts the opponent's next stance from their history (what they picked after their last stance before,
 * blended with how often they pick each one), then picks the stance with the best expected result.
 */
export function readStance(s: GameState, p: PlayerId, rng: Rng): Stance {
  const theirs = s.players[other(p)].stanceHistory;
  const mine = s.players[p].stanceHistory;
  const beater = (x: Stance) => STANCES.find((st) => BEATS[st] === x)!;
  const n = Math.min(theirs.length, mine.length);
  // A few simple habits the opponent might have. Each is scored by how often it would have predicted their
  // actual stance so far (starting from a prior guess), and the prediction is the habits weighted by that.
  const favourite = (upTo: number) => {
    const c: Record<Stance, number> = { aggress: 0, adapt: 0, fortify: 0 };
    for (let k = 0; k < upTo; k++) c[theirs[k]]++;
    return [...STANCES].sort((a, b) => c[b] - c[a])[0];
  };
  const habits: { prior: number; guess: (i: number) => Stance }[] = [
    { prior: 0.5, guess: (i) => beater(mine[i - 1]) }, // counters your last stance
    { prior: 0.34, guess: (i) => theirs[i - 1] }, // repeats their own last stance
    { prior: 0.34, guess: (i) => favourite(i) }, // plays their favourite
  ];
  const P: Record<Stance, number> = { aggress: 0.1, adapt: 0.1, fortify: 0.1 };
  if (n >= 1) {
    for (const h of habits) {
      let hits = 0;
      for (let i = 1; i < n; i++) if (h.guess(i) === theirs[i]) hits++;
      const rate = (hits + 3 * h.prior) / (n - 1 + 3); // prior worth 3 rounds of evidence
      P[h.guess(n)] += rate * rate; // sharpen: trust the habits that keep coming true
    }
  }
  const value = (m: Stance) => STANCES.reduce((v, o) => v + P[o] * (BEATS[m] === o ? 1 : BEATS[o] === m ? -1 : 0), 0);
  if (n < 1 || rng.float() < 0.12) return rng.pick([...STANCES]); // no read yet, or stay a little unpredictable
  return [...STANCES].sort((a, b) => value(b) - value(a))[0];
}

/** Energy the bot keeps back for an anti-Toxin Protocol once the opponent has shown a Toxin. */
function toxinReserve(s: GameState, p: PlayerId): number {
  if (oppToxinsPlayed(s, p) === 0) return 0;
  const guards = s.players[p].hand.map((c) => cardOf(c.cardId)).filter((d) => d.type === 'protocol' && (d.effect.reactsTo ?? []).some((k) => k === 'toxin' || k === 'any'));
  return guards.length ? Math.min(...guards.map((d) => d.cost)) : 0;
}

export function readerAction(s: GameState, p: PlayerId, rng: Rng): Action {
  if (s.phase === 'stance') return { type: 'PICK_STANCE', player: p, stance: readStance(s, p, rng) };
  const a = basicAction(s, p, rng);
  // Plays around your Toxins: keep Energy for an answer rather than spending the last of it on a small play.
  if (a.type === 'PLAY_CARD' && !s.window) {
    const reserve = toxinReserve(s, p);
    const def = cardOf(s.players[p].hand.find((c) => c.uid === a.uid)!.cardId);
    if (reserve > 0 && def.type !== 'protocol' && s.players[p].energy - def.cost < reserve && budgetOf(def, s.config).total < 6) return { type: 'PASS', player: p };
  }
  return a;
}

// ---------- Search (Monte Carlo tree search, one ply of UCB1 over the current choices) ----------

/** The choices worth searching at this decision: distinct plays, plus pass / hold / wake / cycle. */
function candidates(s: GameState, p: PlayerId, rng: Rng): Action[] {
  const out: Action[] = [];
  const seen = new Set<string>();
  const add = (a: Action) => {
    const k = JSON.stringify(a);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(a);
    }
  };
  if (s.window) {
    for (const a of reactionOptions(s, p, s.window.play)) add(a);
    add({ type: 'DECLINE_REACTION', player: p });
    return out;
  }
  add(basicAction(s, p, rng)); // the heuristic's own pick is always in the running
  for (const a of legalPlays(s, p)) {
    if (a.type === 'PLAY_CARD' || a.type === 'REVEAL' || a.type === 'HOLD' || a.type === 'PASS') add(a);
  }
  // Keep the branching manageable: the heuristic pick, pass, hold, and a spread of the rest.
  return out.length > 10 ? [out[0], ...out.filter((a) => a.type === 'PASS' || a.type === 'HOLD'), ...out.slice(1).filter((a) => a.type !== 'PASS' && a.type !== 'HOLD').slice(0, 7)] : out;
}

/** Re-deal what p cannot see: the opponent's hand from their hand + deck, and both deck orders. */
function determinize(s: GameState, p: PlayerId, rng: Rng): GameState {
  const shuffle = <T>(xs: T[]) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng.float() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const o = s.players[other(p)];
  const pool = shuffle([...o.hand, ...o.deck]);
  const me = s.players[p];
  const players = [...s.players] as GameState['players'];
  players[other(p)] = { ...o, hand: pool.slice(0, o.hand.length), deck: pool.slice(o.hand.length) };
  players[p] = { ...me, deck: shuffle(me.deck) };
  return { ...s, players, rng: Math.floor(rng.float() * 2 ** 31) };
}

/** How good a position is for p (terminal results dominate; otherwise HP, board and Strain). */
function evaluate(s: GameState, p: PlayerId): number {
  if (s.phase === 'over') return s.result?.winner === p ? 100 : s.result?.winner === null ? 0 : -100;
  const me = s.players[p];
  const op = s.players[other(p)];
  const T = s.config.strain.threshold;
  const board = (pl: typeof me) => pl.grafts.reduce((n, g) => n + (g.faceDown ? 1 : 0.5 + budgetOf(cardOf(g.cardId), s.config).stats * 0.25), 0);
  const strainRisk = (pl: typeof me) => (pl.strain > T ? 6 : pl.strain >= T - 1 ? 2 : 0);
  return me.hp - op.hp + board(me) - board(op) - strainRisk(me) + strainRisk(op) + (me.evolution ? 4 : 0) - (op.evolution ? 4 : 0);
}

/** Play on with basic bots until the current round is over (or the match ends). */
function rollout(s: GameState, rng: Rng, maxSteps = 120): GameState {
  const r0 = s.round;
  for (let i = 0; i < maxSteps && s.phase !== 'over'; i++) {
    if (s.round > r0 && s.phase === 'stance') break;
    const [q] = pendingPlayers(s);
    const next = reduce(s, basicAction(s, q, rng));
    if (next.lastError) break;
    s = next;
  }
  return s;
}

export function searchAction(s: GameState, p: PlayerId, rng: Rng): Action {
  if (s.phase === 'stance') return { type: 'PICK_STANCE', player: p, stance: readStance(s, p, rng) };
  if (s.phase !== 'actions') return basicAction(s, p, rng);
  const cands = candidates(s, p, rng);
  if (cands.length <= 1) return cands[0] ?? (s.window ? botReaction(s, p) : basicAction(s, p, rng));
  const iterations = Math.max(cands.length * 2, s.config.bot.searchIterations);
  const n = cands.map(() => 0);
  const w = cands.map(() => 0);
  const sim = makeRng(Math.floor(rng.float() * 2 ** 31));
  for (let t = 0; t < iterations; t++) {
    // UCB1: try every choice once, then favour the promising ones while still exploring the rest.
    let k = n.findIndex((x) => x === 0);
    if (k < 0) {
      const logT = Math.log(t);
      let best = -Infinity;
      cands.forEach((_, j) => {
        const u = w[j] / n[j] + 12 * Math.sqrt(logT / n[j]);
        if (u > best) {
          best = u;
          k = j;
        }
      });
    }
    const start = reduce(determinize(s, p, sim), cands[k]);
    const v = start.lastError ? -1000 : evaluate(rollout(start, sim), p);
    n[k]++;
    w[k] += v;
  }
  // Candidate 0 is the heuristic's own pick: it keeps a small head start, so noisy rollouts only override a
  // sound move when the search clearly prefers something else.
  const mean = (j: number) => (n[j] ? w[j] / n[j] : -Infinity) + (j === 0 ? 1.5 : 0);
  let pick = 0;
  cands.forEach((_, j) => {
    if (mean(j) > mean(pick)) pick = j;
  });
  return cands[pick];
}
