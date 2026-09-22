import { produce } from 'immer';
import { expect } from 'vitest';
import { CARD_MAP, cardOf, createMatch, reduce, slotsFor, STARTER_DECKS, treeRows } from '../src/engine';
import type { Action, AttachedGraft, CardDef, Config, DeepPartial, Faction, GameState, PlayerId, SlotId, Stance } from '../src/engine';
import fixtureCards from './fixtures/cards.json';
import evolutionFixture from './fixtures/evolutions.json';

// Rule tests use frozen copies of cards (ids prefixed "t_") so that tuning cards.json
// for balance can never break a rule test.
for (const c of fixtureCards as unknown as CardDef[]) CARD_MAP[c.id] = c;

export const edit = (s: GameState, fn: (d: GameState) => void): GameState => produce(s, (d) => void fn(d as GameState));

export function defaultLoadout(f: Faction): string[] {
  return treeRows(f).map((r) => r.nodes[0].id);
}

/** A fresh match with NO skill-tree nodes, so base rules can be tested in isolation. */
export function baseMatch(f0: Faction = 'predator', f1: Faction = 'predator', config?: DeepPartial<Config>, seed = 1): GameState {
  const s = createMatch({
    seed,
    // Numbers that balance-tuning may move are pinned to the original spec values (30 HP, Meltdown +2,
    // evolution conditions 12 / 9 / 1 / 8 / 6 / 10) so that retuning config.json cannot break the rule tests.
    config: {
      ...config,
      specimen: { ...config?.specimen, hp: 30 },
      // Later rules changes (Energy floor, extra draws, KO tiebreak, graft replacement) are off here and switched on by the tests that cover them.
      match: { lateDraw: 0, catchUpDraw: 0, secondMoverDraw: 0, secondMoverEnergy: 0, koTiebreak: false, ...config?.match, meltdownStrain: 2 },
      energy: { min: 1, ...config?.energy },
      replace: { enabled: false, extraCost: 1, ...config?.replace },
      stances: { aggressBeatsAdaptBonus: 2, fortifyCounterDamage: 1, ...config?.stances },
      dormant: {
        quietStrain: 1,
        ...config?.dormant,
        ambush: {
          predator: { attack: 2, armor: 0, heal: 0, oppStrain: 0, draw: 0 },
          parasite: { attack: 2, armor: 0, heal: 0, oppStrain: 0, draw: 0 },
          bastion: { attack: 2, armor: 0, heal: 0, oppStrain: 0, draw: 0 },
          ...config?.dormant?.ambush,
        },
      },
      evolutions: evolutionFixture as unknown as Config['evolutions'],
    },
    players: [
      { name: 'P1', faction: f0, deck: STARTER_DECKS[f0], loadout: defaultLoadout(f0) },
      { name: 'P2', faction: f1, deck: STARTER_DECKS[f1], loadout: defaultLoadout(f1) },
    ],
  });
  return edit(s, (d) => {
    for (const p of d.players) {
      p.loadout = [];
      p.slots = [...d.config.slots] as SlotId[];
      // Inert draws: later rounds must not hand players surprise Protocols.
      p.deck = Array.from({ length: 20 }, (_, i) => ({ uid: `f:${p.id}:${i}`, cardId: 't_filler' }));
    }
  });
}

/** Give a player specific skill-tree nodes (also recomputes their slots). */
export const withNodes = (s: GameState, p: PlayerId, ids: string[]) =>
  edit(s, (d) => {
    d.players[p].loadout = ids;
    d.players[p].slots = slotsFor(d.config, ids);
  });

export function go(s: GameState, a: Action): GameState {
  const n = reduce(s, a);
  expect(n.lastError, `${a.type} should be legal`).toBeNull();
  return n;
}

export function tryGo(s: GameState, a: Action): string | null {
  return reduce(s, a).lastError;
}

/** Keep both hands: moves from mulligan into round 1 (stance phase). */
export function start(s: GameState): GameState {
  s = go(s, { type: 'MULLIGAN', player: 0, mulligan: false });
  return go(s, { type: 'MULLIGAN', player: 1, mulligan: false });
}

let uidN = 0;
export function inst(cardId: string) {
  return { uid: `t:${uidN++}`, cardId };
}

export const withHand = (s: GameState, p: PlayerId, ids: string[]) =>
  edit(s, (d) => {
    d.players[p].hand = ids.map(inst);
  });

export const hands = (s: GameState, h0: string[] = [], h1: string[] = []) => withHand(withHand(s, 0, h0), 1, h1);

/** Set Strain and record it as a peak. */
export const setStrain = (s: GameState, p: PlayerId, n: number) =>
  edit(s, (d) => {
    d.players[p].strain = n;
    d.players[p].stats.maxStrain = Math.max(d.players[p].stats.maxStrain, n);
  });

