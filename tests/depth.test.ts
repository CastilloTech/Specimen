import { describe, expect, it } from 'vitest';
import { canBeDormant, cardOf, computeStats, publicGraft, visibleGrafts } from '../src/engine';
import type { CardDef, Config, DeepPartial } from '../src/engine';
import { arena, attached, endRound, go, hands, nextRound, pass, pickStances, play, playErr, rawStrain, setEnergy, setHp, setStrain, tryGo } from './kit';

describe('Cycling', () => {
  it('once per round, discard a card to vent 1 Strain', () => {
    let s = setStrain(hands(arena(), ['t_tech_stim', 't_tech_bleed']), 0, 4);
    const uid = s.players[0].hand[0].uid;
    s = go(s, { type: 'CYCLE', player: 0, uid, mode: 'vent' });
    expect(s.players[0].strain).toBe(3);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].discard).toHaveLength(1);
    expect(s.turn).toBe(1); // it is an action
    s = pass(s, 1);
    expect(tryGo(s, { type: 'CYCLE', player: 0, uid: s.players[0].hand[0].uid, mode: 'vent' })).toMatch(/Already cycled/);
  });

  it('or discard a card to draw 1', () => {
    let s = hands(arena(), ['t_tech_stim', 't_tech_bleed']);
    const deck = s.players[0].deck.length;
    s = go(s, { type: 'CYCLE', player: 0, uid: s.players[0].hand[0].uid, mode: 'draw' });
    expect(s.players[0].hand).toHaveLength(2);
    expect(s.players[0].deck).toHaveLength(deck - 1);
  });

  it('can be used again next round', () => {
    let s = hands(arena(), ['t_tech_stim']);
    s = go(s, { type: 'CYCLE', player: 0, uid: s.players[0].hand[0].uid, mode: 'draw' });
    s = endRound(s);
    s = pickStances(s, 'aggress', 'aggress');
    expect(tryGo(s, { type: 'CYCLE', player: s.turn, uid: s.players[s.turn].hand[0].uid, mode: 'draw' })).toBeNull();
  });

  it('can be switched off in config', () => {
    const s = hands(arena('predator', 'predator', ['aggress', 'aggress'], { features: { cycling: false } }), ['t_tech_stim']);
    expect(tryGo(s, { type: 'CYCLE', player: 0, uid: s.players[0].hand[0].uid, mode: 'draw' })).toMatch(/off/);
  });
});

