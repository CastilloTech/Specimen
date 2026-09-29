import { createMatch, reduce } from '../engine';
import type { GameState, LogEntry, MatchSetup, PlayerId, Stance } from '../engine';
import { STANCE_META } from './meta';

// Turning points: the few moments that decided a finished match, found by replaying it. Each comes with a
// line on why it mattered and the replay step to watch it from.

export interface TurningPoint {
  round: number;
  /** Good for you (green) or bad (red). */
  good: boolean;
  icon: string;
  title: string;
  detail: string;
  /** The replay step (0 = the deal) just after it happened. */
  step: number;
  weight: number;
}

const BEATS: Record<Stance, Stance> = { aggress: 'adapt', adapt: 'fortify', fortify: 'aggress' };
const stanceWinner = (a: Stance | undefined, b: Stance | undefined): 0 | 1 | null => (!a || !b || a === b ? null : BEATS[a] === b ? 0 : 1);

export function turningPoints(setup: MatchSetup, final: GameState, me: PlayerId, max = 3): TurningPoint[] {
  const states: GameState[] = [];
  try {
    states.push(createMatch(setup));
    for (const a of final.history) {
      const next = reduce(states[states.length - 1], a);
      if (next.lastError) break;
      states.push(next);
    }
  } catch {
    return [];
  }
  const opp = (1 - me) as PlayerId;
  const them = final.players[opp].name;
  const stepWhere = (pred: (s: GameState) => boolean) => {
    const i = states.findIndex(pred);
    return i < 0 ? states.length - 1 : i;
  };
  const stepOfLog = (e: LogEntry) => stepWhere((s) => s.log.length > e.n);
  const mine = final.players[me].stanceHistory;
  const theirs = final.players[opp].stanceHistory;
  const pts: TurningPoint[] = [];

  // Rounds with a big HP swing.
  const sn = final.snapshots;
  for (let i = 1; i < sn.length; i++) {
    // Damage net of healing that round (never shown below 0).
    const took = Math.max(0, sn[i - 1].hp[me] - sn[i].hp[me]);
    const dealt = Math.max(0, sn[i - 1].hp[opp] - sn[i].hp[opp]);
    const net = dealt - took;
    if (Math.abs(net) < 6 && Math.max(dealt, took) < 8) continue;
    const r = sn[i].round;
    const ms = mine[r - 1];
    const ts = theirs[r - 1];
    const w = stanceWinner(ms, ts);
    const stanceLine = ms && ts ? (w === null ? `Both picked ${STANCE_META[ms].name}.` : w === 0 ? `Your ${STANCE_META[ms].name} beat their ${STANCE_META[ts].name}.` : `Their ${STANCE_META[ts].name} beat your ${STANCE_META[ms].name}.`) : '';
    const good = net > 0;
    const lethal = i === sn.length - 1 && final.result?.winner !== null && final.result?.winner !== undefined && sn[i].hp[good ? opp : me] <= 0;
    pts.push({
      round: r,
      good,
      icon: good ? '⚔' : '💥',
      title: lethal ? (good ? `Round ${r}: the finishing blow (${dealt} damage)` : `Round ${r}: you were finished off (${took} damage)`) : good ? `Round ${r}: you out-hit them ${dealt} to ${took}` : `Round ${r}: they out-hit you ${took} to ${dealt}`,
      detail: `${stanceLine}${!good && w === 1 ? ' Mixing up your stance makes you harder to read.' : ''}${!good && took >= 10 && w !== 1 ? ' A Hold or Fortify would have softened it.' : ''}`.trim(),
      step: stepWhere((s) => s.snapshots.length > i),
      weight: Math.abs(net) + (lethal ? 6 : 0),
    });
  }

  for (const e of final.log) {
    const who = e.player;
    if (who === null) continue;
    const mineEv = who === me;
    if (e.kind === 'reject') {
      const card = /ejects (.+) from /.exec(e.text)?.[1];
      pts.push({
        round: e.round,
        good: !mineEv,
        icon: '☣',
        title: mineEv ? `Round ${e.round}: your Specimen rejected ${card ?? 'a graft'}` : `Round ${e.round}: ${them} rejected ${card ?? 'a graft'}`,
        detail: mineEv ? 'Your Strain was past the limit at the Strain check. Vent before it gets there: Hold, Fortify, Cycle, or a round without grafting.' : 'Their Strain went over the limit, and it cost them a graft.',
        step: stepOfLog(e),
        weight: 8,
      });
    } else if (e.kind === 'evolve' && e.text.startsWith('EVOLUTION:')) {
      const form = /evolves into (.+)!/.exec(e.text)?.[1] ?? 'a new form';
      pts.push({
        round: e.round,
        good: mineEv,
        icon: '🧬',
        title: mineEv ? `Round ${e.round}: you evolved into ${form}` : `Round ${e.round}: ${them} evolved into ${form}`,
        detail: mineEv ? 'An evolution changes how your Specimen fights for the rest of the match.' : 'Watch the evolution bars on their panel: you can see an evolution coming and play around it.',
        step: stepOfLog(e),
        weight: 6,
      });
    } else if ((e.kind === 'wear' && /is destroyed/.test(e.text)) || (e.kind === 'play' && / (severs|necroses) /.test(e.text))) {
      // The graft's owner is the one who loses it; the log names them in the text.
      const lostMine = e.text.includes(`${final.players[me].name}'s`);
      pts.push({
        round: e.round,
        good: !lostMine,
        icon: '✂',
        title: lostMine ? `Round ${e.round}: you lost a graft` : `Round ${e.round}: you destroyed one of their grafts`,
        detail: e.text,
        step: stepOfLog(e),
        weight: 4,
      });
    }
  }

  // A habit they punished: the same stance countered three rounds or more.
  let run = 0;
  for (let r = 0; r < mine.length; r++) {
    run = stanceWinner(mine[r], theirs[r]) === 1 && (r === 0 || mine[r] === mine[r - 1]) ? run + 1 : stanceWinner(mine[r], theirs[r]) === 1 ? 1 : 0;
    if (run === 3) {
      pts.push({
        round: r + 1,
        good: false,
        icon: '👁',
        title: `Rounds ${r - 1}–${r + 1}: they read your ${STANCE_META[mine[r]].name}`,
        detail: `You picked ${STANCE_META[mine[r]].name} three rounds running and lost the stance each time. The bot tracks your habits.`,
        step: stepWhere((s) => s.round >= r + 1 && s.phase === 'actions'),
        weight: 5,
      });
    }
  }

  return pts
    .sort((a, b) => b.weight - a.weight || a.round - b.round)
    .slice(0, max)
    .sort((a, b) => a.round - b.round || a.step - b.step);
}
