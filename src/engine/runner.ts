// Headless helpers: play a whole match with bots, or replay a recorded action list.
import { botAction } from './bot';
import { pendingPlayers, reduce } from './reducer';
import { makeRng } from './rng';
import { createMatch } from './setup';
import type { Action, GameState, MatchSetup } from './types';

export function playBotMatch(setup: MatchSetup, botSeed = setup.seed, maxSteps = 5000): GameState {
  let s = createMatch(setup);
  const rngs = [makeRng(botSeed ^ 0x9e3779b9), makeRng(botSeed ^ 0x85ebca6b)];
  for (let i = 0; i < maxSteps && s.phase !== 'over'; i++) {
    const [p] = pendingPlayers(s);
    const next = reduce(s, botAction(s, p, rngs[p]));
    if (next.lastError) throw new Error(`Bot produced an illegal action: ${next.lastError}`);
    s = next;
  }
  if (s.phase !== 'over') throw new Error('Match did not finish (step limit)');
  return s;
}

/** Rebuild a match from its setup and recorded actions. Same seed + actions = same match. */
export function replay(setup: MatchSetup, actions: Action[]): GameState {
  let s = createMatch(setup);
  for (const a of actions) {
    const next = reduce(s, a);
    if (next.lastError) throw new Error(`Replay hit an illegal action (${a.type}): ${next.lastError}`);
    s = next;
  }
  return s;
}