describe('Dormant grafts (asleep until woken)', () => {
  // The kit pins these two numbers (1 and 2), so retuning config.json's dormant section cannot break the rule tests.
  const quiet = () => Number(arena().config.dormant.quietStrain);
  const ambush = () => Number(arena().config.dormant.ambush.predator.attack);
  // Maw Crown fixture: cost 3, Strain 3, +6 attack, heals 1 when it deals Clash damage.
  const darkMawCrown = () => {
    let s = setEnergy(hands(arena(), ['t_pred_maw_crown']), 0, 3);
    s = play(s, 0, 't_pred_maw_crown', { slot: 'head', faceDown: true });
    return s;
  };

  it('a face-down graft is asleep: no attack, no armor, and it adds less Strain', () => {
    const s = darkMawCrown();
    expect(s.players[0].grafts[0].faceDown).toBe(true);
    expect(computeStats(s, s.players[0]).attack).toBe(2); // the base only: the +6 sleeps
    expect(s.players[0].strain).toBe(3 - quiet());
    expect(s.players[0].grafts[0].strain).toBe(3 - quiet());
  });

  it('its text sleeps too: no Clash trigger while face-down, and it stays hidden', () => {
    let s = setHp(darkMawCrown(), 0, 25);
    s = endRound(s);
    expect(s.players[0].grafts[0].faceDown).toBe(true);
    expect(s.players[0].hp).toBe(23); // took 2, no heal
  });

  it('a passive bonus sleeps too', () => {
    let s = setEnergy(hands(arena(), ['t_pred_predator_eye']), 0, 2);
    s = play(s, 0, 't_pred_predator_eye', { slot: 'head', faceDown: true });
    s = setStrain(s, 0, 6); // Overclocked: an awake Predator Eye would add its bonus
    expect(computeStats(s, s.players[0]).attack).toBe(2); // only the base: the Eye is asleep
  });

  it('the opponent sees only the slot and its (reduced) Strain', () => {
    const s = darkMawCrown();
    const g = s.players[0].grafts[0];
    expect(publicGraft(g, false)).toEqual({ uid: g.uid, slot: 'head', strain: 3 - quiet(), faceDown: true, cardId: undefined, poisoned: 0, disabled: 0 });
    expect(publicGraft(g, true).cardId).toBe('t_pred_maw_crown');
    expect(visibleGrafts(s, 1, 0)[0].cardId).toBeUndefined();
    expect(s.log.map((l) => l.text).join()).not.toMatch(/Maw Crown/); // the log does not leak it either
  });

  it("the opponent's public attack/armor readout cannot leak a sleeping graft (it adds nothing)", () => {
    const asleep = darkMawCrown();
    const none = arena();
    expect(computeStats(asleep, asleep.players[0])).toEqual(computeStats(none, none.players[0]));
  });

  it('waking on purpose the same round it was played adds its saved Strain but no Ambush', () => {
    let s = darkMawCrown();
    s = pass(s, 1);
    s = go(s, { type: 'REVEAL', player: 0, slot: 'head' });
    const g = s.players[0].grafts[0];
    expect(g.faceDown).toBe(false);
    expect(g.strain).toBe(3); // the saved Strain came back
    expect(s.players[0].strain).toBe(3);
    expect(s.players[0].tempAttack).toBe(0); // no Ambush: it has not slept through a round
    expect(computeStats(s, s.players[0]).attack).toBe(8); // but it is awake
    expect(s.turn).toBe(1); // waking uses the turn
    expect(tryGo(s, { type: 'REVEAL', player: 1, slot: 'head' })).toBeTruthy();
  });

  it('waking on purpose after sleeping through a round gives Ambush (+attack this round only)', () => {
    let s = darkMawCrown();
    s = endRound(s); // it sleeps through round 1
    s = pickStances(s, 'aggress', 'aggress');
    if (s.turn === 1) s = pass(s, 1);
    s = go(s, { type: 'REVEAL', player: 0, slot: 'head' });
    const me = s.players[0];
    expect(me.grafts[0].faceDown).toBe(false);
    expect(me.tempAttack).toBe(ambush());
    expect(computeStats(s, me).attack).toBe(2 + 6 + ambush());
    s = endRound(s);
    expect(s.players[0].tempAttack).toBe(0); // one round only
  });

  it('a graft forced awake by the opponent pays its saved Strain and never gives Ambush', () => {
    let s = hands(arena(), ['t_tech_scanner']);
    s = attached(s, 1, 't_bast_bone_helm', 'head', { faceDown: true, dormantStrain: 1, sleptSince: 0, strain: 1 });
    s = play(s, 0, 't_tech_scanner', { target: 'head' });
    expect(s.players[1].grafts[0].faceDown).toBe(false);
    expect(s.players[1].grafts[0].strain).toBe(2);
    expect(s.players[1].strain).toBe(1); // pumped by the wake
    expect(s.players[1].tempAttack).toBe(0);
  });

  it('is woken and poisoned by Sabotage that targets it', () => {
    let s = setEnergy(hands(arena('predator', 'predator', ['aggress', 'aggress'], undefined, 1), ['t_tech_acid'], []), 0, 2);
    s = attached(s, 1, 't_bast_bone_helm', 'head', { faceDown: true });
    s = pass(s, 1);
    s = play(s, 0, 't_tech_acid', { target: 'head' });
    expect(s.players[1].grafts[0].faceDown).toBe(false);
    expect(s.players[1].grafts[0].poisoned).toBe(2);
  });

  it('an ejected sleeping graft leaves with only the Strain it had added', () => {
    let s = darkMawCrown(); // Strain 2 in the pool, on the graft
    s = rawStrain(s, 0, 12);
    s = endRound(s); // rejection
    expect(s.players[0].grafts).toHaveLength(0);
    expect(s.players[0].strain).toBe(12 - (3 - quiet())); // it takes out exactly the Strain it had added
  });

  it('cannot be used when the feature is off', () => {
    const s = setEnergy(hands(arena('predator', 'predator', ['aggress', 'aggress'], { features: { dormant: false } }), ['t_pred_bone_spur']), 0, 2);
    expect(playErr(s, 0, 't_pred_bone_spur', { slot: 'limbA', faceDown: true })).toMatch(/Dormant/);
  });

  it('any graft may sleep, including one with on-attach text (which waits for the wake); only grafts can', () => {
    const fake: CardDef = { ...cardOf('t_pred_bone_spur'), effect: { abilities: [{ trigger: 'onAttach', ops: [{ op: 'draw', amount: 1 }] }] } };
    expect(canBeDormant(fake)).toBe(true);
    expect(canBeDormant(cardOf('t_pred_maw_crown'))).toBe(true);
    expect(canBeDormant(cardOf('t_tech_bleed'))).toBe(false); // only grafts
  });
});
describe('Neural links (toggle, default off)', () => {
  const board = (config?: DeepPartial<Config>) => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], config);
    s = attached(s, 0, 't_pred_twitch_nerve', 'nerve'); // +1 attack
    s = attached(s, 0, 't_pred_bone_spur', 'limbA'); // +4
    s = attached(s, 0, 't_para_hooked_limb', 'limbB'); // +3
    return s;
  };

  it('is off by default', () => {
    const s = board();
    expect(computeStats(s, s.players[0]).attack).toBe(2 + 1 + 4 + 3);
  });

  it('when on, a Nerve graft gives +1 attack to every graft in an adjacent slot', () => {
    const s = board({ features: { neuralLinks: true } });
    expect(computeStats(s, s.players[0]).attack).toBe(2 + 1 + 4 + 3 + 2); // Nerve touches both Limbs
  });

  it('does nothing without a Nerve graft', () => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], { features: { neuralLinks: true } });
    s = attached(s, 0, 't_pred_bone_spur', 'limbA');
    s = attached(s, 0, 't_para_hooked_limb', 'limbB');
    expect(computeStats(s, s.players[0]).attack).toBe(2 + 4 + 3);
  });
});