/** Set Strain without touching the recorded peak. */
export const rawStrain = (s: GameState, p: PlayerId, n: number) =>
  edit(s, (d) => {
    d.players[p].strain = n;
  });

export const setHp = (s: GameState, p: PlayerId, n: number) =>
  edit(s, (d) => {
    d.players[p].hp = n;
  });

export const setEnergy = (s: GameState, p: PlayerId, n: number) =>
  edit(s, (d) => {
    d.players[p].energy = n;
  });

/** Put a graft directly on the board (adds its Strain to the pool only if addStrain). */
export function attached(s: GameState, p: PlayerId, cardId: string, slot: SlotId, extra: Partial<AttachedGraft> = {}, addStrain = false): GameState {
  return edit(s, (d) => {
    const def = cardOf(cardId);
    const g: AttachedGraft = { uid: `g:${uidN++}`, cardId, slot, strain: def.strain, seq: ++d.graftSeq, faceDown: false, poisoned: 0, disabled: 0, ...extra };
    d.players[p].grafts.push(g);
    if (addStrain) {
      d.players[p].strain += g.strain;
      d.players[p].stats.maxStrain = Math.max(d.players[p].stats.maxStrain, d.players[p].strain);
    }
  });
}

export function pickStances(s: GameState, a: Stance, b: Stance): GameState {
  s = go(s, { type: 'PICK_STANCE', player: 0, stance: a });
  return go(s, { type: 'PICK_STANCE', player: 1, stance: b });
}

/**
 * Round 1 up to the actions phase. `first` forces who acts first on a stance tie
 * (by setting lastInitiative). Stances default to a tie on Aggress.
 */
export function toActions(s: GameState, stances: [Stance, Stance] = ['aggress', 'aggress'], first: PlayerId = 0): GameState {
  s = edit(start(s), (d) => {
    d.lastInitiative = first === 0 ? 1 : 0;
  });
  s = pickStances(s, stances[0], stances[1]);
  expect(s.phase).toBe('actions');
  return s;
}

/** Round 1, actions phase, both hands empty. */
export const arena = (f0: Faction = 'predator', f1: Faction = 'predator', stances: [Stance, Stance] = ['aggress', 'aggress'], config?: DeepPartial<Config>, first: PlayerId = 0) =>
  hands(toActions(baseMatch(f0, f1, config), stances, first));

export const pass = (s: GameState, p?: PlayerId) => go(s, { type: 'PASS', player: p ?? s.turn });

/**
 * Meeting an evolution condition is always offered as evolve-or-hold-off. When only one condition is met,
 * auto-accept it (mirrors what the bot does and what most tests expect); a real two-way choice is left
 * alone, in the 'evolve' phase, for the test to resolve itself with a CHOOSE_EVOLUTION action.
 */
export function autoEvolve(s: GameState): GameState {
  while (s.phase === 'evolve' && s.evoQueue.length && s.players[s.evoQueue[0]].evolutionOptions.length === 1) {
    const p = s.evoQueue[0];
    s = go(s, { type: 'CHOOSE_EVOLUTION', player: p, id: s.players[p].evolutionOptions[0] });
  }
  return s;
}

/** Both players pass in a row: ends the actions phase and runs Clash + Strain check. */
export function endActions(s: GameState): GameState {
  s = pass(s);
  s = pass(s);
  return autoEvolve(s);
}

/** Like endActions, but pretends both players grafted (so nobody vents in the next Draw phase). */
export function endRound(s: GameState): GameState {
  s = edit(s, (d) => {
    for (const p of d.players) p.attachedThisRound = Math.max(1, p.attachedThisRound);
  });
  return endActions(s);
}

/** Pick stances for the next round and end it (hands are left as they are). */
export function nextRound(s: GameState, a: Stance = 'aggress', b: Stance = 'aggress'): GameState {
  expect(s.phase).toBe('stance');
  return endRound(pickStances(s, a, b));
}

export const play = (s: GameState, p: PlayerId, cardId: string, extra: Partial<Extract<Action, { type: 'PLAY_CARD' }>> = {}) => {
  const c = s.players[p].hand.find((x) => x.cardId === cardId);
  if (!c) throw new Error(`${cardId} not in P${p + 1}'s hand`);
  return go(s, { type: 'PLAY_CARD', player: p, uid: c.uid, ...extra });
};

export const playErr = (s: GameState, p: PlayerId, cardId: string, extra: Partial<Extract<Action, { type: 'PLAY_CARD' }>> = {}) => {
  const c = s.players[p].hand.find((x) => x.cardId === cardId);
  if (!c) throw new Error(`${cardId} not in P${p + 1}'s hand`);
  return tryGo(s, { type: 'PLAY_CARD', player: p, uid: c.uid, ...extra });
};

export const logText = (s: GameState) => s.log.map((l) => l.text).join('\n');