describe('Energy banking (toggle, default off)', () => {
  it('carries over up to 2 unspent Energy when on', () => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], { features: { energyBanking: true } });
    s = endRound(s); // round 1: 1 unspent
    expect(s.players[0].energy).toBe(2 + 1);
    s = nextRound(s); // round 2: 3 unspent -> only 2 carry
    expect(s.players[0].energy).toBe(3 + 2);
  });

  it('does not carry over when off', () => {
    let s = endRound(arena());
    expect(s.players[0].energy).toBe(2);
    s = nextRound(s);
    expect(s.players[0].energy).toBe(3);
  });
});

describe('Stance momentum (toggle, default off)', () => {
  it('when on, repeating a stance gives +1 to its effect', () => {
    let s = endRound(arena('predator', 'predator', ['aggress', 'adapt'], { features: { stanceMomentum: true } }));
    expect(s.players[1].hp).toBe(26); // round 1: 2 + 2, no momentum yet
    s = nextRound(s, 'aggress', 'adapt');
    expect(s.players[1].hp).toBe(21); // round 2: 2 + 2 + 1 momentum
  });

  it('is off by default', () => {
    let s = endRound(arena('predator', 'predator', ['aggress', 'adapt']));
    s = nextRound(s, 'aggress', 'adapt');
    expect(s.players[1].hp).toBe(22);
  });

  it('a different stance resets the streak', () => {
    let s = endRound(arena('predator', 'predator', ['aggress', 'adapt'], { features: { stanceMomentum: true } }));
    s = nextRound(s, 'adapt', 'adapt');
    s = nextRound(s, 'aggress', 'adapt');
    expect(s.players[1].hp).toBe(30 - 4 - 2 - 4);
  });
});
